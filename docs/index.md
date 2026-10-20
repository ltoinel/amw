---
hide:
  - navigation
---

# Amazon Modern Widgets

![Amazon Modern Widgets logo](assets/amw-logo.png){ width="420" }

**Amazon Modern Widgets (AMW)** lets Amazon Associates display attractive, responsive
product cards on their websites instead of the dated widgets offered by Amazon.

AMW is made of two parts:

- a small **Node.js / Express server** that queries the
  [Amazon Creators API](https://affiliate-program.amazon.com/creatorsapi) with your
  affiliate credentials, caches the results in Redis and exposes a simple JSON API;
- an embeddable **JavaScript widget** (`widget.js`) that turns
  `<div class="amw" id="ASIN"></div>` placeholders into clickable product cards
  carrying your partner tag.

It works with any website or CMS that lets you insert HTML: Ghost, WordPress, Drupal,
Joomla, Dotclear, static site generators, and so on.

![Three AMW widgets rendered in a blog post](assets/amazon-modern-widget.png){ width="600" loading=lazy }

<div class="grid cards" markdown>

-   :material-rocket-launch:{ .lg .middle } **Get started in minutes**

    ---

    Run the official Docker image or the npm package, add one `<script>` tag and a
    `<div>` per product.

    [:octicons-arrow-right-24: Getting started](getting-started/index.md)

-   :material-cog:{ .lg .middle } **Configure**

    ---

    Every configuration key, its default and its effect.

    [:octicons-arrow-right-24: Configuration](configuration.md)

-   :material-widgets:{ .lg .middle } **Integrate the widget**

    ---

    HTML snippet, languages, lazy loading and the `window.AmwWidget` JavaScript API.

    [:octicons-arrow-right-24: Widget integration](widget.md)

-   :material-api:{ .lg .middle } **HTTP API**

    ---

    `/product`, `/widget.js`, `/health` and `/info`, with every status code.

    [:octicons-arrow-right-24: HTTP API](api.md)

</div>

## Why AMW?

- **Modern look**: responsive cards with image, title, price, discount badge and a
  call-to-action button, styled independently of your theme.
- **Fast pages**: product data is loaded asynchronously and only when the widget scrolls
  into view.
- **Quota friendly**: Redis and HTTP caching keep the number of Amazon API calls low.
- **SEO friendly**: each rendered product adds schema.org `Product` JSON-LD to the page.
- **Safe**: product data is treated as untrusted, the server validates every parameter
  and rate limits the product endpoint per client IP.
- **Easy to run**: multi-architecture Docker image (`linux/amd64`, `linux/arm64`) on
  Docker Hub and GHCR, or a plain npm package.

## Project links

| | |
|---|---|
| Source code | [github.com/ltoinel/amw](https://github.com/ltoinel/amw) |
| npm package | [`amazon-modern-widgets`](https://www.npmjs.com/package/amazon-modern-widgets) |
| Docker images | [`ltoinel/amw`](https://hub.docker.com/r/ltoinel/amw) and `ghcr.io/ltoinel/amw` |
| Tutorial (French) | [Amazon affiliation with Modern Widgets](https://www.geeek.org/amazon-affiliation-modern-widgets/) |
| License | [MIT](https://github.com/ltoinel/amw/blob/develop/LICENSE) |
