#!/usr/bin/env node
// Load the built bundle in a real DeepSeek Harness and check what it did.
//
//   node scripts/smoke-dsh.mjs                 the oldest DSH that engines.dsh allows
//   node scripts/smoke-dsh.mjs --dsh alpha     any version or dist-tag of @deepseek-ai/dsh
//
// It creates a throwaway DSH_HOME, so no real profile is touched. It makes no
// model call and runs no shell command: the probe only prepares tool calls.

import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const root = join(import.meta.dirname, '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const { values } = parseArgs({
  options: { dsh: { type: 'string', default: manifest.engines.dsh.replace(/^[\^~>=\s]+/, '') } },
})

const home = mkdtempSync(join(tmpdir(), 'pstack-smoke-'))
const env = { ...process.env, DSH_HOME: home }
const dshArgs = ['-y', `@deepseek-ai/dsh@${values.dsh}`]
const dsh = (...args) => execFileSync('npx', [...dshArgs, ...args], { env, cwd: home, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

function boot() {
  return new Promise((resolve, reject) => {
    const patch = join(root, 'scripts/smoke/probe.patch.yml')
    // The sdk profile serves until its client disconnects, so stdin stays open.
    const child = spawn('npx', [...dshArgs, '--profile', 'smoke', '--patch', patch], { env, cwd: home, stdio: ['pipe', 'pipe', 'pipe'] })
    let output = ''
    const timer = setTimeout(() => finish(new Error(`no probe report after 90 s:\n${output}`)), 90_000)
    const finish = (error, report) => {
      clearTimeout(timer)
      child.kill()
      if (error === undefined) resolve(report)
      else reject(error)
    }
    const read = (chunk) => {
      output += chunk
      const line = output.split('\n').find((entry) => entry.startsWith('PSTACK_PROBE '))
      if (line !== undefined) finish(undefined, JSON.parse(line.slice('PSTACK_PROBE '.length)))
    }
    child.stdout.on('data', read)
    child.stderr.on('data', (chunk) => { output += chunk })
    child.on('exit', (code) => finish(new Error(`dsh exited with ${code} before the probe reported:\n${output}`)))
  })
}

try {
  const version = dsh('--version').trim().split('\n').at(-1)
  dsh('--profile', 'smoke', '--from-default-profile', 'sdk', '--dump-config')
  // pnpm treats a profile as a workspace root and wants -w to add to it.
  dsh('plugin', '--profile', 'smoke', 'add', '-w', root)
  const composed = dsh('--profile', 'smoke', '--dump-config')
  assert.match(composed, /name: '@qybaihe\/dsh-pstack\/skills'/, 'the skills row is not in the composed profile')
  assert.match(composed, /name: '@qybaihe\/dsh-pstack\/guard'/, 'the guard row is not in the composed profile')

  const report = await boot()
  assert.equal(report.error, undefined, report.error)

  const vendored = readdirSync(join(root, 'vendor/pstack/skills')).length
  assert.equal(report.skills, vendored, 'the registry does not list every vendored skill')
  assert.equal(report.potetoMode?.provider, 'pstack')
  assert.equal(report.potetoMode?.firstLine, '# Poteto mode')
  assert.deepEqual(report.potetoMode?.invocation, { modelInvocable: false, userInvocable: true })

  assert.equal(report.addAll.code, 'PSTACK_GIT_ADD_ALL', 'git add -A was not denied by the guard')
  assert.equal(report.draftPr.code, 'PSTACK_DRAFT_PR', 'a draft pull request was not denied by the guard')
  // No agent owns the probe's call, so the approval the plugin raises cannot
  // be answered and the pipeline stops the call. That proves the ask arrived.
  assert.equal(report.forcePush.outcome, 'stopped', 'a force push was not sent to approval')
  assert.match(report.forcePush.code, /^APPROVAL_/, `a force push stopped for another reason: ${report.forcePush.code}`)
  assert.equal(report.addFile.outcome, 'would-run', 'git add <file> was stopped')
  assert.equal(report.status.outcome, 'would-run', 'git status was stopped')

  console.log(`ok: DSH ${version} loaded the bundle`)
  console.log(`  skills served        ${report.skills}`)
  console.log(`  git add -A           denied (${report.addAll.code})`)
  console.log(`  gh pr create --draft denied (${report.draftPr.code})`)
  console.log(`  git push --force     sent to approval (${report.forcePush.code})`)
  console.log(`  git add <file>       allowed`)
} finally {
  rmSync(home, { recursive: true, force: true })
}
