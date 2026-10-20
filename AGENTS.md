# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, Copilot, …) and humans contributing to **Amazon Modern Widgets (AMW)**.

## Project overview

- Express 5 / TypeScript server (`src/server/`) exposing `GET <path>/product`, `GET <path>/widget.js` and `GET <path>/health`.
- Products are fetched from the Amazon Creators API (`amazon-creators-api`) and cached in Redis (`ioredis`).
- The embeddable widget (`src/widgets/widget.js`) runs on third-party sites: treat every value it renders as untrusted (use `textContent`, `safeUrl()`, `sanitizeText()`, never raw `innerHTML` with API data).
- Configuration uses `node-config` (`config/<NODE_ENV>.yml`). Never commit real credentials; `config/production.yml` and other local files are git-ignored and excluded from the npm package and Docker image.

## Commands

```bash
npm ci               # install
npm run lint         # ESLint
npm run build        # tsc + widget minification (dist/)
npm test             # Jest
npm run test:ci      # Jest with coverage (used by CI)
npm audit --audit-level high   # must pass, CI blocks on it
```

Run `lint`, `build` and `test` before opening a pull request. Node.js 24 is the reference version (CI and Docker image).

## Mandatory workflow: issue → branch → pull request

**No change is ever pushed directly to `develop` or `main`.** Every change, however small, follows these steps:

1. **Open a GitHub issue** describing the problem or the feature, with a Conventional Commits title:
   ```bash
   gh issue create --title "fix(widget): escape product id in error placeholder" --body "..."
   ```
2. **Create a branch from `develop`** named `<type>/<issue-number>-<short-description>`:
   ```bash
   git switch develop && git pull
   git switch -c fix/42-escape-product-id
   ```
3. **Commit** using Conventional Commits (see below). Keep commits focused.
4. **Open a pull request targeting `develop`**, with a Conventional Commits title and a body that links the issue (`Closes #42`):
   ```bash
   gh pr create --base develop --title "fix(widget): escape product id in error placeholder" --body "Closes #42 ..."
   ```
5. The PR is merged only once CI (lint, build, tests, security audit, Docker build) is green.

`main` only receives merges from `develop` for releases.

## Conventional Commits

Issue titles, PR titles and commit messages all follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/):

```
<type>(<optional scope>): <short imperative description>

[optional body]

[optional footer(s)]
```

- **Types**: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`, `security`.
- **Scopes** (suggested): `server`, `api`, `widget`, `cache`, `config`, `docker`, `ci`, `deps`.
- Description in English, lowercase, imperative mood, no trailing period, ≤ 72 characters.
- Breaking changes: add `!` after the type/scope (`feat(api)!: …`) and a `BREAKING CHANGE:` footer.
- Reference the issue in the footer: `Refs #42` or `Closes #42`.

Examples:

```
feat(api): add per-IP rate limiting on /product
fix(docker): remove copy of missing @types directory
build(deps): update release-it to v21
ci: restrict default workflow token permissions
```

## Coding conventions

- Match the surrounding style (TypeScript strict mode, static readonly config constants, `this.log` logger).
- Validate and sanitize every request parameter; reject with `ValidationError` (HTTP 400) rather than letting a request hang.
- Use `req.ip` (governed by `Server.trustProxy`) for client IPs, never raw `X-Forwarded-For`.
- Do not add dependencies without a reason stated in the issue; prefer minor/patch updates, major upgrades get their own issue and PR.
- Keep the Docker image minimal: production dependencies only, non-root user, no package manager at runtime.
