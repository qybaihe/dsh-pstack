import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { isSkillName } from '@deepseek-ai/dsh-skill'
import type { SkillProviderControl, SkillProviderObservation } from '@deepseek-ai/dsh-skill'
import { PROVIDER_NAME, createProvider } from './index.ts'

function control(): SkillProviderControl & { abort(): void } {
  const controller = new AbortController()
  return { signal: controller.signal, invalidate: () => {}, abort: () => controller.abort(new Error('disposed')) }
}

const observe = async (provider: ReturnType<typeof createProvider>): Promise<SkillProviderObservation> => {
  const listed = await provider.list({})
  assert.ok(!Array.isArray(listed))
  return listed as SkillProviderObservation
}

test('the provider lists every vendored skill with a name the registry accepts', async () => {
  const { candidates, complete } = await observe(createProvider(control()))
  assert.equal(complete, true)
  assert.equal(candidates.length, 58)
  for (const candidate of candidates) {
    assert.ok(isSkillName(candidate.name), candidate.name)
    assert.equal(candidate.provider, PROVIDER_NAME)
    assert.equal(candidate.invocation.userInvocable, true)
    assert.ok(candidate.path?.endsWith(join(candidate.name, 'SKILL.md')))
  }
})

test('upstream invocation policy carries over', async () => {
  const { candidates } = await observe(createProvider(control()))
  const byName = new Map(candidates.map((candidate) => [candidate.name, candidate]))
  assert.equal(byName.get('poteto-mode')?.invocation.modelInvocable, false)
  assert.equal(byName.get('principle-prove-it-works')?.invocation.modelInvocable, false)
  assert.equal(byName.get('setup-pstack')?.invocation.modelInvocable, true)
})

test('get loads the body, and the resource base is the skill folder', async () => {
  const provider = createProvider(control())
  const { candidates } = await observe(provider)
  const candidate = candidates.find((entry) => entry.name === 'poteto-mode')
  assert.ok(candidate)
  const skill = await provider.get(candidate, {})
  assert.ok(skill)
  assert.match(skill.content, /^# Poteto mode\n/)
  assert.ok(!skill.content.includes('disable-model-invocation'))
  assert.deepEqual(skill.resourceBase, { kind: 'directory', path: join(candidate.path as string, '..') })
  assert.equal('rank' in skill, false)
  assert.equal('locator' in skill, false)
})

test('a folder whose SKILL.md does not parse makes the observation incomplete', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pstack-skills-'))
  mkdirSync(join(root, 'good'))
  mkdirSync(join(root, 'broken'))
  writeFileSync(join(root, 'good/SKILL.md'), '---\nname: good\ndescription: A skill that parses.\n---\n\n# Good\n')
  writeFileSync(join(root, 'broken/SKILL.md'), 'no frontmatter here\n')
  const { candidates, complete } = await observe(createProvider(control(), root))
  assert.equal(complete, false)
  assert.deepEqual(candidates.map((candidate) => candidate.name), ['good'])
})

test('a missing root is an incomplete observation, not an empty catalog', async () => {
  const missing = await observe(createProvider(control(), join(tmpdir(), 'pstack-does-not-exist')))
  assert.deepEqual(missing, { candidates: [], complete: false })
})

test('a disposed registration stops listing', async () => {
  const registration = control()
  const provider = createProvider(registration)
  registration.abort()
  await assert.rejects(provider.list({}), /disposed/)
})

test('a cancelled lookup stops listing', async () => {
  const provider = createProvider(control())
  await assert.rejects(provider.list({ signal: AbortSignal.abort(new Error('superseded')) }), /superseded/)
})
