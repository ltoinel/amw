# Features

## Server

- **JSON product API**: look up a product by ASIN (`id`) or by search keyword
  (`keyword`); see [HTTP API](api.md).
- **Amazon Creators API client**: built on
  [`amazon-creators-api`](https://www.npmjs.com/package/amazon-creators-api). AMW requests
  the primary large image, the title, the brand and the first offer's price and savings.
- **Redis cache** (optional): every product found is stored under
  `amw:product:id:<ASIN>` or `amw:product:keyword:<keyword>` with a configurable TTL
  (`Redis.expire`). A Redis failure never breaks a request: AMW falls back to the
  Amazon API.
- **HTTP caching**: every response carries `Cache-Control: max-age=<Server.httpCache>`,
  so browsers, reverse proxies and CDNs can cache it.
- **Per-IP rate limiting** on `/product` (`Server.rateLimit` requests per minute) to
  protect your Amazon quota, with standard `RateLimit` headers and HTTP 429.
- **Input validation**: missing, empty, non-string or too long parameters are rejected
  with HTTP 400; control characters and `< > " '` are stripped.
- **Timeouts**: an Amazon call taking more than 30 seconds returns HTTP 504.
- **Health and info endpoints** for monitoring, including the Redis connection state.
- **Reverse-proxy aware**: `Server.trustProxy` controls how the client IP is derived
  from `X-Forwarded-For`.
- **Graceful shutdown** on `SIGTERM`, `SIGINT` and `SIGUSR2` (HTTP server and Redis
  connection are closed cleanly).

## Widget

- **One script, many products**: every `<div class="amw" id="ASIN">` on the page
  becomes a product card.
- **Lazy loading** with `IntersectionObserver`: product data is fetched only when the
  card is about to become visible.
- **Dynamic content**: cards added to the page later (single-page apps, infinite
  scroll) are detected by a `MutationObserver`.
- **Seven languages**: French, English, Spanish, German, Italian, Portuguese and Dutch,
  picked from the page's `<html lang>` attribute.
- **Resilient**: 10 second timeout, one automatic retry, localized error messages.
- **Client-side cache**: identical products on a page are fetched once and kept in
  memory for 5 minutes.
- **SEO**: schema.org `Product` JSON-LD injected for each rendered product; links are
  marked `rel="sponsored nofollow"`.
- **XSS-safe rendering**: product data is written with `textContent`, URLs are limited
  to `http(s)`.
- **Self-contained styling**: CSS is injected once (`<style id="amw-widget-styles">`),
  all classes are prefixed with `amw-widget`.

## Distribution

- **Docker images** `ltoinel/amw` (Docker Hub) and `ghcr.io/ltoinel/amw` for
  `linux/amd64` and `linux/arm64`: multi-stage build, Node.js 24 Alpine, non-root user,
  no package manager at runtime, built-in health check.
- **npm package** [`amazon-modern-widgets`](https://www.npmjs.com/package/amazon-modern-widgets)
  containing the compiled server and widget.
