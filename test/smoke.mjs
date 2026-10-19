/**
 * dsh-latex 冒烟测试。
 *
 * 不依赖 cordis / DSH 运行时：用 fake ctx 验证宿主半的注册形状，
 * 直接断言提示词内容，并把 DSH_HOME 指到临时目录，避免污染真实缓存。
 *
 * 运行：node --test test/
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fakeHome = mkdtempSync(join(tmpdir(), 'dsh-latex-test-'))
process.env.DSH_HOME = fakeHome

const { normalizeConfig, buildPrompt, DEFAULT_CONFIG } = await import('../lib/prompt.js')
const host = await import('../lib/index.js')

test('插件身份与注入声明', () => {
  assert.equal(host.name, 'dsh-latex')
  assert.deepEqual(host.inject, ['systemPrompt'])
  assert.equal(typeof host.apply, 'function')
})

test('默认配置收敛', () => {
  const cfg = normalizeConfig(undefined)
  assert.equal(cfg.enabled, true)
  assert.equal(cfg.strict, true)
  assert.equal(cfg.compact, false)
  assert.equal(cfg.order, DEFAULT_CONFIG.order)
  assert.equal(cfg.locale, 'auto')
  assert.deepEqual(cfg.extraRules, [])
})

test('越界配置被收敛而不是抛出', () => {
  const cfg = normalizeConfig({ order: 99999, locale: 'fr', extraRules: [1, '', ' ok '] })
  assert.equal(cfg.order, DEFAULT_CONFIG.order)
  assert.equal(cfg.locale, 'auto')
  assert.deepEqual(cfg.extraRules, ['ok'])
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
    '\\mathrm',
    '\\si{}',
    '\\ce{}',
    '\\text',
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
  const text = buildPrompt(normalizeConfig({ locale: 'zh', extraRules: ['化学式用 $\\mathrm{H_2O}$。'] }))
  assert.ok(text.trimEnd().endsWith('化学式用 $\\mathrm{H_2O}$。'))
})

test('apply 注册唯一段并写诊断文件', () => {
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
  host.apply(ctx, { order: 150, locale: 'zh' })

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
  assert.ok(mounted.promptChars > 0)
  assert.equal(readFileSync(promptPath, 'utf8'), text)
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
  host.apply(ctx, { locale: 'zh' })
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
  host.apply(ctx, { locale: 'zh' })
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
  host.apply(ctx, { locale: 'zh' })
  const graphPath = join(fakeHome, 'cache', 'dsh-latex', 'client-graph.json')
  const graph = JSON.parse(readFileSync(graphPath, 'utf8'))
  assert.match(graph.error, /boom/)
})

test('enabled=false 时段的文本为空', () => {
  const calls = []
  host.apply({ systemPrompt: { section: s => { calls.push(s); return () => {} } } }, { enabled: false })
  assert.equal(calls[0].text(), '')
})
