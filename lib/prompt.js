/**
 * dsh-latex —— 输出规范文本。
 *
 * 这里只放「模型可见」的东西：一段系统提示词，告诉模型在回答里用
 * `$...$` / `$$...$$` 写公式，而不是把公式塞进 ```latex 代码块。
 * 文案全部是纯字符串拼接，避免模板字符串里反引号与 `$$` 的转义地狱。
 */

export const DEFAULT_CONFIG = Object.freeze({
  /** 'auto' | 'always' | 'off'：auto 只在检测到数学话题后注入。 */
  mode: 'auto',
  /** 兼容旧配置：false 等价于 mode: 'off'。 */
  enabled: true,
  /** 'auto' | 'zh' | 'en'。auto 跟随环境，默认中文。 */
  locale: 'auto',
  /** true = 明确禁止代码块写公式；false = 只建议，不禁用。 */
  strict: true,
  /** true = 只注入精简版（约 1/3 token）。 */
  compact: false,
  /** 系统提示词里的排序位置；工具引导占用 100–199。 */
  order: 145,
  /** 追加到规范末尾的自定义条目，每条一句。 */
  extraRules: [],
})

const ZH_TITLE = '## 数学与物理公式：一律用 LaTeX 排版'
const ZH_LEAD =
  '回答中出现任何数学表达式、物理量、公式或推导时，用 LaTeX 直接写，交给界面渲染，不要写成代码块。'

const ZH_RULES = [
  '1. 行内公式用 `$...$`，例如 $E=mc^2$、$\\nabla\\cdot\\mathbf{E}=\\rho/\\varepsilon_0$。',
  '2. 独立公式单独成行用 `$$...$$`，前后各留一个空行。',
  '3. 禁止把公式放进 `latex`、`tex`、`math` 代码块；只有用户明确索要 LaTeX 源码时才用代码块。',
  '4. 渲染器是 KaTeX，只使用它支持的写法：',
  '   - 多行推导用 `\\begin{aligned}...\\end{aligned}`，不要用 align、eqnarray、split、gather；',
  '   - 矩阵用 pmatrix、bmatrix、vmatrix；分段函数用 cases；',
  '   - 单位与常量写成 `\\mathrm{m/s^2}`，不要用 \\si{}、\\pu{}、\\ce{}；',
  '   - 公式内不写中文，必要的文字放 `\\text{...}` 或移到公式外；',
  '   - 不用 \\label、\\tag、\\eqref、\\ref。',
  '5. 超长推导拆成多个 `$$` 块，一行一个等式；同一行不要塞多个独立公式。',
  '6. 代码里的表达式仍留在代码块里，不要转成 LaTeX。',
  '7. 表格单元格里的公式不要出现裸 `|`——Markdown 表格会把它当列分隔符，把公式切成几块不渲染。绝对值/模一律写 `\\vert`（或 `\\lvert ... \\rvert`），例如 $\\oint_{\\lvert z\\rvert=1}\\dfrac{dz}{z}$；含竖线或很长的公式请放到表格外单独成段。',
  '8. 定界符必须成对且不嵌套：每个 `$` 都要有配对的 `$`，每个 `$$` 都要有配对的 `$$`；不要把成段的中文说明塞进公式；相邻公式之间留空行，避免解析器把周围文字并进同一个公式。',
]

const ZH_LOOSE_RULE =
  '3. 优先用 LaTeX 排版；把 LaTeX 放进代码块可以接受，但界面上只会显示成代码。'

const EN_LOOSE_RULE =
  '3. Prefer typeset LaTeX over fenced code blocks; fenced LaTeX source is acceptable but renders as code.'

const ZH_EXAMPLE = [
  '示例：质能关系 $E=mc^2$；勾股定理写成',
  '$$',
  'a^2+b^2=c^2',
  '$$',
]

const ZH_COMPACT = [
  ZH_TITLE,
  '',
  '公式一律用 LaTeX：行内 `$...$`，独立公式 `$$...$$` 单独成行、前后空行。',
  '不要用 `latex`/`tex`/`math` 代码块包公式；多行推导用 `\\begin{aligned}`，不用 align；公式内不写中文。',
  '表格内的公式不要有裸 `|`，绝对值写 `\\vert`，否则表格会把公式切碎。',
  '`$` 与 `$$` 必须成对，不要把成段文字塞进公式。',
]

const EN_TITLE = '## Math and physics: always typeset with LaTeX'
const EN_LEAD =
  'Whenever the answer contains a mathematical expression, physical quantity, formula, or derivation, write LaTeX directly and let the interface render it. Do not wrap formulae in fenced code blocks.'

const EN_RULES = [
  '1. Inline math uses `$...$`, e.g. $E=mc^2$ or $\\nabla\\cdot\\mathbf{E}=\\rho/\\varepsilon_0$.',
  '2. Display math uses `$$...$$` on its own line, with a blank line before and after.',
  '3. Never put formulae inside `latex`, `tex`, or `math` code fences; use a fence only when the user explicitly asks for LaTeX source.',
  '4. The renderer is KaTeX, so stay inside its supported subset:',
  '   - multi-line derivations use `\\begin{aligned}...\\end{aligned}`, never align, eqnarray, split, or gather;',
  '   - matrices use pmatrix, bmatrix, vmatrix; piecewise definitions use cases;',
  '   - units and constants use `\\mathrm{m/s^2}`, never \\si{}, \\pu{}, or \\ce{};',
  '   - no CJK characters inside math; put prose in `\\text{...}` or outside the formula;',
  '   - no \\label, \\tag, \\eqref, or \\ref.',
  '5. Split long derivations into several `$$` blocks, one equation per line.',
  '6. Expressions that belong to code stay inside the code block.',
  '7. Never put a bare `|` inside a formula that sits in a table cell — Markdown reads it as a column separator and cuts the formula into pieces that do not render. Write absolute value / modulus as `\\vert` (or `\\lvert ... \\rvert`), e.g. $\\oint_{\\lvert z\\rvert=1}\\dfrac{dz}{z}$; move formulae that need bars, or that are long, out of the table.',
  '8. Delimiters must be paired and not nested: every `$` needs a matching `$`, every `$$` a matching `$$`; never put paragraphs of prose inside a formula; leave a blank line between adjacent formulae so the parser cannot swallow surrounding text into one node.',
]

const EN_EXAMPLE = [
  'Example: mass-energy equivalence $E=mc^2$; Pythagoras as',
  '$$',
  'a^2+b^2=c^2',
  '$$',
]

const EN_COMPACT = [
  EN_TITLE,
  '',
  'Always typeset math with LaTeX: inline `$...$`, display `$$...$$` on its own line with blank lines around it.',
  'Never use `latex`/`tex`/`math` code fences for formulae; multi-line derivations use `\\begin{aligned}`, not align; no CJK inside math.',
  'No bare `|` inside a formula in a table cell — write `\\vert`, or the table will cut the formula apart.',
  'Pair every `$` and `$$`; never put a paragraph inside a formula.',
]

/** 把未知/越界的配置收敛成一份可用的配置。 */
export function normalizeConfig(input) {
  const raw = input && typeof input === 'object' ? input : {}
  const localeRaw = String(raw.locale ?? DEFAULT_CONFIG.locale).toLowerCase()
  const locale = localeRaw === 'zh' || localeRaw === 'en' ? localeRaw : 'auto'
  const extraRules = Array.isArray(raw.extraRules)
    ? raw.extraRules.filter(rule => typeof rule === 'string' && rule.trim() !== '').map(rule => String(rule).trim())
    : []
  const orderNumber = Number(raw.order)
  const order = Number.isFinite(orderNumber) && orderNumber >= 0 && orderNumber <= 999
    ? orderNumber
    : DEFAULT_CONFIG.order
  const modeRaw = String(raw.mode ?? DEFAULT_CONFIG.mode).toLowerCase()
  const mode = raw.enabled === false
    ? 'off'
    : modeRaw === 'always' || modeRaw === 'off'
      ? modeRaw
      : 'auto'
  return {
    mode,
    enabled: mode !== 'off',
    locale,
    strict: raw.strict !== false,
    compact: raw.compact === true,
    order,
    extraRules,
  }
}

/** 块级公式：$$ ... $$ */
const BLOCK_MATH_RE = /\$\$[\s\S]*?\$\$/

/** \(...\) 与 \[...\] */
const BRACKET_MATH_RE = /\\\(|\\\[/

/** KaTeX/LaTeX 命令：足够识别「这是公式」，又不误伤 Windows 路径（\Users）。 */
const TEX_COMMAND_RE = /\\(?:frac|dfrac|tfrac|sqrt|sum|prod|int|iint|oint|lim|log|ln|sin|cos|tan|cot|sec|csc|exp|partial|nabla|cdot|times|pm|mp|infty|alpha|beta|gamma|delta|epsilon|varepsilon|theta|lambda|mu|nu|xi|pi|rho|sigma|tau|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Pi|Sigma|Phi|Psi|Omega|begin\{|matrix|pmatrix|bmatrix|vmatrix|cases|aligned|left|right|mathrm|mathbf|mathit|mathcal|mathbb|text|vec|hat|bar|overline|underline|vert|lvert|rvert)/

/** 中文数学话题词。宁可多注入一段短提示，也不要漏掉该排版的时候。 */
const CJK_MATH_RE = /(公式|方程|等式|不等式|函数|积分|微分|导数|偏导|求导|极限|级数|矩阵|行列式|特征值|特征向量|向量|张量|概率|期望|方差|标准差|分布|傅里叶|拉普拉斯|泰勒|麦克劳林|收敛|发散|渐近|求积|解方程|证明|定理|引理|推论|判别式|多项式|因式分解|三角函数|正弦|余弦|正切|对数|指数函数|复数|虚数|共轭|留数|支点|围道|格林公式|斯托克斯|高斯定理|麦克斯韦|薛定谔|哈密顿|拉格朗日|微分方程|线性代数|微积分|数学|物理|化学式|量纲|单位换算)/

/** 英文数学话题词。 */
const EN_MATH_RE = /\b(?:latex|katex|mathjax|equation|integral|derivative|differential|matrix|determinant|eigenvalue|vector|tensor|probability|theorem|proof|lemma|corollary|fourier|laplace|taylor|series|convergence|polynomial|geometry|trigonometry)\b/i

/**
 * 行内公式：`$...$` 里必须带 TeX 特征（反斜杠命令、上下标、花括号或等号），
 * 或者内容就是单个字母——用来排除 `$PATH`、`$5 和 $10` 这类金额/变量名。
 * @param {string} text
 * @returns {boolean}
 */
function hasInlineMath(text) {
  const pattern = /\$(?!\$)(?!\s)([^$\n]{1,200})(?<!\s)\$/g
  for (const match of text.matchAll(pattern)) {
    const body = match[1]
    if (body === undefined) continue
    if (/\\[a-zA-Z]+/.test(body)) return true
    if (/[\^_{}=]/.test(body)) return true
    if (/^[a-zA-Z]$/.test(body)) return true
  }
  return false
}

/**
 * 这段文本是否像「需要公式排版」的内容。
 * 只用于 auto 模式的注入判定：命中一次就为整个会话开启，不追求精确。
 * @param {unknown} text
 * @returns {boolean}
 */
export function looksLikeMath(text) {
  if (typeof text !== 'string' || text === '') return false
  if (BLOCK_MATH_RE.test(text)) return true
  if (BRACKET_MATH_RE.test(text)) return true
  if (TEX_COMMAND_RE.test(text)) return true
  if (CJK_MATH_RE.test(text)) return true
  if (EN_MATH_RE.test(text)) return true
  return hasInlineMath(text)
}

/**
 * 从一条消息里取出纯文本。content 可能是字符串，也可能是分段数组。
 * @param {unknown} message
 * @returns {string}
 */
export function textOfMessage(message) {
  if (typeof message === 'string') return message
  const content = message?.content ?? message?.text
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(part => (typeof part === 'string' ? part : (typeof part?.text === 'string' ? part.text : '')))
      .join('\n')
  }
  return ''
}

/** 环境语言 → 'zh' | 'en'；Windows 中文默认走 zh。 */
function resolveLocale(locale) {
  if (locale === 'zh' || locale === 'en') return locale
  const envLocale = String(
    process.env['DSH_LOCALE'] ?? process.env['LANG'] ?? process.env['LANGUAGE'] ?? '',
  ).toLowerCase()
  if (envLocale.startsWith('en')) return 'en'
  return 'zh'
}

/**
 * strict=false 时把第 3 条换成「优先」措辞。
 * 用前缀匹配而不是下标，模板增删条目时不会错位。
 * @param {readonly string[]} rules
 * @param {string} looseRule
 * @returns {string[]}
 */
function relaxRule(rules, looseRule) {
  return rules.map(rule => (rule.startsWith('3. ') ? looseRule : rule))
}

/**
 * 生成注入系统提示词的文本。
 * @param {ReturnType<typeof normalizeConfig>} cfg
 * @returns {string} 以换行分隔的提示词段；保留末尾换行便于拼接。
 */
export function buildPrompt(cfg) {
  if (!cfg.enabled) return ''
  const locale = resolveLocale(cfg.locale)
  const lines = []

  if (cfg.compact) {
    lines.push(...(locale === 'en' ? EN_COMPACT : ZH_COMPACT))
  } else if (locale === 'en') {
    lines.push(EN_TITLE, '', EN_LEAD, '', ...(cfg.strict ? EN_RULES : relaxRule(EN_RULES, EN_LOOSE_RULE)))
    lines.push('', ...EN_EXAMPLE)
  } else {
    lines.push(ZH_TITLE, '', ZH_LEAD, '', ...(cfg.strict ? ZH_RULES : relaxRule(ZH_RULES, ZH_LOOSE_RULE)))
    lines.push('', ...ZH_EXAMPLE)
  }

  if (cfg.extraRules.length > 0) {
    lines.push('')
    for (const rule of cfg.extraRules) lines.push('- ' + rule)
  }

  return lines.join('\n') + '\n'
}
