# Tests & quality

AMW has three layers of automated tests, all run by CI on every pull request.

| Layer | Command | Runs against | Location |
|---|---|---|---|
| Unit | `npm test` (`npm run test:ci` in CI, with coverage) | the real `src/` modules, with mocked `config`, Redis and Amazon SDK | `tests/*.test.ts` |
| API end-to-end | `npm run test:e2e` | the compiled server (`dist/main.js`) and a mock Amazon API | `tests/e2e/*.e2e.test.ts` |
| Browser end-to-end | `npm run test:e2e:browser` | Chromium (Playwright) rendering the widget from the compiled server | `tests/e2e/browser/*.spec.ts` |

## Unit tests

```bash
npm test                  # all suites
npx jest tests/server.test.ts -t "rate limit"   # one suite / one test name
npm run test:coverage     # with a coverage report in coverage/
```

| Suite | Covers |
|---|---|
| `server.test.ts` | `/product` validation, Redis cache, rate limiting and failures; `/health`, `/widget.js`, other routes and middleware; configuration; startup and shutdown |
| `amwApi.test.ts` | Amazon call timeout and error mapping |
| `settings.test.ts` | Typed settings: defaults, coercions, validation, injection without node-config |
| `paapi.test.ts` | Creators API client: requests, response mapping (`buildProduct`), error handling |
| `swagger.test.ts` | OpenAPI document validity, Swagger UI enabled/disabled routes, CSP, redirect |
| `configLog4j.test.ts` | Logger levels |
| `widget.dom.test.ts` | Widget in jsdom: rendering, structured data, XSS protection, error handling, client cache, lazy loading |
| `widget.build.test.ts` | Minified build output (`dist/widgets/widget.js`, needs `npm run build`) |

The configuration is read once into a typed `Settings` object (`src/server/Settings.ts`) and
passed to `AmwServer`, `AmwApi`, `Paapi` and `AdminApi`. A test can build it with
`loadSettings({ get, has })` from plain values and inject it, without mocking node-config
(see `tests/settings.test.ts`). When a constructor gets no settings it calls `loadSettings()`
itself: `tests/helpers/mocks.ts` resets the module registry and installs a `config` mock for
the tests written that way.

### Coverage thresholds

Coverage is collected from `src/**/*.ts` and `src/widgets/**/*.js` (except
`src/main.ts`). `jest.config.js` enforces minimums slightly below the measured values,
so any regression fails CI:

| Scope | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| Global | 95 % | 85 % | 95 % | 95 % |
| `src/server/` | 98 % | 90 % | 98 % | 98 % |

The README coverage badge shows the line coverage of `develop`, published by the
[documentation workflow](ci-cd.md#documentation).

## End-to-end tests

```bash
npm run build                 # the e2e suites run dist/main.js
npm run test:e2e              # API suites
npx playwright install --with-deps chromium   # once
npm run test:e2e:browser      # browser suite
```

- `tests/e2e/support/mockAmazonApi.ts` is a small Express stand-in for the Creators API
  (OAuth2 token endpoint, `getItems`, `searchItems`). Magic ASINs simulate upstream
  behaviours: `B0NOTFOUND` (404), `B0ERROR500` (Amazon 500, answered 502), `B0XSSPAYLO`
  (malicious data); `getItems` accepts several ASINs (`/products` batches); an optional
  `catalog` returns realistic products (used by the
  [documentation screenshots](documentation.md#screenshots)). `npm run dev:mock` also
  runs it on a fixed port to [develop without Amazon credentials](environment.md#without-amazon-credentials-mock-api).
- `tests/e2e/support/amwServer.ts` spawns the compiled server on a free port with
  `tests/e2e/config/e2e.yml`, pointing it to the mock through the test-only
  `Amazon.apiBasePath` and `Amazon.authEndpoint` settings.
- `cache.e2e.test.ts` needs a Redis server: it runs only when `REDIS_HOST` is set
  (CI provides a Redis service), and is skipped otherwise.
- The browser suite serves a blog article from the AMW origin, checks the rendered card
  (title, price, savings badge, `sponsored` link) and that `javascript:` URLs and HTML
  from the API or the element id are neutralized.

!!! note
    The project directory must not contain hidden (dot) directories in its absolute
    path: the server would refuse to serve `widget.js` (see
    [Configuration](../installation/configuration.md#server)).

## Lint and audit

```bash
npm run lint                     # ESLint on src/**/*.ts
npm run lint:fix
npm audit --audit-level high     # CI blocks on high and critical advisories
```

## Before opening a pull request

```bash
npm run lint && npm run build && npm test
npm run test:e2e                 # recommended when touching the server
npm run test:e2e:browser         # recommended when touching the widget
```
