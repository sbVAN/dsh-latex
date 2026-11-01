/**
 * dsh-latex —— 浏览器半。
 *
 * 前端（@deepseek-ai/dsh-client-ui-primitives 的 MarkdownText）本来就支持
 * `$...$` / `$$...$$` / \(...\) / \[...\] 和 ```math 代码块，唯一不渲染的是
 * ```latex / ```tex 代码块。这一半做四件小事：
 *
 *   1. 排版增强：宽公式横向滚动、KaTeX 报错不再是刺眼的裸红字；
 *   2. 代码块兜底：把 .md-code-block 里标记为 latex / tex 的公式，复用前端
 *      自己的 MarkdownText 渲染成真公式（默认折叠源码，可一键展开）；
 *   3. 复制：公式的复制走 KaTeX 自带的 MathML 注释
 *      （`<annotation encoding="application/x-tex">`）里的原始源码，
 *      块级公式右上角有 hover 按钮，选中公式按 Ctrl+C 也会得到干净源码，
 *      而不是渲染后那堆带换行的 span 文本；
 *   4. 复制：latex 代码块兜底预览的工具条同样复制原始源码。
 *
 * 不打包 KaTeX：统一基座里的 `@deepseek-ai/dsh-client-ui-primitives` 已经带着
 * 它，import 同一个模块既省体积又保证与全站排版一致。
 *
 * 代码块的 DOM 形如：
 *   div.md-code-block
 *     div[data-code-block-banner] > span（语言标签）/ 按钮
 *     pre.shiki.css-variables > code > span.line × n
 * 注意：语言只写在头部标签文本里，pre/code 上没有 language-* 类名，
 * 所以选择器必须以 .md-code-block 为锚点，源码按 span.line 拼接。
 */

window.__ModuleLoader__.load({
  id: 'dsh-latex',
  factory: (require) => {
    const module = { exports: {} }

    // 统一基座里的共享模块：任何一个缺失都只降级，绝不让整个页面 boot 失败。
    const optional = (specifier) => {
      try { return require(specifier) } catch { return null }
    }
    const React = optional('react')
    const ReactDomClient = optional('react-dom/client')
    const primitives = optional('@deepseek-ai/dsh-client-ui-primitives')
    const createRoot = typeof ReactDomClient?.createRoot === 'function' ? ReactDomClient.createRoot : null
    const canRender = React !== null && createRoot !== null && typeof primitives?.MarkdownText === 'function'

    /** 只处理这两种语言标记；`math` 由前端自己渲染，不重复插手。 */
    const LATEX_LANGS = new Set(['latex', 'tex'])

    const CSS = [
      /* ---- KaTeX 排版增强 ---- */
      '.katex-display{position:relative;max-width:100%;overflow-x:auto;overflow-y:hidden;padding-bottom:2px;scrollbar-width:thin;}',
      '.katex-display::-webkit-scrollbar{height:6px;}',
      '.katex-display::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2,#c9c9c9);border-radius:3px;}',
      '.katex-display::-webkit-scrollbar-track{background:transparent;}',
      '.katex-display>.katex{white-space:nowrap;}',
      /* 块级公式右上角的「复制 LaTeX」：hover 才出现，不打扰阅读 */
      '.dsh-latex-copy{position:absolute;top:2px;right:2px;opacity:0;pointer-events:none;',
      'transition:opacity .15s ease;appearance:none;border:1px solid var(--dsw-alias-border-l1,#dcdcdc);',
      'background:var(--dsw-alias-bg-overlay,rgba(255,255,255,.94));color:var(--dsw-alias-label-secondary,#8a8a8a);',
      'border-radius:6px;padding:0 8px;font-size:12px;line-height:20px;cursor:pointer;',
      'box-shadow:0 1px 4px rgba(0,0,0,.12);}',
      '.katex-display:hover>.dsh-latex-copy,.dsh-latex-copy:focus-visible{opacity:1;pointer-events:auto;}',
      '.dsh-latex-copy[data-state="ok"]{color:var(--dsw-alias-state-success-primary,#1a7f37);border-color:currentColor;}',
      /* KaTeX 解析失败：红字 → 带底色的错误徽标，仍然可读、可复制 */
      '.katex-error{display:inline-block;max-width:100%;overflow-x:auto;vertical-align:baseline;',
      'padding:1px 6px;border-radius:6px;font-size:.92em;font-family:var(--dsw-font-mono,ui-monospace,monospace);',
      'color:var(--dsw-alias-state-error-primary,#cf222e);',
      'background:rgba(207,34,46,.08);',
      'border:1px solid rgba(207,34,46,.28);}',
      /* 整段文字解析失败时不要铺成一整块红板：折叠成 3 行，点一下展开 */
      '.katex-error.dsh-latex-error-long{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;',
      'overflow:hidden;cursor:zoom-in;}',
      '.katex-error.dsh-latex-error-open{display:inline-block;-webkit-line-clamp:unset;overflow:auto;cursor:zoom-out;}',
      /* ---- latex 代码块兜底 ---- */
      '.dsh-latex-host{margin:10px 0;display:flex;flex-direction:column;gap:6px;}',
      '.dsh-latex-preview{border:1px solid var(--dsw-alias-border-l1,#e6e6e6);border-radius:10px;',
      'background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.05));padding:10px 14px;overflow-x:auto;}',
      '.dsh-latex-preview .katex-display{margin:0;}',
      '.dsh-latex-bar{display:flex;align-items:center;gap:10px;font-size:12px;line-height:18px;',
      'color:var(--dsw-alias-label-secondary,#8a8a8a);}',
      '.dsh-latex-btn{appearance:none;border:1px solid var(--dsw-alias-border-l1,#dcdcdc);background:transparent;',
      'color:inherit;border-radius:6px;padding:1px 8px;font:inherit;cursor:pointer;transition:background .15s ease;}',
      '.dsh-latex-btn:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12));}',
      '.dsh-latex-btn[data-state="ok"]{color:var(--dsw-alias-state-success-primary,#1a7f37);border-color:currentColor;}',
      '.dsh-latex-note{opacity:.85;}',
      '.dsh-latex-source-hidden{display:none!important;}',
    ].join('')

    /** 幂等注入样式表。 */
    function injectStyle() {
      if (document.querySelector('style[data-plugin="dsh-latex"]') !== null) return
      const style = document.createElement('style')
      style.dataset.plugin = 'dsh-latex'
      style.textContent = CSS
      document.head.appendChild(style)
    }

    /**
     * 读代码块的语言标记：只存在于头部标签里。
     * 高亮可用时是原始 lang（latex / tex），否则是通用「代码」文案。
     */
    function readLang(block) {
      const banner = block.querySelector('[data-code-block-banner]')
      if (banner !== null) {
        const first = banner.querySelector('span')
        const text = (first?.textContent ?? '').trim().toLowerCase()
        if (text !== '') return text
      }
      const pre = block.querySelector('pre')
      const fromData = pre?.getAttribute('data-language') ?? pre?.getAttribute('data-lang')
      return typeof fromData === 'string' ? fromData.toLowerCase() : ''
    }

    /**
     * 取源码。shiki 的 span.line 之间没有换行文本节点，pre.textContent 会
     * 把多行公式粘成一行，所以优先按行拼接；plain 路径没有 line 节点时回退。
     */
    function readSource(block) {
      const pre = block.querySelector('pre')
      if (pre === null) return ''
      const lines = pre.querySelectorAll('span.line')
      const raw = lines.length > 0
        ? Array.from(lines, line => line.textContent ?? '').join('\n')
        : (pre.querySelector('code') ?? pre).textContent ?? ''
      return String(raw).replace(/\r\n/g, '\n').replace(/\n+$/, '')
    }

    /** 源码里若自带 $$，包一层之前先转义，避免把外层定界符闭合掉。 */
    function wrapMath(source) {
      return '$$\n' + source.replace(/\$\$/g, '\\$\\$') + '\n$$'
    }

    function unmountQuietly(root) {
      try { root.unmount() } catch { /* 已卸载或未挂载 */ }
    }

    /**
     * 每个 .md-code-block 一条记录：DOM 宿主、React root、上一次源码。
     * 用 Map 而不是 WeakMap，因为需要枚举来做孤儿清理。
     */
    const entries = new Map()
    let timer = null

    function renderPreview(entry) {
      entry.root.render(React.createElement(primitives.MarkdownText, {
        text: wrapMath(entry.source),
        streaming: false,
      }))
    }

    /** 原生 DOM 做工具条：不经过 React，重渲染也不会丢按钮。 */
    function buildBar(entry) {
      const bar = document.createElement('div')
      bar.className = 'dsh-latex-bar'

      const toggle = document.createElement('button')
      toggle.type = 'button'
      toggle.className = 'dsh-latex-btn'
      toggle.textContent = '显示源码'
      toggle.addEventListener('click', () => {
        const hidden = entry.block.classList.toggle('dsh-latex-source-hidden')
        toggle.textContent = hidden ? '显示源码' : '隐藏源码'
      })

      const copy = document.createElement('button')
      copy.type = 'button'
      copy.className = 'dsh-latex-btn'
      copy.textContent = '复制 LaTeX'
      copy.addEventListener('click', () => {
        const clipboard = navigator.clipboard
        if (!clipboard?.writeText) return
        void clipboard.writeText(entry.source).then(() => {
          copy.textContent = '已复制'
          copy.dataset.state = 'ok'
          setTimeout(() => {
            copy.textContent = '复制 LaTeX'
            delete copy.dataset.state
          }, 1500)
        }).catch(() => { /* 剪贴板被拒绝时保持原样 */ })
      })

      const note = document.createElement('span')
      note.className = 'dsh-latex-note'
      note.textContent = '已按公式渲染'

      bar.append(toggle, copy, note)
      return bar
    }

    /**
     * 取 KaTeX 公式的原始 LaTeX 源码。
     * KaTeX 的 HTML 输出里带 MathML，`<annotation encoding="application/x-tex">`
     * 保存着渲染前的原文——这正是「选中复制会得到一堆换行」时该拿的东西。
     * @param {Element | null | undefined} node
     * @returns {string | null}
     */
    function texSourceOf(node) {
      if (node === null || node === undefined) return null
      // 传进来的可能是 `.katex` 本身、它内部的一个文本节点父元素，
      // 也可能是包着 `.katex` 的 `.katex-display`——三种都要能找到公式。
      const katex = typeof node.matches === 'function' && node.matches('.katex')
        ? node
        : (node.closest?.('.katex') ?? node.querySelector?.('.katex') ?? null)
      if (katex === null) return null
      const annotation = katex.querySelector('annotation[encoding="application/x-tex"]')
      if (annotation === null) return null
      const text = annotation.textContent
      return typeof text === 'string' && text.trim() !== '' ? text.trim() : null
    }

    /**
     * 给每个块级公式挂一个 hover 出现的「复制 LaTeX」。
     * 幂等：按钮已存在就跳过；React 重渲染冲掉后下一轮扫描会补挂。
     */
    function decorateDisplayMath() {
      const displays = document.querySelectorAll('.katex-display')
      for (const display of displays) {
        // 代码块兜底预览里已经有自己的复制按钮，不重复挂。
        if (display.closest('.dsh-latex-preview') !== null) continue
        if (display.querySelector(':scope > .dsh-latex-copy') !== null) continue
        const source = texSourceOf(display)
        if (source === null) continue

        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'dsh-latex-copy'
        button.textContent = '复制 LaTeX'
        button.title = '复制这段公式的 LaTeX 源码'
        button.addEventListener('click', (event) => {
          event.stopPropagation()
          const clipboard = navigator.clipboard
          if (!clipboard?.writeText) return
          void clipboard.writeText(source).then(() => {
            button.textContent = '已复制'
            button.dataset.state = 'ok'
            setTimeout(() => {
              button.textContent = '复制 LaTeX'
              delete button.dataset.state
            }, 1500)
          }).catch(() => { /* 剪贴板被拒绝时保持原样 */ })
        })
        display.appendChild(button)
      }
    }

    /**
     * 整段文字被当成公式解析失败时，KaTeX 会把全文塞进一个 `.katex-error`，
     * 配上错误底色就是一整屏红板。超过阈值的折成 3 行、点击展开；
     * 短错误保持原来的小徽标。只加 class、不改文本，React 重渲染也不会丢源码。
     */
    function decorateErrors() {
      const errors = document.querySelectorAll('.katex-error')
      for (const error of errors) {
        if (error.classList.contains('dsh-latex-error-open')) continue
        const text = error.textContent ?? ''
        if (text.length <= 220) continue
        if (!error.classList.contains('dsh-latex-error-long')) {
          error.classList.add('dsh-latex-error-long')
          error.title = 'LaTeX 解析失败，点击展开完整源码'
        }
        if (error.dataset.dshLatexErrorClick === '1') continue
        error.dataset.dshLatexErrorClick = '1'
        error.addEventListener('click', () => {
          const open = error.classList.toggle('dsh-latex-error-open')
          error.classList.toggle('dsh-latex-error-long', !open)
          error.title = open ? '点击收起' : 'LaTeX 解析失败，点击展开完整源码'
        })
      }
    }

    /**
     * 选中渲染后的公式再 Ctrl+C 时，把剪贴板换成原始 LaTeX。
     * 选区必须完整落在同一个 `.katex` 里才接管，跨公式/跨正文的复制保持原生行为。
     * @param {{ effect?: (fn: () => () => void) => void }} ctx
     */
    function installCopyHook(ctx) {
      if (window.__dshLatexCopyHook !== undefined) return
      const handler = (event) => {
        try {
          const selection = document.getSelection()
          if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return
          const from = selection.anchorNode
          const to = selection.focusNode
          if (from === null || to === null) return
          const fromElement = from.nodeType === 1 ? from : from.parentElement
          const toElement = to.nodeType === 1 ? to : to.parentElement
          const fromKatex = fromElement?.closest?.('.katex')
          const toKatex = toElement?.closest?.('.katex')
          if (fromKatex === undefined || fromKatex === null || fromKatex !== toKatex) return
          const source = texSourceOf(fromKatex)
          if (source === null) return
          event.clipboardData?.setData('text/plain', source)
          event.preventDefault()
        } catch {
          // 选区结构异常时交回浏览器默认行为
        }
      }
      document.addEventListener('copy', handler, true)
      window.__dshLatexCopyHook = handler
      if (typeof ctx?.effect === 'function') {
        ctx.effect(() => () => {
          document.removeEventListener('copy', handler, true)
          delete window.__dshLatexCopyHook
        })
      }
    }

    function processBlock(block) {
      const lang = readLang(block)
      if (!LATEX_LANGS.has(lang)) return

      const source = readSource(block)
      if (source.trim() === '') return

      const existing = entries.get(block)
      if (existing) {
        if (existing.source !== source) {
          existing.source = source
          renderPreview(existing)
        }
        return
      }

      const host = document.createElement('div')
      host.className = 'dsh-latex-host'
      const preview = document.createElement('div')
      preview.className = 'dsh-latex-preview'
      host.append(preview)

      const entry = { block, host, source, root: createRoot(preview) }
      entries.set(block, entry)
      renderPreview(entry)
      host.append(buildBar(entry))

      // 插在原代码块之后，并默认折叠源码。
      block.after(host)
      block.classList.add('dsh-latex-source-hidden')
    }

    /** 全量扫描；批量处理比逐个观察便宜，300ms 防抖足以避开流式的每个 token。 */
    function flush() {
      timer = null
      if (!canRender) return

      for (const [block, entry] of entries) {
        if (!block.isConnected || !entry.host.isConnected) {
          unmountQuietly(entry.root)
          entries.delete(block)
        }
      }

      const blocks = document.querySelectorAll('.md-code-block')
      for (const block of blocks) processBlock(block)
      decorateDisplayMath()
      decorateErrors()
    }

    function schedule() {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(flush, 300)
    }

    /**
     * 自检：把「浏览器半真的跑起来了」通过 Host RPC 记到
     * $DSH_HOME/cache/dsh-latex/client-mounted.json，方便排查加载问题。
     * apply 时连接通道可能还没就绪，所以失败后退避重试几次；仍失败就静默。
     */
    function report(connection) {
      let attempt = 0
      const ping = () => {
        attempt += 1
        try {
          const result = connection.rpc.call('/dsh-latex', 'ping', {
            href: String(location.href),
            userAgent: String(navigator.userAgent),
          })
          void Promise.resolve(result).then(reply => {
            if (reply?.ok === false && attempt < 5) setTimeout(ping, 1000 * attempt)
          }).catch(() => {
            if (attempt < 5) setTimeout(ping, 1000 * attempt)
          })
        } catch {
          if (attempt < 5) setTimeout(ping, 1000 * attempt)
        }
      }
      ping()
    }

    function apply(ctx) {
      injectStyle()
      installCopyHook(ctx)
      if (ctx?.connection?.rpc !== undefined) report(ctx.connection)
      if (!canRender || document.body === null) return

      // 只观察元素与文本变化；代码块落定后才会出现稳定的 .md-code-block。
      const observer = new MutationObserver(schedule)
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      })
      // HMR 重挂时断开旧观察器，避免叠加。
      if (typeof ctx?.effect === 'function') {
        ctx.effect(() => () => {
          observer.disconnect()
          if (timer !== null) clearTimeout(timer)
        })
      }
      schedule()
    }

    module.exports.inject = ['connection']
    module.exports.apply = apply
    return module.exports
  },
})
