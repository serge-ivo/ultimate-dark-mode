# CLAUDE.md — AI Development Guidelines

## Project Overview

Ultimate Dark Mode is an open-source Chrome extension (Manifest V3) that applies dark mode to all websites. It is AI-built and operated by GitHub agents.

## Key Principles

- **MV3 only** — use Manifest V3 APIs (service workers, not background pages)
- **No dependencies in production** — the extension itself ships zero npm dependencies; dev tooling is fine
- **Performance matters** — content scripts run on every page; keep them fast and small
- **Preserve images** — never invert or alter images, videos, canvases, or SVGs with photographic content
- **Site overrides are CSS-only** — override files in `src/content/overrides/` are pure CSS, keyed by domain

## Code Style

- Vanilla JS (no framework, no TypeScript for now)
- ES modules where supported by Chrome extension APIs
- 2-space indentation
- No semicolons (standardjs style)

## Testing

- Tests live in `tests/`
- Use Puppeteer for integration tests (load extension, navigate to sites, verify dark mode)
- Unit tests for color transformation logic

## File Conventions

- Site override CSS files are named by domain: `src/content/overrides/github.com.css`
- Icons: 16, 48, 128px PNGs in `icons/`

## GitHub Agents

GitHub agents are configured to:
1. Triage new issues
2. Generate site-specific overrides from screenshots
3. Run visual regression tests on PRs
4. Auto-merge passing PRs with approved reviews
