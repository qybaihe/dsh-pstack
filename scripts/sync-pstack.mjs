#!/usr/bin/env node
// Copy pstack's skills and agents into vendor/pstack at one pinned commit.
//
//   node scripts/sync-pstack.mjs                 latest main of the mirror
//   node scripts/sync-pstack.mjs --ref <sha>     a specific commit or branch
//   node scripts/sync-pstack.mjs --from <dir>    an existing checkout
//
// The script copies files and never runs them. Running it twice at the same
// commit leaves the tree unchanged.

import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { parseArgs } from 'node:util'

const REPOSITORY = 'https://github.com/backnotprop/pstack.git'
const COPIED = ['skills', 'agents', 'LICENSE']
// The statechart skill's test corpus is 3.7 MB of fixtures no agent reads.
const EXCLUDED = ['skills/statechart/scripts/test']

const root = join(import.meta.dirname, '..')
const target = join(root, 'vendor', 'pstack')

const { values } = parseArgs({ options: { ref: { type: 'string', default: 'main' }, from: { type: 'string' } } })

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

function checkout() {
  if (values.from !== undefined) return values.from
  const dir = mkdtempSync(join(tmpdir(), 'pstack-sync-'))
  git(dir, 'init', '--quiet')
  git(dir, 'remote', 'add', 'origin', REPOSITORY)
  git(dir, 'fetch', '--quiet', '--depth', '1', 'origin', values.ref)
  git(dir, 'checkout', '--quiet', 'FETCH_HEAD')
  return dir
}

function countFiles(dir) {
  let count = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    count += entry.isDirectory() ? countFiles(join(dir, entry.name)) : 1
  }
  return count
}

const source = checkout()
const commit = git(source, 'rev-parse', 'HEAD')
const committedAt = git(source, 'show', '-s', '--format=%cI', 'HEAD')

rmSync(target, { recursive: true, force: true })
for (const name of COPIED) {
  const from = join(source, name)
  cpSync(from, join(target, name), {
    recursive: statSync(from).isDirectory(),
    filter: (path) => !EXCLUDED.includes(relative(source, path).split(sep).join('/')),
  })
}

writeFileSync(
  join(target, 'UPSTREAM.json'),
  `${JSON.stringify({ repository: REPOSITORY, commit, committedAt, copied: COPIED, excluded: EXCLUDED }, null, 2)}\n`,
)

if (values.from === undefined) rmSync(source, { recursive: true, force: true })
console.log(`vendor/pstack is at ${commit.slice(0, 12)} (${committedAt}), ${countFiles(target)} files`)
