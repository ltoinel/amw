# Local development

## Prerequisites

- Node.js 24 and npm
- Optional: Docker (image build and smoke test), Redis (cache)
- Optional: Python 3 (documentation site)

## Setup

```bash
git clone https://github.com/ltoinel/amw.git
cd amw
npm ci
cp config/sample.yml config/development.yml   # add your Creators API credentials
```

Set `Server.projectDir` to the absolute path of the clone, and run `npm run build` once
so that `dist/widgets/widget.js` exists for the `/widget.js` endpoint.

## npm scripts

| Command | Description |
|---|---|
| `npm run dev` | Starts `src/main.ts` with `ts-node --watch` and `NODE_ENV=development` (loads `config/development.yml`). |
| `npm run build` | Cleans `dist/`, compiles TypeScript (`tsc`) and minifies the widget (`scripts/build-widgets.js`). |
| `npm start` | Runs the compiled server (`node .`, i.e. `dist/main.js`). Build first. |
| `npm run lint` / `npm run lint:fix` | ESLint on `src/**/*.ts`. |
| `npm test` | Jest test suites. |
| `npm run test:coverage` | Jest with a coverage report in `coverage/`. |
| `npm run test:ci` | Jest in CI mode with coverage (used by the CI workflow). |
| `npm run docker` | Starts the `docker/docker-compose.yml` stack (`docker/scripts/start.sh`). |
| `npm run release` | Interactive release with [release-it](https://github.com/release-it/release-it) (maintainer only). |

Before opening a pull request, run:

```bash
npm run lint && npm run build && npm test
npm audit --audit-level high
```

## Tests

The Jest suites live in `tests/` (`ts-jest`, Node environment, 10 s timeout):

| Suite | Covers |
|---|---|
| `core.test.ts` | Product building, response parsing, error handling, cache keys, configuration validation |
| `buildProduct.test.ts` | Mapping of Amazon items to the AMW product JSON |
| `paapi.logic.test.ts` | Amazon API response parsing, configuration and error handling |
| `api.logic.test.ts` | Cache keys, parameter processing, response formatting, cache management |
| `api.integration.test.ts` | HTTP behaviour of the endpoints with `supertest` |
| `server.integration.test.ts` | Routes, headers, CORS, query validation with `supertest` |
| `edge-cases.test.ts` | Input sanitization, rate limiting, cache and resilience edge cases |
| `widget.test.ts` | Widget build output, XSS protections, languages (needs `npm run build`) |

!!! note "Coverage"
    Coverage is collected for `src/**/*.ts` (excluding `src/main.ts`). Most suites
    currently test replicas of the server logic (and the integration suites a test
    Express app) instead of importing `src/`, so the measured coverage is low even
    though many behaviours are tested; tests that import the real modules are welcome.
    The README coverage badge is generated from `coverage/coverage-summary.json` by the
    documentation workflow on every push to `develop` (see [CI/CD](ci-cd.md#documentation)).

## Docker

```bash
docker build -f docker/Dockerfile -t amw:test .
./scripts/test-docker.sh     # builds the image, starts it and checks /item/health
```

## Documentation

The site is built with [MkDocs](https://www.mkdocs.org/) and
[Material for MkDocs](https://squidfunk.github.io/mkdocs-material/). Sources are in
`docs/`, configuration in `mkdocs.yml`, pinned Python dependencies in
`docs/requirements.txt`.

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r docs/requirements.txt
mkdocs serve            # live preview on http://127.0.0.1:8000/amw/
mkdocs build --strict   # what CI runs: warnings are errors
```
