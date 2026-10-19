/**
 * dsh-latex —— 宿主半。
 *
 * 唯一职责：往每步组装的系统提示词里注入一段「公式用 LaTeX 写」的规范。
 * 渲染侧（浏览器半）不做任何模型可见的事情，所以这个包对 KV cache 的影响
 * 只是提示词变长，且位置稳定、只追加在工具引导之后。
 *
 * 扩展点来自 @deepseek-ai/dsh-system-prompt 的 `ctx.systemPrompt.section()`：
 * 注册随当前插件 fiber 一起 dispose，热重载不会留下重复段。
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { buildPrompt, normalizeConfig } from './prompt.js'

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

  // 诊断：宿主半是否真的挂上了、实际注入的文本长什么样。
  // 不写这个文件也不影响功能，所以整段吞异常。
  try {
    const dir = join(home, 'cache', 'dsh-latex')
    mkdirSync(dir, { recursive: true })
    const rendered = buildPrompt(cfg)
    writeFileSync(join(dir, 'mounted.json'), JSON.stringify({
      at: new Date().toISOString(),
      pid: process.pid,
      section: SECTION_NAME,
      order: cfg.order,
      config: cfg,
      promptChars: rendered.length,
    }, null, 2))
    writeFileSync(join(dir, 'prompt.txt'), rendered)
  } catch {
    // 诊断写不出去不影响提示词注入
  }

  if (typeof ctx.logger?.info === 'function') {
    ctx.logger.info('[dsh-latex] math output convention injected as "' + SECTION_NAME + '" (order ' + cfg.order + ')')
  }

  // text 用函数形式：每步组装时求值，配置变化（热重载）后无需重新注册。
  ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: cfg.order,
    text: () => (cfg.enabled ? buildPrompt(cfg) : ''),
  })

  // 浏览器半自检：它 apply 时会 ping 这个通道，我们记一笔。
  // 这样「插件到底有没有进页面」有磁盘证据，不用靠猜。
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
