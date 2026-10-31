/**
 * dsh-latex 冒烟测试。
 *
 * 不依赖 cordis / DSH 运行时：用 fake ctx 验证宿主半的注册形状，
 * 直接断言提示词内容，并把 DSH_HOME 指到临时目录，避免污染真实缓存。
 *
 * 运行：node --test test/smoke.mjs
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fakeHome = mkdtempSync(join(tmpdir(), 'dsh-latex-test-'))
process.env.DSH_HOME = fakeHome

const { normalizeConfig, buildPrompt, looksLikeMath, textOfMessage, DEFAULT_CONFIG } = await import('../lib/prompt.js')
const host = await import('../lib/index.js')

test('插件身份与注入声明', () => {
  assert.equal(host.name, 'dsh-latex')
  assert.deepEqual(host.inject, ['systemPrompt'])
  assert.equal(typeof host.apply, 'function')
})

test('默认配置收敛为 auto 模式', () => {
  const cfg = normalizeConfig(undefined)
  assert.equal(cfg.mode, 'auto')
  assert.equal(cfg.enabled, true)
  assert.equal(cfg.strict, true)
  assert.equal(cfg.compact, false)
  assert.equal(cfg.order, DEFAULT_CONFIG.order)
  assert.equal(cfg.locale, 'auto')
  assert.deepEqual(cfg.extraRules, [])
})

test('mode 收敛：always / off / 未知值', () => {
  assert.equal(normalizeConfig({ mode: 'always' }).mode, 'always')
  assert.equal(normalizeConfig({ mode: 'off' }).mode, 'off')
  assert.equal(normalizeConfig({ mode: 'nonsense' }).mode, 'auto')
  assert.equal(normalizeConfig({ enabled: false }).mode, 'off')
  assert.equal(normalizeConfig({ enabled: false }).enabled, false)
})

test('越界配置被收敛而不是抛出', () => {
  const cfg = normalizeConfig({ order: 99999, locale: 'fr', extraRules: [1, '', ' ok '] })
  assert.equal(cfg.order, DEFAULT_CONFIG.order)
  assert.equal(cfg.locale, 'auto')
  assert.deepEqual(cfg.extraRules, ['ok'])
})

test('looksLikeMath 命中数学信号', () => {
  const positives = [
    '求这个积分 $\\int_0^1 x^2 \\, dx$',
    '质能方程 $$E=mc^2$$',
    '\\(a^2+b^2=c^2\\)',
    '用 \\frac{1}{2} 表示',
    '帮我讲讲矩阵的特征值',
    '证明拉格朗日中值定理',
    'the Fourier transform of this signal',
    '$x$ 应该满足什么条件',
  ]
  for (const text of positives) assert.ok(looksLikeMath(text), '应命中: ' + text)
})

test('looksLikeMath 不误伤普通文本', () => {
  const negatives = [
    '今天天气不错',
    'echo $PATH $HOME',
    '这个文件放在 Z:\\文件留存 目录',
    '价格是 $5，另一个是 $10',
    '帮我写个 README',
  ]
  for (const text of negatives) assert.ok(!looksLikeMath(text), '不应命中: ' + text)
})

test('textOfMessage 兼容字符串与分段内容', () => {
  assert.equal(textOfMessage('abc'), 'abc')
  assert.equal(textOfMessage({ role: 'user', content: 'abc' }), 'abc')
  assert.equal(textOfMessage({ role: 'user', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }), 'a\nb')
  assert.equal(textOfMessage({ role: 'tool', content: [{ type: 'image' }] }), '')
  assert.equal(textOfMessage(undefined), '')
})

test('中文提示词覆盖关键约定', () => {
  const text = buildPrompt(normalizeConfig({ locale: 'zh' }))
  for (const needle of [
    '$...$',
    '$$...$$',
    'latex',
    'tex',
    'math',
    'aligned',
    'align',
    'pmatrix',
    'cases',
    'mathrm{m/s^2}',
    'si{}',
    'ce{}',
    'text{',
    '代码块',
  ]) {
    assert.ok(text.includes(needle), '提示词缺少约定: ' + needle)
  }
  assert.ok(text.length > 400, '中文提示词过短，可能是模板坏了')
})

test('英文提示词是英文且包含同样的约定', () => {
  const text = buildPrompt(normalizeConfig({ locale: 'en' }))
  assert.ok(text.includes('always typeset with LaTeX'))
  assert.ok(text.includes('$$...$$'))
  assert.ok(text.includes('aligned'))
  assert.ok(!text.includes('公式一律用 LaTeX'))
})

test('compact 明显更短', () => {
  const full = buildPrompt(normalizeConfig({ locale: 'zh' }))
  const short = buildPrompt(normalizeConfig({ locale: 'zh', compact: true }))
  assert.ok(short.length < full.length * 0.6, `compact ${short.length} vs full ${full.length}`)
  assert.ok(short.includes('$$...$$'))
})

test('strict=false 时不再写“禁止”', () => {
  const strict = buildPrompt(normalizeConfig({ locale: 'zh', strict: true }))
  const loose = buildPrompt(normalizeConfig({ locale: 'zh', strict: false }))
  assert.ok(strict.includes('禁止'))
  assert.ok(!loose.includes('禁止'))
  assert.ok(loose.includes('优先用 LaTeX'))
})

test('enabled=false 产出空文本', () => {
  assert.equal(buildPrompt(normalizeConfig({ enabled: false })), '')
})

test('extraRules 追加在末尾', () => {
  const text = buildPrompt(normalizeConfig({ locale: 'zh', extraRules: ['化学式用 $\\\\mathrm{H_2O}$。'] }))
  assert.ok(text.trimEnd().endsWith('化学式用 $\\\\mathrm{H_2O}$。'))
})

test('always 模式注册唯一全局段并写诊断文件', () => {
  const calls = []
  const ctx = {
    systemPrompt: {
      section(section) {
        calls.push(section)
        return () => {}
      },
    },
    inject(deps, callback) {
      if (deps[0] === 'connection') callback({ connection: { rpc: { handle: () => () => {} } } })
      else callback({ clientModules: { graph: () => ({ rev: 'r1', entries: [{ id: 'dsh-latex' }] }), clientPath: () => 'x/client.js' } })
    },
  }
  host.apply(ctx, { order: 150, locale: 'zh', mode: 'always' })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'dsh-latex:math-output')
  assert.equal(calls[0].order, 150)
  assert.equal(typeof calls[0].text, 'function')
  const text = calls[0].text()
  assert.ok(text.includes('$$...$$'))

  const mountedPath = join(fakeHome, 'cache', 'dsh-latex', 'mounted.json')
  const promptPath = join(fakeHome, 'cache', 'dsh-latex', 'prompt.txt')
  assert.ok(existsSync(mountedPath), 'mounted.json 未写出')
  assert.ok(existsSync(promptPath), 'prompt.txt 未写出')

  const mounted = JSON.parse(readFileSync(mountedPath, 'utf8'))
  assert.equal(mounted.section, 'dsh-latex:math-output')
  assert.equal(mounted.order, 150)
  assert.equal(mounted.mode, 'always')
  assert.ok(mounted.promptChars > 0)
  assert.equal(readFileSync(promptPath, 'utf8'), text)
})

test('auto 模式：不注册全局段，检测到数学后按会话注册且只注册一次', async () => {
  const globalCalls = []
  const agentCalls = []
  let preStep = null
  const agent = {
    ctx: { systemPrompt: { section(section) { agentCalls.push(section); return () => {} } } },
  }
  const ctx = {
    systemPrompt: { section(section) { globalCalls.push(section); return () => {} } },
    on(name, fn) { if (name === 'agent/pre-step') preStep = fn },
    inject(deps, callback) {
      if (deps[0] === 'connection') callback({ connection: null })
      else callback({ clientModules: null })
    },
  }
  host.apply(ctx, {})

  assert.equal(globalCalls.length, 0, 'auto 模式不应注册全局段')
  assert.equal(typeof preStep, 'function', 'auto 模式应监听 agent/pre-step')

  const plain = await preStep({ agent, messages: [{ role: 'user', content: '今天天气不错' }], step: 1 }, () => ({ messages: ['keep'] }))
  assert.deepEqual(plain, { messages: ['keep'] }, '应透传下游决策')
  assert.equal(agentCalls.length, 0, '普通消息不应触发注入')

  await preStep({ agent, messages: [{ role: 'user', content: '求 $\\int x\\,dx$' }], step: 1 }, () => ({ messages: [] }))
  assert.equal(agentCalls.length, 1, '数学消息应注册作用域段')
  assert.equal(agentCalls[0].name, 'dsh-latex:math-output')
  assert.equal(typeof agentCalls[0].text, 'function')
  assert.ok(agentCalls[0].text().includes('$$...$$'))

  await preStep({ agent, messages: [{ role: 'user', content: '再来一道积分' }], step: 2 }, () => ({ messages: [] }))
  assert.equal(agentCalls.length, 1, '同一会话不应重复注册')
})

test('auto 模式：分段消息内容也能触发检测', async () => {
  const agentCalls = []
  let preStep = null
  const agent = { ctx: { systemPrompt: { section(s) { agentCalls.push(s); return () => {} } } } }
  const ctx = {
    systemPrompt: { section() { return () => {} } },
    on(name, fn) { if (name === 'agent/pre-step') preStep = fn },
    inject() {},
  }
  host.apply(ctx, {})
  await preStep({
    agent,
    messages: [{ role: 'user', content: [{ type: 'text', text: '求证：' }, { type: 'text', text: '$$\\oint_C f(z)\\,dz=0$$' }] }],
    step: 1,
  }, () => ({}))
  assert.equal(agentCalls.length, 1)
})

test('apply 注册客户端自检 RPC 通道', async () => {
  let channel = null
  let handler = null
  const ctx = {
    systemPrompt: { section: () => () => {} },
    inject(deps, callback) {
      if (deps[0] === 'connection') callback({ connection: { rpc: { handle: (name, fn) => { channel = name; handler = fn; return () => {} } } } })
      else callback({ clientModules: null })
    },
  }
  host.apply(ctx, { locale: 'zh', mode: 'always' })
  assert.equal(channel, '/dsh-latex')
  assert.equal(typeof handler, 'function')

  const pong = await handler('ping', { href: 'http://127.0.0.1:1/', userAgent: 'test-agent' })
  assert.equal(pong.ok, true)
  assert.equal(pong.value.pong, true)

  const clientPath = join(fakeHome, 'cache', 'dsh-latex', 'client-mounted.json')
  assert.ok(existsSync(clientPath), 'client-mounted.json 未写出')
  const mounted = JSON.parse(readFileSync(clientPath, 'utf8'))
  assert.equal(mounted.href, 'http://127.0.0.1:1/')
  assert.equal(mounted.userAgent, 'test-agent')

  const unknown = await handler('nope', {})
  assert.equal(unknown.ok, false)
})

test('apply 把客户端图诊断写成磁盘证据', () => {
  const ctx = {
    systemPrompt: { section: () => () => {} },
    inject(deps, callback) {
      if (deps[0] === 'connection') callback({ connection: null })
      else callback({
        clientModules: {
          graph: () => ({ rev: 'r2', entries: [{ id: 'a' }, { id: 'dsh-latex' }] }),
          clientPath: id => (id === 'dsh-latex' ? '/plugins/dsh-latex/client.js' : undefined),
        },
      })
    },
  }
  host.apply(ctx, { locale: 'zh', mode: 'always' })
  const graphPath = join(fakeHome, 'cache', 'dsh-latex', 'client-graph.json')
  assert.ok(existsSync(graphPath), 'client-graph.json 未写出')
  const graph = JSON.parse(readFileSync(graphPath, 'utf8'))
  assert.equal(graph.hasEntry, true)
  assert.equal(graph.clientPath, '/plugins/dsh-latex/client.js')
  assert.equal(graph.graphRev, 'r2')
  assert.deepEqual(graph.entries, ['a', 'dsh-latex'])
})

test('clientModules 抛错时诊断仍落盘但不影响注入', () => {
  const ctx = {
    systemPrompt: { section: () => () => {} },
    inject(deps, callback) {
      if (deps[0] === 'connection') callback({ connection: null })
      else callback({ clientModules: { graph() { throw new Error('boom') } } })
    },
  }
  host.apply(ctx, { locale: 'zh', mode: 'always' })
  const graphPath = join(fakeHome, 'cache', 'dsh-latex', 'client-graph.json')
  const graph = JSON.parse(readFileSync(graphPath, 'utf8'))
  assert.match(graph.error, /boom/)
})

test('mode=off 不注册任何段', () => {
  const calls = []
  host.apply({ systemPrompt: { section: s => { calls.push(s); return () => {} } } }, { mode: 'off' })
  assert.equal(calls.length, 0)
})
