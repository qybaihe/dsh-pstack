import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effortForBudget, panelVendors, pickCrossJudge, supportedEffort, vendorOf } from './model-routing.ts'
import type { ModelRoute, Seat } from './model-routing.ts'

const route = (provider: string, model: string): ModelRoute => ({ provider, model })

const deepseek = route('deepseek-official', 'deepseek-v4-flash')
const opus = route('anthropic', 'claude-opus-5-5')
const fable = route('anthropic', 'claude-fable-5-2')
const gemini = route('google', 'gemini-4-neon')

test('a direct provider names its vendor', () => {
  assert.equal(vendorOf(deepseek), 'deepseek')
  assert.equal(vendorOf(opus), 'anthropic')
  assert.equal(vendorOf(route('openai', 'o3')), 'openai')
  assert.equal(vendorOf(route('xai', 'grok-5')), 'xai')
})

test('a gateway route takes its vendor from the model name', () => {
  assert.equal(vendorOf(route('openrouter', 'anthropic/claude-opus-5-5')), 'anthropic')
  assert.equal(vendorOf(route('openrouter', 'google/gemini-4-neon')), 'google')
  assert.equal(vendorOf(route('vercel-ai-gateway', 'gpt-6')), 'openai')
  assert.equal(vendorOf(route('amazon-bedrock', 'us.anthropic.claude-opus-5-5')), undefined)
  assert.equal(vendorOf(route('groq', 'llama-5-70b')), 'meta')
  assert.equal(vendorOf(route('together', 'deepseek-ai/deepseek-v4')), 'deepseek')
})

test('Fable and Opus are one vendor', () => {
  assert.equal(vendorOf(fable), vendorOf(opus))
})

test('a model name that only starts like a family is not that family', () => {
  assert.equal(vendorOf(route('my-gateway', 'geminiesque-1')), undefined)
  assert.equal(vendorOf(route('my-gateway', 'o3')), 'openai')
  assert.equal(vendorOf(route('my-gateway', 'o365-copilot')), undefined)
})

test('an unknown route has no vendor until the user names one', () => {
  const local = route('my-gateway', 'house-model')
  assert.equal(vendorOf(local), undefined)
  assert.equal(vendorOf(local, { 'my-gateway': 'acme' }), 'acme')
  assert.equal(vendorOf(local, { 'my-gateway': 'acme', 'my-gateway/house-model': 'initech' }), 'initech')
  assert.equal(vendorOf(opus, { anthropic: 'acme' }), 'acme')
})

test('the judge is the first pool entry from another vendor than the parent', () => {
  const pool: Seat[] = [opus, gemini, deepseek]
  assert.deepEqual(pickCrossJudge(pool, deepseek), { kind: 'picked', judge: opus, vendorCheck: 'ran' })
  assert.deepEqual(pickCrossJudge(pool, opus), { kind: 'picked', judge: gemini, vendorCheck: 'ran' })
  assert.deepEqual(pickCrossJudge(pool, fable), { kind: 'picked', judge: gemini, vendorCheck: 'ran' })
})

test('inherit-parent never judges', () => {
  assert.deepEqual(pickCrossJudge(['inherit-parent', gemini], deepseek), { kind: 'picked', judge: gemini, vendorCheck: 'ran' })
  assert.deepEqual(pickCrossJudge(['inherit-parent'], deepseek), { kind: 'none', reason: 'empty-pool' })
})

test('a pool with only the parent vendor has no judge', () => {
  assert.deepEqual(pickCrossJudge([opus, fable], opus), { kind: 'none', reason: 'no-other-vendor' })
})

test('a seat with no known vendor cannot prove it differs, so it is passed over', () => {
  const local = route('my-gateway', 'house-model')
  assert.deepEqual(pickCrossJudge([local, gemini], opus), { kind: 'picked', judge: gemini, vendorCheck: 'ran' })
  assert.deepEqual(pickCrossJudge([local], opus), { kind: 'none', reason: 'no-other-vendor' })
  assert.deepEqual(pickCrossJudge([local], opus, { 'my-gateway': 'acme' }), { kind: 'picked', judge: local, vendorCheck: 'ran' })
})

test('an unknown parent skips the vendor check and says so', () => {
  const local = route('my-gateway', 'house-model')
  assert.deepEqual(pickCrossJudge([opus, gemini], local), { kind: 'picked', judge: opus, vendorCheck: 'skipped-unknown-parent' })
  assert.deepEqual(pickCrossJudge([opus, gemini], undefined), { kind: 'picked', judge: opus, vendorCheck: 'skipped-unknown-parent' })
})

test('panel vendors show how diverse a panel is', () => {
  assert.deepEqual(panelVendors([fable, opus, gemini], deepseek), ['anthropic', 'google'])
  assert.deepEqual(panelVendors(['inherit-parent', deepseek], deepseek), ['deepseek'])
  assert.deepEqual(panelVendors(['inherit-parent', route('my-gateway', 'house-model')], undefined), ['unknown'])
})

test('the budget lowers effort and stops at the bottom of the ladder', () => {
  assert.equal(effortForBudget('xhigh', 'large'), 'xhigh')
  assert.equal(effortForBudget('xhigh', 'medium'), 'high')
  assert.equal(effortForBudget('xhigh', 'small'), 'medium')
  assert.equal(effortForBudget('high', 'small'), 'low')
  assert.equal(effortForBudget('medium', 'small'), 'low')
})

test('a model gets the highest effort it supports at or below the target', () => {
  assert.equal(supportedEffort('xhigh', ['low', 'medium', 'high']), 'high')
  assert.equal(supportedEffort('high', ['low', 'high', 'max']), 'high')
  assert.equal(supportedEffort('medium', ['high', 'xhigh']), undefined)
  assert.equal(supportedEffort('xhigh', []), undefined)
})
