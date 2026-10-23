# dsh-latex

> **English** | [中文](./README.zh.md)

Make the DeepSeek Harness chat render formulae as formulae, and make the model **write LaTeX by default** instead of wrapping math in `latex` fences.

## What it fixes

DSH's frontend already renders TeX through KaTeX (`MarkdownText` in `@deepseek-ai/dsh-client-ui-primitives`), but:

| Symptom | Cause | What this plugin does |
|---|---|---|
| Formulae show up as a grey code block | The model writes them in ```` ```latex ```` / ```` ```tex ```` fences, which the frontend never renders (only `$...$`, `$$...$$`, `\(...\)`, `\[...\]` and ```` ```math ```` are supported) | The host half states the output contract in the system prompt; the browser half renders legacy `latex`/`tex` fences in place |
| During streaming the answer shows raw `$` and `\frac` | The frontend deliberately keeps TeX literal while streaming and swaps in KaTeX once the message settles | Left alone (upstream design); renders correctly after settling |
| A few formulae turn into harsh red text | KaTeX strict mode: `align`, `\si{}`, `\ce{}` are outside the supported subset | Forbidden by the prompt; the browser half turns the red error into a readable badge |
| Wide display math overflows the bubble | KaTeX display blocks do not scroll by default | The browser half adds horizontal scrolling and padding |

## Install

### From GitHub (recommended)

```powershell
dsh plugin --profile desktop add github:sbVAN/dsh-latex
```

Restart DeepSeek Harness afterwards, then reload the page once (the browser half needs to load the new bundle).

### Development: link a local checkout

```powershell
# 1. register a link dependency in the profile package.json:
#    "dsh-latex": "link:Z:/文件留存/deepseek project/dsh-latex"
# 2. create the junction (the equivalent of pnpm's link:)
New-Item -ItemType Junction `
  -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-latex" `
  -Target "Z:\文件留存\deepseek project\dsh-latex"
# 3. append to the profile's cordis.patch.yml:
#    - insert:
#        - id: latex
#          name: dsh-latex
# 4. restart DeepSeek Harness (the host half needs the new composition)
```

After that the browser half can hot-reload through HMR when `hmr.root` covers the plugin sources.

## Configuration

```yaml
- insert:
    - id: latex
      name: dsh-latex
      config:
        strict: true
        compact: false
        locale: zh
        extraRules:
          - Write water as $\mathrm{H_2O}$, never \ce{}.
```

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Disables the prompt section entirely (the browser half still runs) |
| `locale` | `auto` | `zh` / `en` / `auto` (auto follows `DSH_LOCALE`, `LANG`, defaulting to Chinese) |
| `strict` | `true` | `true` forbids fenced formulae; `false` only recommends |
| `compact` | `false` | Shorter prompt, roughly 1/3 of the tokens |
| `order` | `145` | Section order inside the system prompt (tool guidance owns 100–199) |
| `extraRules` | `[]` | Extra bullet lines appended to the contract |

## Behaviour

### Host half (`lib/index.js`)

Registers `ctx.systemPrompt.section({ name: 'dsh-latex:math-output', order, text })` with a contract covering inline `$...$`, display `$$...$$`, a ban on fenced formulae, the KaTeX-supported subset (`aligned` over `align`, `pmatrix`/`bmatrix`/`cases`, `\mathrm{}` over `\si{}`/`\pu{}`/`\ce{}`, no `\label`/`\tag`), CJK only inside `\text{}`, and splitting long derivations.

The section is disposed with the plugin fiber, so hot reload cannot leave duplicates. The rendered contract is written to `$DSH_HOME/cache/dsh-latex/prompt.txt`, mount diagnostics to `mounted.json`.

### Browser half (`lib/client.js`)

- display-math scrolling and an error badge;
- `pre > code.language-latex|tex` gets a preview below it, rendered with the shared `MarkdownText` (no bundled KaTeX), source folded by default;
- toolbar with show/hide source and copy LaTeX;
- 300 ms debounce over a full scan, orphan cleanup, and root unmount when React replaces nodes.

## Limitations

- **No math while streaming** — that is the frontend's deliberate behaviour and this plugin does not fight it.
- **Only `latex` / `tex` fences are handled** — `math` fences are already rendered upstream.
- **No mhchem** — `\ce{}` / `\pu{}` still fail; the prompt routes them to `\mathrm{}`.
- **No `conversation.chat.node` takeover** — replacing the assistant renderer means duplicating the whole message structure and breaks on upstream upgrades.
- **No history rewriting** — the prompt constrains future output only; old sessions are covered by the browser half.
- **A bare `|` in a table cell breaks the formula** — GFM reads it as a column separator, so `$\oint_{|z|=1}$` gets split across cells and renders as raw text. The prompt now requires `\vert` / `\lvert ... \rvert`; messages already sent cannot be repaired because the table was split at parse time.

> Note: the browser half anchors on `.md-code-block` and reads the language from
> the header banner, because the rendered code block carries no `language-*`
> class on `pre`/`code`. See `lib/client.js` for the exact DOM contract.

## Rollback

Remove the junction, drop the insert line from `cordis.patch.yml`, restore the profile `package.json`, restart. No DSH file is modified.

## License

MIT
