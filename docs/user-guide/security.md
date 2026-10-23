# Security

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub
[private vulnerability reporting](https://github.com/ltoinel/amw/security/advisories/new)
rather than in a public issue. The supported versions and the disclosure process are
described in the [security policy](https://github.com/ltoinel/amw/blob/develop/SECURITY.md).

## Server

- **Input validation**: `id` (max 50 characters) and `keyword` (max 100) must be
  single strings; control characters and `< > " '` are stripped, and requests left
  without a usable parameter are rejected with HTTP 400 before any cache or Amazon
  lookup.
- **Rate limiting**: `/product` is limited per client IP (`Server.rateLimit` per
  minute) to protect your Amazon quota from abuse.
- **Client IP**: always taken from Express `req.ip`, governed by
  [`Server.trustProxy`](../installation/configuration.md#server); raw `X-Forwarded-For` is never trusted
  directly. Keep `trustProxy` to the exact number of proxies (or their addresses):
  `true` would let clients spoof their IP and bypass the rate limit. A trusted hop
  must also be the only way in: the Docker default (`1`) is only safe when the port
  is reachable by the local reverse proxy alone, which is why the Compose stack and the
  `docker run` examples publish it on `127.0.0.1`. Without a proxy, set
  `SERVER_TRUST_PROXY=false`.
- **Error handling**: unexpected errors return a generic message unless
  `Server.debug` is `true`; never enable debug in production.
- **Headers**: `X-Powered-By` is disabled. CORS is off by default (`Server.cors`).
- **Credentials**: Amazon and Redis secrets are passed as
  [environment variables](../installation/configuration.md#environment-variables) (for example from a
  `.env` file that is never committed) or kept in `config/production.yml`; the
  committed configuration files only hold empty values, and neither the npm package nor
  the Docker image contains credentials.
- **Swagger UI**: disabled by default (`Server.swagger`). When enabled, it is served
  from the AMW origin with a strict `Content-Security-Policy`, a fixed OpenAPI URL and
  no external validator (see [HTTP API](api.md#swagger-ui)).

## Widget

The widget runs on third-party pages, so every value coming from the API is treated as
untrusted:

- text is written with `textContent`, never with raw `innerHTML`;
- image and product URLs go through `safeUrl()`, which only accepts `http:` and
  `https:` (no `javascript:` or `data:` URLs);
- the only HTML built from product data (price with a savings badge) is escaped with
  `sanitizeText()`;
- JSON-LD is serialized with `JSON.stringify` into a `<script type="application/ld+json">`
  element through `textContent`;
- product links use `target="_blank"` with `rel="sponsored nofollow"`.

## Docker image

- runs as the non-root `amw` user (UID 1001); application files are owned by root and
  read-only for that user, and nothing is written to disk at runtime (logs go to stdout);
- `docker/docker-compose.yml` runs it with a read-only root filesystem, every Linux
  capability dropped, `no-new-privileges` and memory/CPU limits; the CI smoke test starts
  the image with the same restrictions;
- the `node:26-alpine` base image is pinned by digest (updated by Dependabot);
- production dependencies only, built in a separate stage;
- `npm`, `npx`, `corepack` and `yarn` are removed from the runtime image;
- `dumb-init` as PID 1 for correct signal handling.
- in the compose stack, Redis requires a password (`REDIS_PASSWORD`), so that another
  container of the network cannot rewrite the cached products.

## Supply chain

- `npm audit --audit-level high` runs in CI and blocks merges.
- Trivy scans the built Docker image (Alpine packages and the Node.js runtime) in CI and
  fails on high or critical vulnerabilities that have a fix.
- The dependency review workflow blocks pull requests that add dependencies with known
  high or critical vulnerabilities or an incompatible copyleft license.
- GitHub CodeQL code scanning (default setup) is enabled, and Dependabot keeps npm
  packages, GitHub Actions, Docker images and Compose files up to date.
- Workflows use a read-only default `GITHUB_TOKEN`; write permissions are granted per
  job only where needed (packages, releases, Pages).
