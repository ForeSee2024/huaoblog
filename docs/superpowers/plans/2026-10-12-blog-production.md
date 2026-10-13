# Blog production implementation plan

> **For agentic workers:** Execute inline using the executing-plans workflow. The v3.5 engineering design and implementation are approved by the user.

**Goal:** Deliver the approved static blog with a usable Decap writing workspace that shares the public site's theme and article design.

**Architecture:** Keep the approved static architecture, Decap CMS 3.3.3, Pagefind and the OAuth Worker. Upgrade the vulnerable baseline dependencies to Astro 7.3.8, Tailwind 4.3.3 and KaTeX 0.19.0, using Astro's current Content Layer API. Generate public admin configuration from deployment variables; enable the local proxy only during development. Both article surfaces use shared design tokens and prose styles. Identity is Huao / 胡敖, decorative brand HuaOvO.

**Tech Stack:** TypeScript, Astro, CSS custom properties, Decap, unified/remark/rehype, KaTeX, Node's test runner, Cloudflare Pages/Workers.

## 1. Baseline and regression coverage

- [x] Inspect the existing implementation and approved v3.5 specification.
- [x] Create an isolated worktree at `/Users/huao/Documents/blogWeb/.worktrees/blog-production`.
- [x] Verify baseline with `npm run check && npm run build`.
- [x] Add behavior tests for combined post filters, featured sorting, production draft rejection, safe Markdown/math preview, CMS configuration and OAuth callback errors; run each before implementing its behavior.

## 2. Content behavior and common design

- [x] Add `src/utils/post-policy.ts` and `src/utils/post-filters.ts`; connect the policy to `src/utils/posts.ts`, and connect category/tag/series filters to `src/pages/posts/index.astro` including URL history and empty states.
- [x] Sort pinned articles in feeds while preserving chronological archive order.
- [x] Extract `src/styles/tokens.css` and `src/styles/prose.css`, then reuse them in public layouts and the writing preview. Retain existing theme names and local preferences.
- [x] Replace the fixed search fallback with collection-derived data; use a native dialog and DOM text nodes so queries and excerpts cannot become executable HTML.

## 3. Writing workspace

- [x] Replace the static admin HTML with `src/pages/admin/index.astro`, shared fonts/theme, a compact writing header, front-site link and writing help.
- [x] Add `src/config/cms.ts` and `src/pages/admin/config.yml.ts`; production uses GitHub editorial workflow, development uses the local proxy. Pass only public configuration values to the browser.
- [x] Copy the pinned Decap distribution locally via `scripts/vendor-cms.mjs`; initialize it manually in `src/scripts/admin.js` after preview registration.
- [x] Add `src/lib/markdown-preview.js` with GFM, math, sanitized links, code highlighting and uploaded asset resolution. Render new HTML on every body revision, rather than mutating React-owned formula nodes.
- [x] Style stable Decap component selectors in `src/styles/admin.css`; support dark/light modes, focus visibility and mobile editing.
- [x] Browser evidence found display-math escape loss during rich/raw switching; add and verify a dedicated math block component. Document the native rich editor's limitation for complex inline math.

## 4. Production preparation and acceptance

- [x] Harden OAuth callback handling where regression tests identify failures, keeping full-state cookies and exact origins.
- [x] Add `.env.example`, `.nvmrc`, local proxy commands, a production README and CI test execution. No remote push or deployment is included without account configuration.
- [x] Run `npm test`, `npm run check`, `npm run build`, and inspect real browser views at desktop and phone sizes.
- [x] Exercise local editor title/body/image, continuous math editing, theme synchronization and save/reopen using disposable content. Remove test content after verification.
- [x] Review the complete diff, transfer verified changes into the user's checkout, and report the remaining live OAuth/GitHub/Cloudflare acceptance steps accurately.

Acceptance evidence: 17 regression tests passed; Astro checked 39 files with 0 errors, warnings or hints; the static build produced 12 pages and Pagefind indexed 6 articles. Production dependency audit reported 0 known vulnerabilities. Real browser checks covered 1440px / 390px views, dark/light preview synchronization, category/tag combinations, empty-state reset, Escape focus return, uploaded cover persistence and source-preserving display-math editing. The production index found `SO_REUSEPORT`, a term present only in an article body. Temporary test files were removed. The large-chunk build notice belongs to the admin renderer; public pages do not import that bundle. Live account integration remains pending.

Final metadata regression: an empty required publication date must fail validation; null values must not become a 1970 timestamp. Verified all 17 tests, 39-file type check, and static build in the primary checkout after the fix.
