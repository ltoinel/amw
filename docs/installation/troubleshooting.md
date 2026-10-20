# Troubleshooting

Start with the logs: `docker logs amw`, `docker compose logs -f amw`, or the terminal of
`./start.sh`. Set `SERVER_DEBUG=true` (or `Server.debug: true`) temporarily to log the
full Amazon responses; turn it off afterwards.

## The server exits at startup

| Log or symptom | Cause and fix |
|---|---|
| Redis connection errors, then exit | Redis is enabled but unreachable. Start Redis first, check `REDIS_HOST`/`REDIS_PORT`, or set `REDIS_ENABLED=false`. |
| `Invalid port configuration` | `Server.port` / `SERVER_PORT` must be between 1 and 65535. |
| `Invalid relative path` | `Server.path` / `SERVER_PATH` must start with `/`. |
| `Server.projectDir configuration is required` | Set `Server.projectDir` or `SERVER_PROJECT_DIR` (absolute path). |
| `EADDRINUSE` | Another process uses the port: change `SERVER_PORT` or the published Docker port. |
| `./start.sh` says Compose v2 is required | Install the Docker Compose plugin (`docker compose version` must work). |

## `/product` answers 404 for every product

AMW reports any Amazon failure as "Product Not Found". Enable debug logs and look for
`Error calling Amazon Creators API`:

- **401 / invalid credentials**: check `AMAZON_CREDENTIAL_ID`, `AMAZON_CREDENTIAL_SECRET`
  and `AMAZON_CREDENTIAL_VERSION`, and that they belong to the marketplace in
  `AMAZON_MARKETPLACE`.
- **Throttling / quota**: Amazon limits calls per account; enable Redis and see
  [Caching & quotas](../user-guide/caching.md).
- **Item not accessible**: the ASIN does not exist or is not available on that
  marketplace.

## The widget shows nothing or an error

| Symptom | Check |
|---|---|
| The `<div>` stays empty | `widget.js` loads (`/item/widget.js` returns 200)? The element is a `<div>` with `class="amw"` and an `id`? |
| "Connection error" in the card | Open the browser console and network tab: the `/item/product` request must reach AMW on **the page's own origin**. See [API location](../user-guide/integration.md#api-location). |
| Card in French on an English site | Set `<html lang="en">` exactly (regional codes such as `en-US` fall back to French). |
| `/item/widget.js` returns 500 | `Server.projectDir` must point to the directory containing `dist/widgets/widget.js`, with no hidden (dot) directory in its path. |
| Old widget after an upgrade | Purge browser, proxy and CDN caches (`Server.httpCache`). |

## HTTP 429 Too Many Requests

A visitor (or a bot) exceeded `Server.rateLimit` requests per minute. Behind a reverse
proxy, check that `Server.trustProxy` matches the number of proxies: with `false`, every
visitor shares the proxy's IP and the limit is reached quickly. Since error responses
are also sent with `Cache-Control: max-age`, a proxy may keep serving a 429 for a while.

## Still stuck?

Open an [issue](https://github.com/ltoinel/amw/issues/new/choose) with the AMW version
(`/item/health`), how you run it and the relevant logs, **without credentials**.
Security problems go through the [security policy](https://github.com/ltoinel/amw/blob/develop/SECURITY.md).
