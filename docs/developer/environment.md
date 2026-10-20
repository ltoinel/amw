# Development environment

## Prerequisites

- **Either** Node.js 26 and npm (local run), **or** Docker with Compose v2 (dev
  container); VS Code with the Dev Containers extension is optional
- Optional: Redis (cache) for a local run
- Optional: Python 3 (documentation site)

## Credentials

Every development setup reads the Amazon credentials from environment variables
([reference](../installation/configuration.md#environment-variables)), so no credential ever lands in
a committed file:

```bash
git clone https://github.com/ltoinel/amw.git
cd amw
cp .env.example .env     # fill in AMAZON_*; .env is never committed
```

The development configuration is the committed `config/development.yml`
(port `8080`, path `/amw`, debug logs, 60 s HTTP cache, Redis disabled).

## The start script

`./start.sh` at the repository root is the single entry point to run the project:

| Command | What it does |
|---|---|
| `./start.sh` or `./start.sh local` | Checks Node.js >= 26, runs `npm ci` if dependencies are missing or outdated, builds, then runs `node dist/main.js` with `config/production.yml`. `SERVER_PROJECT_DIR` defaults to the clone. |
| `./start.sh local --env development` | Same, with `config/development.yml` (`--env NAME` loads `config/NAME.yml`). |
| `./start.sh dev` | Starts the [Docker development environment](#docker-development-environment) in the foreground: <http://localhost:8080/amw> |
| `./start.sh docker` | Builds and starts the production stack (AMW + Redis) in the background: <http://localhost:9080/item> |
| `./start.sh stop` | Stops both Docker stacks (data volumes are kept). |
| `./start.sh --help` | Shows the help. |

The Docker modes require Compose v2 (`docker compose`, or `docker-compose` v2) and warn
when `.env` is missing. The local mode does not read `.env`: export the variables in
your shell or put the credentials in the YAML file.

## Docker development environment

[`docker/docker-compose.dev.yml`](https://github.com/ltoinel/amw/blob/develop/docker/docker-compose.dev.yml)
runs the app from the bind-mounted sources with hot reload, next to a Redis server:

```bash
./start.sh dev
# or: docker compose -f docker/docker-compose.dev.yml up --build
curl http://localhost:8080/amw/health      # AMW_DEV_PORT overrides the host port
```

- The image ([`docker/Dockerfile.dev`](https://github.com/ltoinel/amw/blob/develop/docker/Dockerfile.dev))
  is Node.js 26 Alpine with dev dependencies and git; it runs `npm run dev` as the
  `node` user (UID 1000), so files written to the bind mount stay owned by you.
- `node_modules` lives in a named volume, never mixed with a host install built for
  another OS.
- The compose file loads `.env` (optional) and forces `NODE_ENV=development`,
  `REDIS_ENABLED=true`, `REDIS_HOST=redis` and `SERVER_PROJECT_DIR=/app/`.
- The server restarts on every change in `src/` or `config/`.

### VS Code Dev Containers

[`.devcontainer/devcontainer.json`](https://github.com/ltoinel/amw/blob/develop/.devcontainer/devcontainer.json)
reuses the same compose file: open the repository in VS Code and run
**Dev Containers: Reopen in Container**. You get the ESLint and Jest extensions, a
terminal inside the `app` container (`/app`) and the running dev server; the stack is
stopped when the window closes.

## Without Docker

```bash
npm ci
export SERVER_PROJECT_DIR="$PWD/"   # config/development.yml points to /app/
npm run dev
```

`npm run dev` builds the widget, then runs `src/main.ts` through `ts-node` with
`NODE_ENV=development` and restarts on changes in `src/` and `config/` (`node --watch`).
The widget is served from its minified copy in `dist/`: after editing
`src/widgets/widget.js`, run `npm run build:widgets` (or restart `npm run dev`).

## npm scripts

| Command | Description |
|---|---|
| `npm run dev` | Development server with automatic restart (see above). |
| `npm run build` | Cleans `dist/`, compiles TypeScript (`tsc`) and minifies the widget (`scripts/build-widgets.js`). |
| `npm run build:widgets` | Minifies `src/widgets/widget.js` into `dist/widgets/`. |
| `npm start` | Runs the compiled server (`node .`, i.e. `dist/main.js`). Build first. |
| `npm run lint` / `npm run lint:fix` | ESLint on `src/**/*.ts`. |
| `npm test` | Jest test suites. |
| `npm run test:coverage` | Jest with a coverage report in `coverage/`. |
| `npm run test:ci` | Jest in CI mode with coverage (used by the CI workflow). |
| `npm run test:e2e` | API end-to-end tests against the compiled server (build first). |
| `npm run test:e2e:browser` | Browser end-to-end tests with Playwright (build first). |
| `npm run docs:screenshots` | Builds, then regenerates the user guide screenshots. |
| `npm run docker` | Same as `./start.sh docker`. |
| `npm run release` | Interactive release with release-it, see [Release process](release.md). |

Before opening a pull request, run (details in [Tests & quality](testing.md)):

```bash
npm run lint && npm run build && npm test
npm audit --audit-level high
```


