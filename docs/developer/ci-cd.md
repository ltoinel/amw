# CI/CD workflows

All workflows live in `.github/workflows/` and run with a read-only `GITHUB_TOKEN` by
default; jobs that publish request only the permissions they need.

| Workflow | Trigger | Purpose |
|---|---|---|
| [`ci.yml`](https://github.com/ltoinel/amw/blob/develop/.github/workflows/ci.yml) | push and PR to `main` / `develop` | Quality gate (below) |
| [`dependency-review.yml`](https://github.com/ltoinel/amw/blob/develop/.github/workflows/dependency-review.yml) | PR to `main` / `develop` | Blocks new dependencies with high/critical vulnerabilities or a GPL/AGPL license |
| [`docs.yml`](https://github.com/ltoinel/amw/blob/develop/.github/workflows/docs.yml) | PR touching the docs, push to `develop`, manual | Builds and publishes this site and the coverage badge |
| [`release.yml`](https://github.com/ltoinel/amw/blob/develop/.github/workflows/release.yml) | tag `v*.*.*`, manual | Publishes Docker images, npm package and GitHub release: see [Release process](release.md) |
| CodeQL (default setup) | push, PR, weekly | Code scanning of JavaScript/TypeScript and workflows |
| Dependabot | weekly | Updates npm packages, GitHub Actions, Docker images and Compose files, against `develop` |

## Workflow hardening

Every workflow follows the same rules; keep them when adding a job or an action:

- **Actions pinned to a commit SHA**, with the release as a comment
  (`uses: actions/checkout@<40-char sha> # v7.0.1`), first-party `actions/*` included:
  a tag can be moved to other code, a commit cannot. Dependabot's `github-actions`
  ecosystem understands this form and bumps both the SHA and the comment. To pin a new
  action, take the commit of its latest release
  (`gh api repos/<owner>/<repo>/git/ref/tags/<tag>`, then
  `gh api repos/<owner>/<repo>/git/tags/<sha>` when the tag is annotated).
- **Least-privilege token**: `permissions: contents: read` at the top of each workflow;
  only the jobs that publish get more (`packages: write`, `contents: write`,
  `pages: write`, `id-token: write`).
- **`persist-credentials: false`** on every `actions/checkout`: no job pushes with git
  (releases, Pages and registries go through their APIs), so the token is not left in
  `.git/config` where later steps or scripts could read it.
- **`timeout-minutes`** on every job (5 to 20 minutes, 60 for the multi-architecture
  image build of a release), instead of GitHub's six-hour default.
- **Concurrency**: in `ci.yml`, a new commit on a pull request cancels the run in
  progress for that pull request; pushes to `main` and `develop` are never cancelled.
  `docs.yml` queues Pages deployments and never cancels one midway.
- **Untrusted inputs** (such as the `workflow_dispatch` version of `release.yml`) are
  passed through `env:` and validated before use, never interpolated into a script.

Check workflow changes locally with [actionlint](https://github.com/rhysd/actionlint)
(run `actionlint` at the repository root).

## Continuous integration

`ci.yml` jobs, all on Node.js 26:

| Job | Steps |
|---|---|
| 🧪 Tests & Linting | `npm ci`, `npm run lint`, `npm run build`, `npm run test:ci` (coverage thresholds enforced), coverage summary and report artifact |
| 🔒 Security Audit | `npm audit --audit-level high` |
| 🐳 Docker Build Test | builds `docker/Dockerfile` and runs `scripts/test-docker.sh` (container start and health check) |
| 🌐 End-to-End Tests | with a Redis service: `npm run test:e2e`, then `npx playwright install --with-deps chromium` and `npm run test:e2e:browser`; Playwright traces uploaded on failure |
| ✅ Quality Gate | fails unless the four jobs above succeeded |

A pull request is merged only when the quality gate is green. See
[Tests & quality](testing.md) to run the same checks locally.

## Documentation

`docs.yml` builds this site with `mkdocs build --strict`:

- on pull requests that touch `docs/`, `mkdocs.yml`, `config/*.yml` or the workflow, as
  a check;
- on pushes to `develop` and on manual runs, it also deploys the site to GitHub Pages
  (<https://ltoinel.github.io/amw/>) with the official Pages actions; only the deploy
  job gets `pages: write` and `id-token: write`.

Before deploying, it runs the Jest suites with coverage and publishes
`badges/coverage.json`, a [shields.io endpoint](https://shields.io/badges/endpoint-badge)
document built from the line coverage in `coverage/coverage-summary.json`. The README
coverage badge reads it, so no third-party coverage service is needed. Test failures
never block the documentation: if no coverage summary is produced, the badge shows
`unknown`.
