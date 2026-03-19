# CLAUDE.md — AI Development Guidelines

## Project Overview

Ultimate Dark Mode is an open-source Chrome extension (Manifest V3) that applies dark mode to all websites. It is AI-built and operated by GitHub agents.

## Key Principles

- **MV3 only** — use Manifest V3 APIs (service workers, not background pages)
- **No dependencies in production** — the extension itself ships zero npm dependencies; dev tooling is fine
- **Performance matters** — content scripts run on every page; keep them fast and small
- **Preserve images** — never invert or alter images, videos, canvases, or SVGs with photographic content
- **Site overrides are CSS-only** — override files in `src/content/overrides/` are pure CSS, keyed by domain
- **NEVER use `filter: invert()`** — this is the #1 rule. No blind color inversion. Always use explicit color remapping.

## Architecture: Three-Layer Engine

The extension applies dark mode in three layers. **Sites with a dedicated override skip Layers 2 and 3.**

### Layer 1: Native dark mode forcing
- Sets `color-scheme: dark` on `:root` and injects `<meta name="color-scheme" content="dark">`
- Activates native dark mode on sites that support `prefers-color-scheme: dark`
- Always applied (safe, zero side effects)

### Layer 2: Generic CSS (`styles/darkmode.css`)
- Applies oklch-based dark palette to common HTML elements
- **ONLY applied when no site-specific override exists**
- Uses `html[data-darkmode]` attribute to scope all rules

### Layer 3: JS-assisted (MutationObserver)
- Processes elements with inline styles, remaps light backgrounds to dark
- **ONLY applied when no site-specific override exists**
- Debounced via `requestAnimationFrame` to avoid performance issues

### Why Layers 2 & 3 are skipped when an override exists

Complex web apps (Google Sheets, Notion, Slack, etc.) manage their DOM and read computed styles back in JavaScript. When our generic CSS injects `oklch()` values into elements these apps control, their JS crashes because they can't parse `oklch()`.

**Example failure:** Google Sheets reads `element.style.color`, gets `oklch(0.88 0.01 260)`, passes it to an internal color parser that expects `rgb()` → `Error in protected function: hg'oklch(0.88 0.01 260)'` → app crashes.

**The fix:** Site-specific overrides target only known-safe selectors (toolbar, sidebar, menus) and avoid touching elements that the app's JS manages. The generic CSS is too broad for this.

## Code Style

- Vanilla JS (no framework, no TypeScript for now)
- ES modules where supported by Chrome extension APIs
- 2-space indentation
- No semicolons (standardjs style)

## Testing

- Tests live in `tests/`
- `npm test` runs unit tests via vitest
- `npm run test:extension` loads extension in headless Chrome, toggles dark mode, takes screenshots
- `npm run test:extension -- https://example.com` to test any URL
- Unit tests cover color transformation logic (`src/content/colors.js`)

## File Conventions

- Site override CSS files are named by base domain: `src/content/overrides/harvestapp.com.css`
- Subdomain matching: `rocketlab.harvestapp.com` will match `harvestapp.com.css`
- Icons: 16, 48, 128px PNGs in `icons/`

## Writing Site Override CSS — Rules for Agents

When generating a site-specific CSS override, you MUST follow these rules:

### Structure
```css
@layer darkmode.overrides {
  html[data-darkmode] .some-selector {
    background-color: oklch(0.15 0.01 260);
  }
}
```

### Color Palette
| Token | Value | Use |
|---|---|---|
| Base background | `oklch(0.15 0.01 260)` | Page/app background |
| Surface | `oklch(0.20 0.01 260)` | Cards, panels, modals |
| Elevated surface | `oklch(0.25 0.01 260)` | Buttons, inputs |
| Border | `oklch(0.30 0.01 260)` | Dividers, borders |
| Muted text | `oklch(0.65 0.01 260)` | Secondary text, placeholders |
| Body text | `oklch(0.88 0.01 260)` | Primary text |
| Heading text | `oklch(0.93 0.01 260)` | Headings, emphasis |
| Link | `oklch(0.75 0.15 250)` | Links |
| Accent | `oklch(0.65 0.15 250)` | Active states, highlights |

### Critical Rules

1. **Wrap everything in `@layer darkmode.overrides { ... }`**
2. **Scope every selector with `html[data-darkmode]`**
3. **NEVER use `filter: invert()` or `filter: brightness()` on containers**
4. **NEVER set colors on elements managed by the app's JavaScript** — this includes:
   - Canvas elements and their parents
   - Elements with `role="grid"` (spreadsheet cells, data tables)
   - Elements with `contenteditable="true"` (rich text editors)
   - Elements the app reads `computedStyle` from — if the app crashes, you targeted the wrong element
5. **Preserve media elements** — do not alter `img`, `video`, `canvas`, `svg`, `picture`, `iframe`
6. **Keep selectors simple and stable** — prefer class selectors over deeply nested or nth-child selectors. Google and other apps use obfuscated class names that change; prefer semantic selectors (`[role="dialog"]`, `[aria-label]`) or stable class patterns
7. **Test for crashes** — if the target site uses canvas rendering or heavy JS (Google Sheets, Figma, etc.), be extra conservative. Only target the "chrome" (toolbar, sidebar, menus), not the content area

### Common Mistakes to Avoid

- Setting `color` on `div` or `span` globally — apps read these values back
- Using `oklch()` on elements that apps parse with regex — some JS only handles `rgb()`/`rgba()`
- Targeting the entire `body` when only the app shell needs styling
- Overriding `:focus`, `:active`, `:hover` states that apps manage for accessibility
- Setting `background-color: transparent !important` on elements that need a background for layering

### Debugging Override Issues

If a user reports "the app crashes with dark mode on":
1. The override is likely styling an element the app's JS manages
2. Look for `oklch()` values in the error message — that's our CSS conflicting
3. Remove the offending selector and target a parent/sibling instead
4. The app's "chrome" (toolbars, menus, sidebar) is usually safe; the "content" (editor, canvas, grid) is not

## GitHub Agents

GitHub agents are configured to:
1. Triage new issues (labeled `site-override` or `new-site`)
2. Generate site-specific overrides from user-submitted screenshots + CSS debug info
3. Review PRs for code quality
4. Iterate on feedback when users comment on issues/PRs

### Agent Workflow
```
User files issue with screenshot + debug info
  → Agent reads issue, analyzes screenshot and CSS data
  → Agent generates override CSS following the rules above
  → Agent creates PR with the override
  → User tests, comments with feedback
  → Agent iterates until user confirms it works
```

### What the Agent Receives
- Screenshot of the broken page
- Compacted CSS debug info: computed styles of key elements, top class names, CSS custom properties, inline style count
- Full debug data may be in extension storage (referenced in issue body)
