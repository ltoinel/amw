# Code layout

```text
amw/
├── src/
│   ├── main.ts                    entry point: defaults NODE_ENV, starts AmwServer
│   ├── server/
│   │   ├── AmwServer.ts           Express app, routes, middleware, Redis, lifecycle
│   │   ├── AmwApi.ts              /product, /products and widget asset handlers
│   │   ├── Paapi.ts               Amazon Creators API client and product mapping
│   │   ├── AmazonError.ts         classification of Amazon failures (502/503/504)
│   │   ├── Resilience.ts          request coalescing, not-found cache, circuit breaker
│   │   ├── Schemas.ts             zod validation of the query parameters
│   │   ├── CacheControl.ts        per-route Cache-Control helpers
│   │   ├── Stats.ts               usage statistics in Redis, /click beacon
│   │   ├── AdminApi.ts            admin portal API, login and static files
│   │   ├── Insights.ts            AI insights on the statistics (Claude API)
│   │   ├── Settings.ts            typed configuration, read and validated once
│   │   └── OpenApi.ts             OpenAPI 3.1 document (Swagger UI)
│   ├── utils/logger.ts            loggers and request logging (pino)
│   ├── utils/metrics.ts           Prometheus metrics (prom-client)
│   └── widgets/                   browser widget (plain JavaScript) and its stylesheet
├── admin/                         admin portal (Vue 3 + Vite + Chart.js, own package.json)
│   ├── src/components/            views, activity bar, charts and tables
│   ├── src/navigation.ts          hash routes (#/overview, #/pages…)
│   ├── src/theme.ts               light / dark theme
│   └── tests/                     component tests (Vitest)
├── tests/
│   ├── *.test.ts                  unit tests (Jest)
│   ├── helpers/                   config / SDK test doubles, in-memory Redis
│   └── e2e/
│       ├── *.e2e.test.ts          API end-to-end tests
│       ├── browser/*.spec.ts      Playwright tests
│       ├── config/e2e.yml         configuration used by the e2e server
│       └── support/               mock Amazon API, server launcher
├── config/
│   ├── sample.yml                 template for config/production.yml
│   ├── docker.yml                 defaults of the Docker image
│   ├── development.yml            defaults of npm run dev and the dev container
│   └── custom-environment-variables.yml   environment variable mapping
├── docker/
│   ├── Dockerfile                 production image (multi-stage, non-root)
│   ├── Dockerfile.dev             development image
│   ├── docker-compose.yml         production stack (AMW + Redis)
│   ├── docker-compose.dev.yml     development stack (hot reload + Redis)
│   ├── config/redis/redis.conf    Redis settings of the production stack
│   └── scripts/                   build.sh, validate.sh
├── scripts/
│   ├── build-widgets.js           minifies the widget into dist/widgets/
│   ├── build-admin.js             builds the admin portal into dist/admin/
│   ├── dev-mock.ts                npm run dev:mock: AMW against a mock Amazon API
│   ├── docs-screenshots.ts        captures the documentation screenshots
│   └── test-docker.sh             Docker smoke test used by CI
├── docs/                          this documentation (MkDocs Material)
├── resources/                     logo and screenshot shipped in the npm package
├── .devcontainer/                 VS Code Dev Containers setup
├── .github/                       workflows, issue forms, PR template, Dependabot
├── .env.example                   environment variable template (copy to .env)
├── start.sh                       entry point: local, dev, docker and stop modes
├── AGENTS.md                      contribution rules for humans and AI agents
├── SECURITY.md                    security policy
└── mkdocs.yml                     documentation site configuration
```

## Build output

`npm run build` writes `dist/`:

| Path | Produced by |
|---|---|
| `dist/main.js`, `dist/server/`, `dist/utils/` | `tsc` (CommonJS, with source maps) |
| `dist/widgets/widget.js`, `widget.css` | `scripts/build-widgets.js` (terser), served by `/widget.js` and `/widget.css` |
| `dist/widgets/widget.<hash>.js\|css`, `manifest.json` | `scripts/build-widgets.js`: content-hashed copies, cached as immutable |
| `dist/admin/` | `scripts/build-admin.js` (Vite), served at `<path>/admin/` when `Admin.enabled` |

The npm package ships `dist/`, `config/sample.yml`, `config/docker.yml`,
`config/custom-environment-variables.yml`, `resources/`, `README.md` and `LICENSE`.
The Docker image ships `dist/`, the production `node_modules`, `config/docker.yml`,
`config/custom-environment-variables.yml` and `resources/`.

## Where to change what

| Change | Files |
|---|---|
| New endpoint or middleware | `src/server/AmwServer.ts`, `src/server/OpenApi.ts`, `tests/server.test.ts`, [HTTP API](../user-guide/api.md) |
| Product fields from Amazon | `src/server/Paapi.ts` (`defaultResources`, `buildProduct`), `tests/paapi.test.ts` |
| Card look or behaviour | `src/widgets/widget.js`, `src/widgets/widget.css`, `tests/widget.dom.test.ts`, then `npm run docs:screenshots` |
| Admin portal view | `admin/src/components/`, `admin/src/navigation.ts`, `admin/tests/`, [Administration portal](../user-guide/admin-portal.md) |
| Statistics or insights | `src/server/Stats.ts`, `src/server/AdminApi.ts`, `src/server/Insights.ts`, `tests/stats.test.ts`, `tests/admin-api.test.ts`, `tests/insights.test.ts` |
| New configuration key | `config/*.yml`, `config/custom-environment-variables.yml`, `.env.example`, [Configuration](../installation/configuration.md) |
