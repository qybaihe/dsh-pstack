#!/usr/bin/env node
// Load the built @qybaihe/dsh-pstack bundle in a real DeepSeek Harness across
// both `sdk` and `web` profiles, and verify M0–M4 + Client UI composition.
//
//   node scripts/smoke-dsh.mjs                          @deepseek-ai/dsh@0.2.2-rc.5 via npx
//   node scripts/smoke-dsh.mjs --dsh 0.2.2-rc.5         any version or dist-tag of @deepseek-ai/dsh
//   node scripts/smoke-dsh.mjs --dsh-bin /path/to/dsh   any local dsh executable (e.g. Desktop runtime)
//
// Creates a throwaway DSH_HOME so no real profile is touched, makes no model
// call, and dispatches no external shell command.

import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const root = join(import.meta.dirname, '..')
const { values } = parseArgs({
  options: {
    dsh: { type: 'string', default: '0.2.2-rc.5' },
    'dsh-bin': { type: 'string' },
  },
})

const home = mkdtempSync(join(tmpdir(), 'pstack-smoke-'))
const env = { ...process.env, DSH_HOME: home }

const runnerBin = values['dsh-bin'] ?? 'npx'
const runnerPrefix = values['dsh-bin'] !== undefined ? [] : ['-y', `@deepseek-ai/dsh@${values.dsh}`]

const dsh = (...args) =>
  execFileSync(runnerBin, [...runnerPrefix, ...args], {
    env,
    cwd: home,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

function boot(profile, patchFile) {
  return new Promise((resolve, reject) => {
    const patch = join(root, 'scripts/smoke', patchFile)
    const child = spawn(runnerBin, [...runnerPrefix, '--profile', profile, '--patch', patch], {
      env,
      cwd: home,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let fullLog = ''
    let stdoutRest = ''
    let settled = false
    let pendingReport
    let pendingError

    const finalizeOnceExited = () => {
      if (pendingError !== undefined) reject(pendingError)
      else resolve(pendingReport)
    }

    const settle = (error, report) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      pendingError = error
      pendingReport = report
      if (child.exitCode !== null || child.signalCode !== null) {
        finalizeOnceExited()
      } else {
        child.kill()
      }
    }

    const timer = setTimeout(
      () => settle(new Error(`no probe report for ${profile} after 90 s:\n${fullLog}`)),
      90_000,
    )

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')

    child.stdout.on('data', (chunk) => {
      fullLog += chunk
      stdoutRest += chunk
      const lines = stdoutRest.split('\n')
      stdoutRest = lines.pop() ?? ''
      for (const line of lines) {
        if (line.startsWith('PSTACK_PROBE ')) {
          try {
            const parsed = JSON.parse(line.slice('PSTACK_PROBE '.length))
            settle(undefined, parsed)
          } catch (err) {
            settle(new Error(`Invalid JSON in probe line for ${profile}: ${err}`))
          }
          return
        }
      }
    })

    child.stderr.on('data', (chunk) => {
      fullLog += chunk
    })

    child.on('error', (err) => {
      settle(err)
      finalizeOnceExited()
    })

    child.on('close', (code) => {
      if (!settled) {
        // Check any final unterminated stdout line before failing
        if (stdoutRest.startsWith('PSTACK_PROBE ')) {
          try {
            settle(undefined, JSON.parse(stdoutRest.slice('PSTACK_PROBE '.length)))
          } catch (err) {
            settle(new Error(`Invalid JSON in trailing probe line for ${profile}: ${err}`))
          }
        } else {
          settle(new Error(`dsh (${profile}) exited with ${code} before the probe reported:\n${fullLog}`))
        }
      }
      finalizeOnceExited()
    })
  })
}

const EXPECTED_ROW_SPECS = [
  '@qybaihe/dsh-pstack',
  '@qybaihe/dsh-pstack/skills',
  '@qybaihe/dsh-pstack/guard',
  '@qybaihe/dsh-pstack/playbook',
  '@qybaihe/dsh-pstack/tdd',
  '@qybaihe/dsh-pstack/ledger',
  '@qybaihe/dsh-pstack/panel',
  '@qybaihe/dsh-pstack/bench',
  '@qybaihe/dsh-pstack/autopilot',
]

try {
  const version = dsh('--version').trim().split('\n').at(-1)

  // 1. SDK profile: headless tool pipeline, M0 shell guard, M1 TDD gate, M4 live /correct hot-apply, real subprocess
  dsh('--profile', 'smoke', '--from-default-profile', 'sdk', '--dump-config')
  dsh('plugin', '--profile', 'smoke', 'add', '-w', root)
  const composedSdk = dsh('--profile', 'smoke', '--dump-config')
  for (const spec of EXPECTED_ROW_SPECS) {
    const escaped = spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    assert.match(composedSdk, new RegExp(`name: '${escaped}'`), `missing row ${spec} in sdk composed profile`)
  }

  const sdkReport = await boot('smoke', 'probe.patch.yml')
  assert.equal(sdkReport.error, undefined, sdkReport.error)

  const vendored = readdirSync(join(root, 'vendor/pstack/skills')).length
  assert.equal(sdkReport.skills, vendored, 'the registry does not list every vendored skill')
  assert.equal(sdkReport.potetoMode?.provider, 'pstack')
  assert.equal(sdkReport.potetoMode?.firstLine, '# Poteto mode')
  assert.deepEqual(sdkReport.potetoMode?.invocation, { modelInvocable: false, userInvocable: true })

  assert.equal(sdkReport.tools.length, 13, `expected 13 pstack_* tools, got ${sdkReport.tools.join(', ')}`)
  assert.deepEqual(sdkReport.commands, ['playbook', 'tdd', 'autopilot', 'correct'])
  assert.equal(sdkReport.subprocessProbe, 'subprocess-ok', 'real DSH SubprocessService probe did not succeed')

  const pipe = sdkReport.sdkPipeline
  assert.ok(pipe !== null, 'sdk profile did not expose bash/write on root tools')
  assert.equal(pipe.addAll.code, 'PSTACK_GIT_ADD_ALL', 'git add -A was not denied by the guard')
  assert.equal(pipe.quotedAddAll.outcome, 'would-run', 'quoted && git add -A was falsely split by shell lexer')
  assert.equal(pipe.substAddAll.code, 'PSTACK_GIT_ADD_ALL', '$() command substitution inside double quotes bypassed guard')
  assert.equal(pipe.draftPr.code, 'PSTACK_DRAFT_PR', 'a draft pull request was not denied by the guard')
  assert.equal(pipe.forcePush.outcome, 'stopped', 'a force push was not sent to approval')
  assert.match(pipe.forcePush.code, /^APPROVAL_/, `a force push stopped for another reason: ${pipe.forcePush.code}`)
  assert.equal(pipe.addFile.outcome, 'would-run', 'git add <file> was stopped')
  assert.equal(pipe.status.outcome, 'would-run', 'git status was stopped')

  // M1 TDD checks (including traversal & echo-test spoofing prevention)
  assert.equal(pipe.tdd.prodBlocked.code, 'PSTACK_TDD_RED_PENDING', 'TDD did not deny production write before red')
  assert.equal(pipe.tdd.traversalBlocked.code, 'PSTACK_TDD_RED_PENDING', 'TDD did not block tests/../src/a.ts traversal')
  assert.equal(pipe.tdd.shellRedirectBlocked.code, 'PSTACK_TDD_RED_PENDING', 'TDD did not block shell redirect > src/a.ts')
  assert.equal(pipe.tdd.afterEchoSpoof.code, 'PSTACK_TDD_RED_PENDING', 'echo "npm test" && false falsely unlocked TDD')
  assert.equal(pipe.tdd.testAllowed.outcome, 'would-run', 'TDD blocked test file write')
  assert.equal(pipe.tdd.prodUnlocked.outcome, 'would-run', 'TDD did not unlock production write after red test')

  // M4 live /correct hot-apply check
  assert.equal(pipe.correct.before.outcome, 'would-run', 'deploy-potato was blocked before /correct')
  assert.equal(pipe.correct.after.code, 'PSTACK_DEPLOY', 'pstack_correct did not hot-apply live guard rule')

  // 2. Web/Desktop profile: 5 Agent Presets + Client Module bundle + sessionProjections (`pstack` + `pstackSummary`)
  dsh('--profile', 'smoke-web', '--from-default-profile', 'web', '--dump-config')
  dsh('plugin', '--profile', 'smoke-web', 'add', '-w', root)
  const webReport = await boot('smoke-web', 'probe-web.patch.yml')
  assert.equal(webReport.error, undefined, webReport.error)

  assert.ok(webReport.presets !== null, 'agentPresets service missing in web profile')
  for (const presetId of ['poteto-agent', 'comment-sicko', 'pstack-adversary', 'pstack-judge', 'pstack-worker']) {
    assert.equal(webReport.presets[presetId]?.id, presetId, `preset ${presetId} did not resolve`)
    assert.equal(
      webReport.presets[presetId]?.broken,
      null,
      `preset ${presetId} is broken: ${webReport.presets[presetId]?.broken}`,
    )
  }

  assert.equal(webReport.clientBundle?.registered, true, 'client bundle not registered in clientModules')
  assert.match(webReport.clientBundle?.clientPath ?? '', /lib[/\\]client\.js$/)

  console.log(`ok: DSH ${version} loaded @qybaihe/dsh-pstack (sdk + web profiles)`)
  console.log(`  plugin rows          ${EXPECTED_ROW_SPECS.length} rows composed`)
  console.log(`  skills served        ${sdkReport.skills}`)
  console.log(`  pstack_* tools       ${sdkReport.tools.length} tools, 4 slash commands`)
  console.log(`  subprocess service   ${sdkReport.subprocessProbe}`)
  console.log(`  agent presets (web)  5 presets resolved (broken: none)`)
  console.log(`  client bundle (web)  registered (${webReport.clientBundle.clientPath})`)
  console.log(`  M0 shell guard       git add -A (${pipe.addAll.code}), subst (${pipe.substAddAll.code}), quoted (${pipe.quotedAddAll.outcome})`)
  console.log(`  M1 TDD gate          src/a.ts + traversal + redirect blocked -> echo spoof ignored -> unlocked on red`)
  console.log(`  M4 /correct hot-rule allowed -> denied (${pipe.correct.after.code}) without restart`)
} finally {
  rmSync(home, { recursive: true, force: true })
}
