import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Config, approvalFor, denialFor, shellCommandOf } from './index.ts'

const config = Config({})
const bash = (command: string) => ({ name: 'bash', arguments: { command, description: 'test' } })

test('the schema fills pstack defaults', () => {
  assert.deepEqual(config.shellTools, ['bash', 'pwsh'])
  assert.ok(config.protectedBranches.includes('main'))
  assert.equal(config.forbidForcePush, false)
  assert.ok(config.askPatterns.length > 0)
})

test('only configured shell tools carry a command', () => {
  assert.equal(shellCommandOf(bash('git status'), config.shellTools), 'git status')
  assert.equal(shellCommandOf({ name: 'pwsh', arguments: { command: 'git status' } }, config.shellTools), 'git status')
  assert.equal(shellCommandOf({ name: 'write', arguments: { command: 'git add -A' } }, config.shellTools), undefined)
  assert.equal(shellCommandOf({ name: 'bash', arguments: { command: 42 } }, config.shellTools), undefined)
  assert.equal(shellCommandOf({ name: 'bash', arguments: null }, config.shellTools), undefined)
})

test('a denial tells the model which command, why, and what to run instead', () => {
  const denial = denialFor(bash('cd app && git add -A'), config)
  assert.ok(denial)
  assert.match(denial.reason, /^🥔 pstack blocked `git add -A`\./)
  assert.match(denial.reason, /git add <file>/)
  assert.deepEqual(denial.info, { name: 'PstackGuardError', code: 'PSTACK_GIT_ADD_ALL' })
})

test('allowed commands and ask-only commands are not denied', () => {
  assert.equal(denialFor(bash('git add src/a.ts'), config), undefined)
  assert.equal(denialFor(bash('git push --force'), config), undefined)
  assert.equal(denialFor({ name: 'read', arguments: { path: 'a' } }, config), undefined)
})

test('a force push raises an approval with a prompt in both locales', () => {
  const approval = approvalFor(bash('git push --force origin feature'), config)
  assert.ok(approval)
  assert.equal(approval.kind, 'ask')
  assert.equal(approval.reason, 'pstack force-push: git push --force origin feature')
  assert.match(approval.displayReason?.en ?? '', /--force-with-lease/)
  assert.match(approval.displayReason?.['zh'] ?? '', /git push --force origin feature/)
  assert.equal(approvalFor(bash('git push origin feature'), config), undefined)
})

test('forbidForcePush turns the approval into a denial', () => {
  const babysit = Config({ forbidForcePush: true })
  assert.equal(approvalFor(bash('git push -f'), babysit), undefined)
  assert.equal(denialFor(bash('git push -f'), babysit)?.info?.code, 'PSTACK_FORCE_PUSH')
})

test('configured branches and patterns replace the defaults', () => {
  const custom = Config({ protectedBranches: ['prod'], askPatterns: ['^make deploy\\b'] })
  assert.equal(approvalFor(bash('git push --force-with-lease origin main'), custom), undefined)
  assert.ok(approvalFor(bash('git push --force-with-lease origin prod'), custom))
  assert.ok(approvalFor(bash('make deploy'), custom))
  assert.equal(approvalFor(bash('npm publish'), custom), undefined)
})
