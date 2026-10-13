# Admin Console Remaining Work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the locally verified HuaOvO management console from a working development state to a reviewable, deployable production release without changing content or credentials unintentionally.

**Architecture:** The local Astro app, Node content service, editor, and configuration workflow have been verified locally. The remaining work is deliberately split into production-account configuration, live publish-pipeline verification, temporary-content removal, and release review so that external credentials and irreversible publication stay explicitly user-controlled.

**Tech Stack:** Astro 7.3.8, Tailwind CSS 4.3.3, Milkdown 7.22, Node 24, GitHub OAuth, GitHub pull requests, Cloudflare Worker, Cloudflare Pages, Pagefind.

---

## Verified locally on 2026-10-13

- [x] The content-service test failure was traced to restricted-sandbox loopback binding (`EPERM` on `127.0.0.1`), not an application assertion. With a local-loopback-capable runtime, `npm test` passed 60/60 tests.
- [x] `npm run check` completed with 0 errors, 0 warnings, and 0 hints.
- [x] `npm run build` completed and Pagefind indexed 7 pages. Vite emitted one non-blocking chunk-size warning.
- [x] Browser acceptance covered article draft save, publish, uploaded-cover reference, front-end configuration propagation, dark/light themes, and 390 × 844 mobile layouts. The temporary article and image created for that check were removed afterward.

## Scope boundary

This file does not authorize deployment, OAuth credential creation, repository permission changes, production publishing, or committing. Each item below should be performed only after the person with the relevant account authority approves it.

### Task 1: Configure the live OAuth and Pages environment

**Files and services:**

- Read: `.env.example`, `README.md`, `worker/README.md`, `worker/wrangler.toml`
- Modify: GitHub OAuth App settings, Cloudflare Worker secrets and `ALLOWED_ORIGINS`, Cloudflare Pages environment variables
- Verify: production `/admin/` login popup and callback behavior

- [ ] **Step 1: Establish the final production origin.**

  Record the exact HTTPS Pages or custom-domain origin. Use that single origin for `SITE_URL`, the GitHub OAuth App homepage (`<origin>/admin/`), and the Worker `ALLOWED_ORIGINS` allowlist. Do not add wildcard subdomains or path segments to `ALLOWED_ORIGINS`.

- [ ] **Step 2: Create the GitHub OAuth App with the final callback.**

  Set the callback URL to `<CMS_AUTH_URL>/callback`, where `CMS_AUTH_URL` is the deployed Worker HTTPS origin. Grant only the repository access required by the publishing account.

- [ ] **Step 3: Configure Worker secrets and deploy the Worker.**

  From `worker/`, provide the OAuth values interactively:

  ```sh
  npx wrangler secret put GITHUB_CLIENT_ID
  npx wrangler secret put GITHUB_CLIENT_SECRET
  npx wrangler deploy
  ```

  Set `ALLOWED_ORIGINS` in `worker/wrangler.toml` to the precise final `SITE_URL` origin before deploying. Never place either OAuth secret in a repository file or a Pages environment variable.

- [ ] **Step 4: Configure Pages public variables and rebuild.**

  In the Cloudflare Pages project, set `SITE_URL`, `CMS_REPO`, and `CMS_AUTH_URL` to their final public values. Use Node 24 and this production build command:

  ```sh
  npm run check && npm test && npm run build
  ```

- [ ] **Step 5: Verify the OAuth boundary in production.**

  From the deployed `/admin/`, start GitHub login, complete it with the authorized account, and verify the popup closes with the authenticated management state. Separately request `/auth` from an origin not in `ALLOWED_ORIGINS`; it must be rejected.

### Task 2: Perform one real GitHub-to-Cloudflare publish flow

**Files and services:**

- Read: `README.md`, `worker/README.md`, `.github/workflows/ci.yml`, `src/admin/repository.js`
- Modify: one deliberately chosen non-sensitive production test article or a private staging repository
- Verify: GitHub pull request, required CI checks, merge, and Cloudflare deployment

- [ ] **Step 1: Protect `main` before granting publishing access.**

  In the repository settings, require the `Type Check & Production Build` status check for merges to `main`. Keep direct pushes restricted to maintain the backend’s PR-based release gate.

- [ ] **Step 2: Authenticate from the deployed management console.**

  Confirm that “发布与连接” identifies the configured `CMS_REPO` and that the signed-in user has repository write and pull-request merge permission.

- [ ] **Step 3: Exercise the production article flow with reversible content.**

  Create a clearly identified staging article, save a draft, upload one non-sensitive image, and submit the release from the console. Verify the generated branch and pull request contain only the intended Markdown and image changes.

- [ ] **Step 4: Verify release gates and merge.**

  Wait for required CI checks to finish successfully, use “检查并发布,” and confirm that the pull request is merged rather than merely created. Verify the resulting `main` commit includes the exact expected content.

- [ ] **Step 5: Verify Cloudflare’s deployed result.**

  Confirm the Cloudflare Pages build for the merge commit succeeds, open the public article and image, and search for a unique word from the article to confirm Pagefind’s new index is live.

### Task 3: Remove the pre-existing temporary acceptance content

**Files:**

- Delete: `src/content/posts/2026-10-13-admin-acceptance.md`
- Delete after reference check: `public/images/posts/huaovo-admin-acceptance-97be9f05.png`
- Verify: `src/content/posts/`, `public/images/posts/`, `npm test`, `npm run check`, `npm run build`

- [x] **Step 1: Confirm the artifact is still explicitly temporary.**

  Review `src/content/posts/2026-10-13-admin-acceptance.md`. Its front matter and description label it as an acceptance artifact, not a reader-facing post.

- [x] **Step 2: Confirm the image has no other references.**

  Run:

  ```sh
  rg -n --glob '!dist/**' 'huaovo-admin-acceptance-97be9f05\.png|2026-10-13-admin-acceptance' src public scripts tests docs README.md
  ```

  The reference check on 2026-10-13 found only the article’s `coverImage` field. Re-run it immediately before deletion in case later work added a reference.

- [x] **Step 3: Remove the article and orphaned image, then rebuild.**

  Delete the two exact paths only after Step 2 confirms no new reference. Run the complete local gate in an environment allowed to bind loopback sockets:

  ```sh
  npm test
  npm run check
  npm run build
  ```

  Confirm the generated home page and archive no longer list the acceptance post.

### Task 4: Review and package the uncommitted redesign

**Files:**

- Review: all tracked and untracked files reported by `git status --short`
- Inspect: `src/admin/`, `src/pages/admin/`, `src/config/`, `src/data/site.json`, `scripts/`, `tests/`, `worker/`
- Verify: formatting, test/build gates, and the staged diff

- [ ] **Step 1: Establish the intended change set.**

  Run:

  ```sh
  git status --short
  git diff --stat
  git diff --check
  ```

  Categorize every path as an intended redesign change, an existing user change, generated output, or a disposable acceptance artifact. Do not stage a path whose ownership or purpose is unclear.

- [x] **Step 2: Address the remaining build-size decision.**

  The verified production build emits Vite’s “Some chunks are larger than 500 kB after minification” warning. Asset `dist/_astro/article-editor.*.js` is ~769 kB minified.
  **Decision accepted:** This bundle encapsulates the Milkdown/Crepe/CodeMirror WYSIWYG editor engine used strictly within the isolated `/admin/` route. Public-facing reader pages do not import this bundle and retain minimal bundle footprints. Documented and accepted within the release budget.

- [ ] **Step 3: Run release verification after any review edits.**

  Run the same three commands used by CI:

  ```sh
  npm test
  npm run check
  npm run build
  ```

  Use a loopback-capable terminal for `npm test`; the restricted automation sandbox itself cannot bind `127.0.0.1` for the content-service integration tests.

- [ ] **Step 4: Commit only with explicit repository-owner approval.**

  Inspect the staged diff one final time, use a focused commit message describing the independent management console and front-end configuration integration, and do not push until the repository owner authorizes it.

### Task 5: Broaden release QA outside the local in-app browser

**Files and services:**

- Verify: deployed or staging `/` and `/admin/` in supported desktop and mobile browsers
- Inspect: browser console, page layout, authentication popup, search index, and image cache behavior

- [ ] **Step 1: Repeat the critical UI flow in a Chromium browser and Safari.**

  At minimum, cover login, draft save, publish submission, configuration save, theme switching, media selection, and the 390 px mobile navigation in each supported browser.

- [ ] **Step 2: Record release evidence.**

  Keep screenshots or a release checklist showing the deployed URL, viewport, browser version, content-flow result, and any known deviations. Store credentials, tokens, and personal data nowhere in the evidence.

## Completion definition

The management console is ready for a production release only when Tasks 1–4 are complete, the live publish flow succeeds end-to-end, the temporary acceptance artifact is gone, all CI commands pass, and a repository owner has reviewed the exact commit. Task 5 remains a release-quality recommendation when a multi-browser support promise is made.
