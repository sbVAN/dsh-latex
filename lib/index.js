/**
 * dsh-latex —— 宿主半。
 *
 * 职责：决定什么时候往系统提示词里注入「公式用 LaTeX 写」的规范。
 *
 *   mode: 'auto'   （默认）不污染每个会话：监听 agent/pre-step，用户消息里
 *                  出现数学话题后，才通过该会话的 agent.ctx 注册作用域段，
 *                  随会话一起释放；没聊过数学的会话不付这段 token。
 *   mode: 'always' 全局段，每个会话、每步都带（旧行为）。
 *   mode: 'off'    完全不注入。
 *
 * 扩展点来自 @deepseek-ai/dsh-system-prompt 的 `ctx.systemPrompt.section()`：
 * 作用域由调用它的 context 决定，`agent.ctx` 注册的段只对该会话生效。
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { buildPrompt, looksLikeMath, normalizeConfig, textOfMessage } from './prompt.js'

/** Cordis 插件身份：与包名保持一致，profile 的 patch 行也用它解析。 */
export const name = 'dsh-latex'

/**
 * 依赖系统提示词注册表。桌面版 / Web 版的 base 组合都带
 * `@deepseek-ai/dsh-system-prompt`，因此这里可以安全地硬注入。
 */
export const inject = ['systemPrompt']

/** 段名；同层重名会抛，所以带插件前缀。 */
const SECTION_NAME = 'dsh-latex:math-output'

/**
 * 挂载插件。
 * @param {import('@deepseek-ai/cordis').Context} ctx - Cordis 上下文。
 * @param {Record<string, unknown>} [config] - profile patch 里传入的配置。
 * @returns {void}
 */
export function apply(ctx, config = {}) {
  const cfg = normalizeConfig(config)
  const home = process.env['DSH_HOME'] ?? join(homedir(), '.dsh')

  /** 把一行诊断写到 $DSH_HOME/cache/dsh-latex/<file>；写不出去不影响功能。 */
  const diagnostic = (file, payload) => {
    try {
      writeFileSync(join(home, 'cache', 'dsh-latex', file), JSON.stringify({
        at: new Date().toISOString(),
        hostPid: process.pid,
        ...payload,
      }, null, 2))
    } catch {
      // 诊断写不出去不影响功能
    }
  }

  // 诊断：宿主半是否真的挂上了、配置与提示词长度。
  try {
    const dir = join(home, 'cache', 'dsh-latex')
    mkdirSync(dir, { recursive: true })
    const rendered = buildPrompt(cfg)
    writeFileSync(join(dir, 'mounted.json'), JSON.stringify({
      at: new Date().toISOString(),
      pid: process.pid,
      section: SECTION_NAME,
      mode: cfg.mode,
      order: cfg.order,
      config: cfg,
      promptChars: rendered.length,
    }, null, 2))
    writeFileSync(join(dir, 'prompt.txt'), rendered)
  } catch {
    // 诊断写不出去不影响提示词注入
  }

  if (typeof ctx.logger?.info === 'function') {
    ctx.logger.info('[dsh-latex] math output convention: mode=' + cfg.mode + ', section="' + SECTION_NAME + '", order ' + cfg.order)
  }

  // 段注册分两条路径：
  //   always → 全局段，每个会话、每一步都带；
  //   auto   → 不注册全局段，等检测到数学话题后按会话注册。
  if (cfg.mode === 'always') {
    // text 用函数形式：每步组装时求值，配置变化（热重载）后无需重新注册。
    ctx.systemPrompt.section({
      name: SECTION_NAME,
      order: cfg.order,
      text: () => buildPrompt(cfg),
    })
  } else if (cfg.mode === 'auto') {
    attachAutoInjector(ctx, cfg, diagnostic)
  }

  // 浏览器半自检：它 apply 时会 ping 这个通道，我们记一笔。
  // 这样「插件到底有没有进页面」有磁盘证据，不用靠猜。
  // connection 的 rpc.handle 内部要访问 webServer，所以两个服务都必须注入，
  // 否则会抛 "cannot get property \"webServer\" without inject"。
  if (typeof ctx.inject === 'function') ctx.inject(['connection', 'webServer'], web => {
    const connection = web.connection
    const rpc = connection?.rpc
    if (connection === undefined || connection === null) {
      diagnostic('rpc.json', { state: 'no-connection-service' })
      return
    }
    if (typeof rpc?.handle !== 'function') {
      diagnostic('rpc.json', {
        state: 'no-rpc-handle',
        keys: typeof connection === 'object' ? Object.keys(connection) : [],
      })
      return
    }
    try {
      rpc.handle('/dsh-latex', async (endpoint, payload) => {
        if (endpoint !== 'ping') {
          return { ok: false, error: { code: 'bad-request', message: 'unknown endpoint: ' + String(endpoint) } }
        }
        diagnostic('client-mounted.json', {
          href: typeof payload?.href === 'string' ? payload.href : null,
          userAgent: typeof payload?.userAgent === 'string' ? payload.userAgent : null,
        })
        return { ok: true, value: { pong: true, at: new Date().toISOString() } }
      }, { authority: 'loopback' })
      diagnostic('rpc.json', { state: 'registered', channel: '/dsh-latex' })
    } catch (error) {
      diagnostic('rpc.json', { state: 'register-failed', error: String(error?.message ?? error) })
    }
  })

  // 客户端图自检：浏览器半只有被 clientModules 扫描进图才会加载。
  // 把「图里有没有本包」写成磁盘证据，加载问题就不用靠猜。
  if (typeof ctx.inject === 'function') ctx.inject(['clientModules'], web => {
    try {
      const clientModules = web.clientModules
      const graph = typeof clientModules?.graph === 'function' ? clientModules.graph() : undefined
      const rows = Array.isArray(graph?.entries) ? graph.entries : []
      const ids = rows.map(row => String(row?.id ?? row?.name ?? ''))
      const clientPath = typeof clientModules?.clientPath === 'function'
        ? clientModules.clientPath('dsh-latex')
        : undefined
      writeFileSync(join(home, 'cache', 'dsh-latex', 'client-graph.json'), JSON.stringify({
        at: new Date().toISOString(),
        hostPid: process.pid,
        hasEntry: ids.includes('dsh-latex'),
        clientPath: typeof clientPath === 'string' ? clientPath : null,
        graphRev: graph?.rev ?? null,
        entries: ids,
      }, null, 2))
    } catch (error) {
      try {
        writeFileSync(join(home, 'cache', 'dsh-latex', 'client-graph.json'), JSON.stringify({
          at: new Date().toISOString(),
          hostPid: process.pid,
          error: String(error?.message ?? error),
        }, null, 2))
      } catch {
        // 诊断写不出去不影响功能
      }
    }
  })
}

/**
 * auto 模式：只在会话里出现数学话题后注入。
 *
 * 通过 `agent/pre-step` 拿到本步进入的消息，命中数学信号后在该会话的
 * `agent.ctx.systemPrompt` 上注册作用域段——只影响这个会话，随会话释放。
 * 同一会话只注册一次（WeakSet 记已注册的 agent）。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {ReturnType<typeof normalizeConfig>} cfg
 * @param {(file: string, payload: Record<string, unknown>) => void} diagnostic
 */
function attachAutoInjector(ctx, cfg, diagnostic) {
  const registeredAgents = new WeakSet()
  const disposers = []
  let registered = 0

  /**
   * 给一个会话注册段。已注册过的直接跳过。
   * @param {unknown} agent
   * @returns {boolean}
   */
  function registerForAgent(agent) {
    if (agent === undefined || agent === null) return false
    if (registeredAgents.has(agent)) return false
    registeredAgents.add(agent)

    const scoped = agent.ctx?.systemPrompt
    if (scoped === undefined || scoped === null || typeof scoped.section !== 'function') {
      diagnostic('auto.json', { state: 'agent-without-scope', registered })
      return false
    }
    try {
      const dispose = scoped.section({
        name: SECTION_NAME,
        order: cfg.order,
        text: () => buildPrompt(cfg),
      })
      if (typeof dispose === 'function') disposers.push(dispose)
      registered += 1
      diagnostic('auto.json', { state: 'registered', registered })
      return true
    } catch (error) {
      diagnostic('auto.json', { state: 'register-failed', error: String(error?.message ?? error), registered })
      return false
    }
  }

  if (typeof ctx.on === 'function') {
    ctx.on('agent/pre-step', async (payload, next) => {
      try {
        const messages = Array.isArray(payload?.messages) ? payload.messages : []
        const text = messages.map(textOfMessage).join('\n')
        if (looksLikeMath(text)) registerForAgent(payload?.agent)
      } catch {
        // 检测失败不影响本步
      }
      return typeof next === 'function' ? await next() : undefined
    })
  }

  // 插件热重载时把已注册的作用域段收回去，避免重挂后重名/残留。
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      for (const dispose of disposers) {
        try { dispose() } catch { /* 已随会话释放 */ }
      }
      disposers.length = 0
    })
  }

  diagnostic('auto.json', { state: 'armed', registered: 0 })
}
