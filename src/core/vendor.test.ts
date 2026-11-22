// These tests read the vendored pstack tree, so a sync that changes a file
// shape the parsers rely on fails here and not in a running session.

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { parsePlaybook, playbookSlug } from './playbook.ts'
import { citedPrinciples, unreadCitations } from './principles.ts'
import type { Principle } from './principles.ts'
import { bodyTitle, parseSkillFile } from './skill-file.ts'

const skillsDir = join(import.meta.dirname, '../../vendor/pstack/skills')
const playbooksDir = join(skillsDir, 'poteto-mode/playbooks')

const skillNames = readdirSync(skillsDir).sort()
const readSkill = (name: string) => parseSkillFile(readFileSync(join(skillsDir, name, 'SKILL.md'), 'utf8'))
const readPlaybook = (slug: string) =>
  parsePlaybook(readFileSync(join(playbooksDir, `${slug}.md`), 'utf8'), new Set(skillNames))

const principles: Principle[] = skillNames
  .filter((name) => name.startsWith('principle-'))
  .map((name) => ({ name, title: bodyTitle(readSkill(name)?.body ?? '') ?? name }))

test('every vendored skill has a name that matches its folder and a description', () => {
  assert.equal(skillNames.length, 58)
  for (const folder of skillNames) {
    const skill = readSkill(folder)
    assert.ok(skill, `${folder} did not parse`)
    assert.equal(skill.name, folder)
    assert.ok(skill.description.length > 20, `${folder} has no description`)
    assert.ok(!skill.description.startsWith('"'), `${folder} kept its quotes`)
    assert.ok(skill.body.length > 0, `${folder} has no body`)
  }
})

test('a folded block description reads as one line', () => {
  assert.match(readSkill('make-bot-ui')?.description ?? '', /^Use when building a custom UI .* on Tailscale\.$/)
})

test('skills a person must start are not model-invocable', () => {
  assert.equal(readSkill('poteto-mode')?.modelInvocable, false)
  assert.equal(readSkill('arena')?.modelInvocable, false)
  assert.equal(readSkill('setup-pstack')?.modelInvocable, true)
})

test('all twenty-two playbooks parse into steps', () => {
  const files = readdirSync(playbooksDir).filter((file) => file.endsWith('.md'))
  assert.equal(files.length, 22)
  for (const file of files) {
    const playbook = readPlaybook(file.slice(0, -3))
    assert.ok(playbook, `${file} did not parse`)
    assert.ok(playbook.steps.length >= 2, `${file} has ${playbook.steps.length} steps`)
    if (file !== 'worktree-cleanup.md') assert.ok(playbook.stance.length > 0, `${file} has no stance`)
    for (const step of playbook.steps) assert.ok(step.label.length > 0 && step.label.length <= 72, `${file} step ${step.index}`)
  }
})

test('the bug fix playbook keeps its six steps, its routes, and its reply', () => {
  const playbook = readPlaybook('bug-fix')
  assert.ok(playbook)
  assert.equal(playbook.title, 'Bug fix')
  assert.equal(playbookSlug(playbook.title), 'bug-fix')
  assert.equal(playbook.stance, 'You own this task. Plan, review, verify.')
  assert.equal(playbook.steps.length, 6)
  assert.equal(playbook.steps[0]?.label, 'Reproduce it yourself on the matching surface via the control skill (No…')
  assert.deepEqual(playbook.steps[2]?.routes, ['architect'])
  assert.deepEqual(playbook.steps[4]?.routes, ['tdd', 'principle-sequence-verifiable-units'])
  assert.match(playbook.reply, /^what was broken, root cause, fix/)
})

test('a step keeps its indented continuation lines', () => {
  const feature = readPlaybook('feature')
  assert.ok(feature)
  assert.equal(feature.steps.length, 8)
  assert.match(feature.steps[2]?.text ?? '', /Smallest safe decomposition/)
})

test('a rule-list playbook parses its bullets as steps', () => {
  const babysit = readPlaybook('babysit')
  assert.ok(babysit)
  assert.equal(babysit.steps.length, 6)
  assert.equal(babysit.steps[2]?.label, 'Never rebase, retarget, or force-push')
})

test('a stance is the bold lead, or the plain line when nothing is bold', () => {
  assert.equal(readPlaybook('autopilot-stack')?.stance, 'Run the Autopilot-full playbook, but do not merge.')
  assert.equal(readPlaybook('worktree-cleanup')?.stance, '')
})

test('a prose playbook has one step per paragraph', () => {
  const opening = readPlaybook('opening-a-pr')
  assert.ok(opening)
  assert.equal(opening.stance, 'Invoked at the end of every other playbook.')
  assert.equal(opening.steps.length, 3)
  assert.equal(opening.steps[0]?.label, 'Work from a git worktree off trunk, and keep unrelated work out of it')
})

test('playbook titles map to their file names', () => {
  assert.equal(playbookSlug('Perf issue'), 'perf-issue')
  assert.equal(playbookSlug('Autopilot-full'), 'autopilot-full')
  assert.equal(playbookSlug('Opening a PR'), 'opening-a-pr')
})

test('there are twenty-four principles, each with a title', () => {
  assert.equal(principles.length, 24)
  for (const principle of principles) assert.notEqual(principle.title, principle.name)
  assert.ok(principles.some((p) => p.name === 'principle-laziness-protocol' && p.title === 'Laziness Protocol'))
})

test('a reply that names a principle by title or slug cites it', () => {
  const reply = 'Kept the diff small per the Laziness Protocol, and encode-lessons-in-structure moved the rule into a lint.'
  assert.deepEqual(
    citedPrinciples(reply, principles).map((p) => p.name),
    ['principle-encode-lessons-in-structure', 'principle-laziness-protocol'],
  )
  assert.deepEqual(citedPrinciples('We fixed the root cause of the bug.', principles), [])
})

test('a citation of a principle the session never loaded is flagged', () => {
  const reply = 'Applied Prove It Works and Fix Root Causes.'
  const loaded = new Set(['principle-prove-it-works'])
  assert.deepEqual(
    unreadCitations(reply, principles, loaded).map((p) => p.name),
    ['principle-fix-root-causes'],
  )
})
