# dsh-latex

> [English](./README.md) | **中文**

让 DeepSeek Harness 的对话页面「把公式当公式」显示，并且让模型**默认用 LaTeX 写公式**，而不是把它们包进 `latex` 代码块。

## 它解决什么

DSH 前端（`@deepseek-ai/dsh-client-ui-primitives` 的 `MarkdownText`）本来就用 KaTeX 渲染公式，但：

| 现象 | 原因 | 本插件做什么 |
|---|---|---|
| 公式显示成一段灰色代码 | 模型把公式写进了 ```` ```latex ```` / ```` ```tex ```` 代码块，而前端只对 ```` ```math ```` 和 `$...$` 生效 | 宿主半在系统提示词里规定输出格式；浏览器半把历史里的 `latex`/`tex` 代码块就地渲染成公式 |
| 流式输出时公式是一堆 `$` 和 `\frac` | 前端刻意在流式期间不解析 TeX，等消息落定才换成 KaTeX | 不干预（跟随前端设计），落定后即正常 |
| 个别公式变成刺眼的红色原文 | KaTeX 严格模式：`align`、`\si{}`、`\ce{}` 等不在支持子集里 | 提示词里禁用这些宏；浏览器半把红色错误改成可读的错误徽标 |
| 宽公式把气泡撑破 | KaTeX display 默认不滚 | 浏览器半给块级公式加横向滚动与内边距 |

## 安装

### 从 GitHub 安装（推荐）

```powershell
dsh plugin --profile desktop add github:sbVAN/dsh-latex
```

装完重启 DeepSeek Harness，再刷新一次页面（浏览器半要重新加载 bundle）。

### 开发阶段：link 本地源码

```powershell
# 1. profile 的 package.json 里登记 link 依赖
#    "dsh-latex": "link:Z:/文件留存/deepseek project/dsh-latex"
# 2. 建 junction（等价于 pnpm 的 link:）
New-Item -ItemType Junction `
  -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-latex" `
  -Target "Z:\文件留存\deepseek project\dsh-latex"
# 3. 在 profile 的 cordis.patch.yml 末尾追加
#    - insert:
#        - id: latex
#          name: dsh-latex
# 4. 重启 DeepSeek Harness（宿主半需要重新读 profile 组合）
```

浏览器半之后可以走 HMR：`hmr.root` 里包含插件源码目录时，改 `lib/client.js` 刷新页面即可生效。

## 配置

写在 `cordis.patch.yml` 的 `config:` 下，或 profile 的 `package.json` 里由 bundle 提供默认值：

```yaml
- insert:
    - id: latex
      name: dsh-latex
      config:
        strict: true
        compact: false
        locale: zh
        extraRules:
          - 化学式写成 $\mathrm{H_2O}$，不要用 \ce{}。
```

| 键 | 默认 | 含义 |
|---|---|---|
| `enabled` | `true` | 关掉后不注入任何提示词（浏览器半仍生效） |
| `locale` | `auto` | `zh` / `en` / `auto`（auto 跟随 `DSH_LOCALE`、`LANG`，默认中文） |
| `strict` | `true` | `true` 明确禁止代码块写公式；`false` 只建议 |
| `compact` | `false` | 精简版提示词，约 1/3 token |
| `order` | `145` | 段在系统提示词中的排序位置（工具引导占用 100–199） |
| `extraRules` | `[]` | 追加到规范末尾的条目 |

## 行为

### 宿主半（`lib/index.js`）

通过 `ctx.systemPrompt.section({ name: 'dsh-latex:math-output', order, text })` 注入一段规范，内容覆盖：

- 行内 `$...$`、独立 `$$...$$`（前后空行）；
- 禁止 `latex` / `tex` / `math` 代码块包公式；
- KaTeX 支持子集：`aligned` 而非 `align`；`pmatrix`/`bmatrix`/`cases`；`\mathrm{}` 而非 `\si{}` / `\pu{}` / `\ce{}`；不用 `\label`/`\tag`/`\eqref`；
- 中文只放在 `\text{}` 里或公式外；
- 长推导拆块；代码里的表达式留在代码块。

段注册随插件 fiber dispose，热重载不会留下重复段。实际注入的文本会写到
`$DSH_HOME/cache/dsh-latex/prompt.txt`，挂载信息（pid、配置、长度）写到同目录的 `mounted.json`。

### 浏览器半（`lib/client.js`）

- **排版增强**：`.katex-display` 横向滚动、错误徽标；
- **代码块兜底**：以 `.md-code-block` 为锚点，从头部 `[data-code-block-banner]` 的第一个标签读语言，
  源码按 `pre > code > span.line` 逐行拼接（shiki 的 line 之间没有换行文本节点，直接用
  `pre.textContent` 会把多行公式粘成一行）。识别到 `latex` / `tex` 后在代码块后插入预览，
  复用统一基座里的 `MarkdownText` 渲染 `$$...$$`（不额外打包 KaTeX），源码默认折叠；
- **工具条**：显示/隐藏源码、复制 LaTeX；
- 300ms 防抖 + 全量扫描，避开流式每个 token 的抖动；React 重渲染冲掉节点时自动补挂，并对断开的 root 做 unmount；
- 任何共享模块（react / react-dom / primitives）缺失都只降级为「只注入 CSS」，不会让整页 boot 失败。

> **注意**：代码块的语言标记只存在于头部标签文本里，`pre` / `code` 上没有 `language-*` 类名，
> 所以不能用 `code.language-latex` 这类选择器。

### 诊断文件

`$DSH_HOME/cache/dsh-latex/` 下：

| 文件 | 含义 |
|---|---|
| `mounted.json` | 宿主半挂载记录（pid、配置、提示词长度） |
| `prompt.txt` | 实际注入的系统提示词全文 |
| `client-graph.json` | 浏览器半是否进了客户端启动图（`hasEntry`）、bundle 路径、图中全部 entry id |
| `rpc.json` | 自检 RPC 通道的注册结果（`registered` / `register-failed`） |
| `client-mounted.json` | 浏览器半跑起来后通过 Host RPC 回写的记录 |

> **桌面版注意**：桌面宿主的 `connection.rpc.handle()` 目前会抛
> `cannot get property "webServer" without inject`（`rpc.json` 里可见），
> 因此 `client-mounted.json` 在 desktop profile 下通常不会出现。
> 判断浏览器半是否生效，直接看页面：`latex` / `tex` 代码块是否变成了公式 + 工具条。

排查顺序：`mounted.json` 有没有 → `client-graph.json` 的 `hasEntry` →
`hasEntry: true` 但页面上代码块没变，说明页面还没加载新 bundle，刷新页面（或重启）即可。

## 已知限制

- **流式期间不渲染公式**：这是前端刻意的设计（避免半截公式闪错误），插件不违背。
- **只处理 `latex` / `tex` 代码块**：`math` 代码块前端已渲染，重复处理反而会打架。
- **不启用 mhchem**：`\ce{}` / `\pu{}` 仍会报错，提示词里要求改用 `\mathrm{}`；要真支持化学式需要自带 KaTeX + mhchem 扩展。
- **不接管 `conversation.chat.node`**：覆盖 assistant 渲染器要复刻整条消息结构，上游一升级就坏；这里只在 DOM 层做加法。
- **不改写模型输出历史**：提示词只约束后续输出，旧会话里的代码块靠浏览器半兜底显示。

## 回滚

删除 `node_modules/dsh-latex` junction、删掉 `cordis.patch.yml` 里的 insert 行、还原 profile 的 `package.json`，重启即可。插件不改 DSH 内部任何文件。

## 许可

MIT
