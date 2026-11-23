import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_SHELL_POLICY,
  classifyShellCommand,
  shellWriteTargets,
  simpleCommands,
  tokenize,
  unwrapCommandWords,
} from './shell-policy.ts'

const verdict = (command: string, overrides: Partial<typeof DEFAULT_SHELL_POLICY> = {}) =>
  classifyShellCommand(command, { ...DEFAULT_SHELL_POLICY, ...overrides })

const kind = (command: string, overrides: Partial<typeof DEFAULT_SHELL_POLICY> = {}) => verdict(command, overrides).kind

const rule = (command: string) => {
  const result = verdict(command)
  return result.kind === 'allow' ? undefined : result.rule
}

test('tokenize keeps quoted text as one word and splits operators', () => {
  assert.deepEqual(tokenize(`git commit -m "fix: a && b" && git push`), ['git', 'commit', '-m', 'fix: a && b', '&&', 'git', 'push'])
  assert.deepEqual(tokenize(`echo 'it''s' a\\ b`), ['echo', 'its', 'a b'])
  assert.deepEqual(simpleCommands('a; b | c\nd'), [['a'], ['b'], ['c'], ['d']])
})

test('staging the whole tree is denied', () => {
  for (const command of [
    'git add -A',
    'git add --all',
    'git add .',
    'git add -u',
    'git add -Av',
    'git add :/',
    'git -C packages/app add -A',
    'git -c core.editor=true add --all',
    'cd repo && git add -A && git commit -m wip',
    'FOO=1 git add .',
    'sudo git add -A',
    `bash -c "git add -A"`,
    `sh -lc 'git add .'`,
    'echo $(git add -A)',
  ]) {
    assert.equal(rule(command), 'git-add-all', command)
    assert.equal(kind(command), 'deny', command)
  }
})

test('staging named paths is allowed', () => {
  for (const command of [
    'git add src/core/shell-policy.ts',
    'git add src/a.ts src/b.ts',
    'git add -p src/a.ts',
    'git add -A src/core',
    'git add -- -A',
    'git status && git diff',
    `git commit -m "never use git add -A"`,
    `echo "git add ."`,
  ]) {
    assert.equal(kind(command), 'allow', command)
  }
})

test('commit -a is denied, and a message that mentions -a is not', () => {
  for (const command of ['git commit -a -m wip', 'git commit -am "wip"', 'git commit --all -m wip', 'git commit -vam wip']) {
    assert.equal(rule(command), 'git-commit-all', command)
  }
  for (const command of ['git commit -m "-a is banned"', 'git commit -m wip', 'git commit --amend --no-edit', 'git commit -F -a']) {
    assert.equal(kind(command), 'allow', command)
  }
})

test('a force push without a lease asks', () => {
  for (const command of [
    'git push --force',
    'git push -f origin feature',
    'git push origin +feature',
    'git push --mirror',
    'git push -uf origin feature',
  ]) {
    assert.equal(kind(command), 'ask', command)
    assert.equal(rule(command), 'force-push', command)
  }
})

test('a leased force push asks only for a shared branch', () => {
  assert.equal(kind('git push --force-with-lease origin feature'), 'allow')
  assert.equal(kind('git push --force-with-lease=feature origin feature'), 'allow')
  assert.equal(kind('git push --force-with-lease origin main'), 'ask')
  assert.equal(kind('git push --force-with-lease origin HEAD:refs/heads/main'), 'ask')
  assert.equal(kind('git push --force-with-lease'), 'allow')
  assert.equal(kind('git push --force-with-lease', { currentBranch: 'main' }), 'ask')
  assert.equal(kind('git push --force-with-lease', { currentBranch: 'feature' }), 'allow')
  assert.equal(kind('git push origin main'), 'allow')
})

test('the babysit playbook denies every force push', () => {
  const babysit = { forbidForcePush: true }
  assert.equal(kind('git push --force-with-lease origin feature', babysit), 'deny')
  assert.equal(kind('git push -f', babysit), 'deny')
  assert.equal(kind('git push origin feature', babysit), 'allow')
})

test('a draft pull request is denied', () => {
  assert.equal(rule('gh pr create --draft --title x'), 'draft-pr')
  assert.equal(rule('gh pr create -d --fill'), 'draft-pr')
  assert.equal(rule('gh pr ready 12 --undo'), 'draft-pr')
  assert.equal(kind('gh pr create --fill'), 'allow')
  assert.equal(kind('gh pr ready 12'), 'allow')
  assert.equal(kind('gh issue create --title draft'), 'allow')
})

test('publish and deploy commands ask', () => {
  assert.equal(rule('npm publish'), 'deploy')
  assert.equal(rule('pnpm build && pnpm publish --access public'), 'deploy')
  assert.equal(rule('terraform apply -auto-approve'), 'deploy')
  assert.equal(kind('npm run publish-docs'), 'allow')
  assert.equal(kind('kubectl get pods'), 'allow')
  assert.equal(kind('npm publish', { askPatterns: [] }), 'allow')
})

test('a deny anywhere in the chain wins over an ask', () => {
  const result = verdict('git push -f && git add -A')
  assert.equal(result.kind, 'deny')
  assert.equal(result.kind === 'deny' ? result.rule : undefined, 'git-add-all')
})

test('a deny names the offending command and what to run instead', () => {
  const result = verdict('cd app && git add -A')
  assert.equal(result.kind, 'deny')
  if (result.kind !== 'deny') return
  assert.equal(result.command, 'git add -A')
  assert.match(result.instead, /git add <file>/)
})

test('quoted operators do not split commands, while double-quoted command substitutions are still inspected', () => {
  assert.equal(kind('echo "hello && git add -A"'), 'allow')
  assert.equal(kind("echo 'hello; git commit -a -m x'"), 'allow')
  assert.equal(rule('echo "$(git add -A)"'), 'git-add-all')
  assert.equal(rule('echo "`git add .`"'), 'git-add-all')
})

test('wrapper commands, git push --repo, malformed regexes, and shellWriteTargets are handled safely', () => {
  assert.equal(rule('timeout 30 git add -A'), 'git-add-all')
  assert.equal(rule('sudo -u root git commit -a -m wip'), 'git-commit-all')
  assert.deepEqual(unwrapCommandWords(['env', 'FOO=1', 'timeout', '-k', '5s', '30s', 'pnpm', 'test']), ['pnpm', 'test'])
  assert.equal(kind('git push --repo origin --force-with-lease main'), 'ask')
  assert.equal(kind('npm publish', { askPatterns: ['[invalid-regex('] }), 'allow')
  assert.deepEqual(shellWriteTargets('echo x > src/a.ts && cat y | tee out.js'), ['src/a.ts', 'out.js'])
  assert.deepEqual(shellWriteTargets('sed -i "" "s/a/b/" bench.mjs && dd if=/dev/zero of=dump.bin'), ['bench.mjs', 'dump.bin'])
})
