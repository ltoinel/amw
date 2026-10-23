# Add widgets to your website

The widget is a single self-initializing script, served by AMW at
`<Server.path>/widget.js`. It turns placeholder `<div>` elements into
[product cards](widget.md). This page is for blog owners and web developers who embed it.

## Minimal example

```html
<!doctype html>
<html lang="en">  <!-- (1)! -->
<head>
  <script src="/item/widget.js" defer></script>  <!-- (2)! -->
</head>
<body>
  <div class="amw" id="B084DN3XVN"></div>  <!-- (3)! -->
  <div class="amw" id="B0192CTN72"></div>
</body>
</html>
```

1.  The `lang` attribute of `<html>` selects the widget language, see [Languages](widget.md#languages).
2.  Load the script once per page, from your AMW server (here proxied under `/item`),
    with `defer`: see [Loading the script efficiently](#loading-the-script-efficiently).
3.  One `<div>` per product: `class="amw"` and the product **ASIN** as `id`.

In a CMS, paste the `<div>` into an HTML block of your article (Ghost "HTML card",
WordPress "Custom HTML" block, ...) and add the `<script>` tag once to your theme or
site-wide code injection.

## Markup

| Attribute | Required | Description |
|---|---|---|
| `class="amw"` | yes | The script processes every `div.amw` element (only `<div>` elements are matched). |
| `id` | yes | The Amazon product identifier (ASIN). Elements without `id` are ignored with a console warning. |

- The widget looks products up **by ASIN only**. Keyword search is available through the
  [`/product?keyword=`](api.md#get-product) API but not through the widget markup.
- Since `id` must be unique in an HTML page, the same product can only appear once per
  page.
- The ASIN is the 10-character code in the product URL on Amazon
  (`https://www.amazon.fr/dp/B084DN3XVN`).

## Loading the script efficiently

Load `widget.js` with **`defer`** so that it never blocks the rendering of your page:

```html
<head>
  <!-- Product images are served by Amazon's CDN: open the connection early -->
  <link rel="preconnect" href="https://m.media-amazon.com">
  <script src="/item/widget.js" defer></script>
</head>
```

- **`defer`** (recommended): the script downloads in parallel with the HTML and runs
  once the document is parsed, so every `div.amw` already exists when it initializes.
  It can therefore be placed in `<head>`.
- **`async`** also works: the script runs as soon as it is downloaded and waits for
  `DOMContentLoaded` itself if the page is still loading. Execution order relative to
  your other scripts is not guaranteed, which is why `defer` is preferred.
- **`preconnect`**: product images come from `https://m.media-amazon.com`, a different
  origin from your site. A preconnect hint lets the browser resolve DNS and open the TLS
  connection before the first image is requested. If AMW itself is served from another
  origin (see [API location](#api-location)), add a preconnect for that origin too; for
  the usual same-origin `/item` setup it is not needed.

!!! note
    The `apiBaseUrl` override described in [API location](#api-location) needs a
    synchronous (non-`defer`, non-`async`) `<script>` tag, because the inline script
    that follows it must run after `widget.js`.

## API location { #api-location }

The script calls `window.location.origin + "/item"`, i.e. **the origin of the page that
embeds it**, under the `/item` path:

```text
https://your-blog.example/item/product?id=B084DN3XVN
```

The recommended setup is therefore:

- AMW configured with `Server.path: /item` (the default in `config/docker.yml`);
- your web server proxying `/item/` to AMW
  ([Reverse proxy](../installation/reverse-proxy.md)).

If AMW lives elsewhere, override the base URL right after loading the script. The
script initializes on `DOMContentLoaded` and fetches data lazily, so a synchronous
inline script placed immediately after it runs before any request:

```html
<script src="https://amw.example.com/amw/widget.js"></script>
<script>
  AmwWidget.config.apiBaseUrl = "https://amw.example.com/amw";
</script>
```

A cross-origin API also requires `Server.cors: true` on the AMW server.

## JavaScript API

The script exposes `window.AmwWidget`:

| Member | Description |
|---|---|
| `config` | The live configuration object (`apiBaseUrl`, `performance`, `lazyLoading`, `api`, `languages`). |
| `init()` | Processes the page again (the script already calls it automatically). |
| `transformElement(el)` | Renders a `div` immediately. |
| `transformLazyElement(el)` | Renders a `div` with lazy loading. |
| `enableLazyLoading()` / `disableLazyLoading()` | Toggles lazy loading for widgets processed afterwards. |
| `loadAllWidgets()` | Loads every pending lazy widget now (e.g. before printing). |
| `setTranslations(language, labels)` | Adds a language or overrides labels (see [Languages](widget.md#languages)). |
| `setApiConfig({ timeout, retryAttempts, retryDelay })` | Tunes the request timeout (ms), total number of attempts and delay between attempts (ms). |
| `getCacheStats()` / `clearCache()` | Inspects or clears the in-memory product cache. |
| `isLazyLoadingSupported()` | `true` if `IntersectionObserver` is available. |
| `destroy()` | Disconnects the lazy loading observer. |

## Styling

The script adds its stylesheet once, as `<link id="amw-widget-styles" rel="stylesheet">`
pointing to `widget.css`, served next to `widget.js` (so browsers cache it separately;
if it fails to load, cards remain plain links). Every class it uses is prefixed with
`amw-widget` (`.amw-widget`, `.amw-widget-title`, `.amw-widget-price`,
`.amw-widget-badge`, ...), so you can override the look from your own CSS. The widget
appends its stylesheet at the end of `<head>`, so it wins over your rules of equal
specificity: make yours more specific, for example:

```css
body .amw-widget { border-color: #ff9900; }
```

While loading, the script replaces the element's `class` with `amw-widget` (plus
`amw-widget-lazy` until data is requested) and stores `data-product-id` and
`data-language` on it.

## Legacy iframe integration

Older AMW versions offered a `/card` endpoint for iframe embedding. It no longer exists:
use the JavaScript widget.
