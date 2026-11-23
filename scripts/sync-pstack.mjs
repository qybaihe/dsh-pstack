#!/usr/bin/env node
// Copy pstack's skills and agents into vendor/pstack at one pinned commit.
//
//   node scripts/sync-pstack.mjs                 latest main of the mirror
//   node scripts/sync-pstack.mjs --ref <sha>     a specific commit or branch
//   node scripts/sync-pstack.mjs --from <dir>    an existing git checkout (exports committed HEAD)
//
// Stages into a temporary directory and validates required files before
// swapping `vendor/pstack`, so a failed fetch or partial copy never clobbers
// the existing vendored snapshot.

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { parseArgs } from 'node:util'

const REPOSITORY = 'https://github.com/backnotprop/pstack.git'
const COPIED = ['skills', 'agents', 'LICENSE']
// The statechart skill's test corpus is 3.7 MB of fixtures no agent reads.
const EXCLUDED = ['skills/statechart/scripts/test']

const root = join(import.meta.dirname, '..')
const target = join(root, 'vendor', 'pstack')

const { values } = parseArgs({
  options: {
    ref: { type: 'string', default: 'main' },
    from: { type: 'string' },
  },
})

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

function countFiles(dir) {
  let count = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    count += entry.isDirectory() ? countFiles(join(dir, entry.name)) : 1
  }
  return count
}

const tempDirs = []
const makeTempDir = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

try {
  let sourceDir
  let commit
  let committedAt

  if (values.from !== undefined) {
    commit = git(values.from, 'rev-parse', values.ref || 'HEAD')
    committedAt = git(values.from, 'show', '-s', '--format=%cI', commit)
    // Export committed tree via `git archive` so dirty/untracked working tree files never sneak into vendor/pstack
    sourceDir = makeTempDir('pstack-archive-')
    const archive = execFileSync('git', ['archive', '--format=tar', commit], {
      cwd: values.from,
      maxBuffer: 64 * 1024 * 1024,
    })
    execFileSync('tar', ['-xf', '-', '-C', sourceDir], { input: archive })
  } else {
    sourceDir = makeTempDir('pstack-sync-')
    git(sourceDir, 'init', '--quiet')
    git(sourceDir, 'remote', 'add', 'origin', REPOSITORY)
    git(sourceDir, 'fetch', '--quiet', '--depth', '1', 'origin', values.ref)
    git(sourceDir, 'checkout', '--quiet', 'FETCH_HEAD')
    commit = git(sourceDir, 'rev-parse', 'HEAD')
    committedAt = git(sourceDir, 'show', '-s', '--format=%cI', 'HEAD')
  }

  for (const name of COPIED) {
    if (!existsSync(join(sourceDir, name))) {
      throw new Error(`Upstream commit ${commit} is missing required entry "${name}"`)
    }
  }

  const stageDir = makeTempDir('pstack-stage-')
  for (const name of COPIED) {
    const from = join(sourceDir, name)
    cpSync(from, join(stageDir, name), {
      recursive: statSync(from).isDirectory(),
      filter: (filePath) => !EXCLUDED.includes(relative(sourceDir, filePath).split(sep).join('/')),
    })
  }

  if (!existsSync(join(stageDir, 'skills', 'poteto-mode', 'SKILL.md'))) {
    throw new Error('Staged vendor tree is missing skills/poteto-mode/SKILL.md')
  }

  writeFileSync(
    join(stageDir, 'UPSTREAM.json'),
    `${JSON.stringify({ repository: REPOSITORY, commit, committedAt, copied: COPIED, excluded: EXCLUDED }, null, 2)}\n`,
  )

  rmSync(target, { recursive: true, force: true })
  cpSync(stageDir, target, { recursive: true })

  console.log(`vendor/pstack is at ${commit.slice(0, 12)} (${committedAt}), ${countFiles(target)} files`)
} finally {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
}
