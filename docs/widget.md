# Widget integration

The widget is a single self-initializing script, served by AMW at
`<Server.path>/widget.js`. It turns placeholder `<div>` elements into product cards.

## Minimal example

```html
<!doctype html>
<html lang="en">  <!-- (1)! -->
<body>
  <div class="amw" id="B084DN3XVN"></div>  <!-- (2)! -->
  <div class="amw" id="B0192CTN72"></div>

  <script src="/item/widget.js"></script>  <!-- (3)! -->
</body>
</html>
```

1.  The `lang` attribute of `<html>` selects the widget language, see [Languages](#languages).
2.  One `<div>` per product: `class="amw"` and the product **ASIN** as `id`.
3.  Load the script once per page, from your AMW server (here proxied under `/item`).

## Markup

| Attribute | Required | Description |
|---|---|---|
| `class="amw"` | yes | The script processes every `div.amw` element (only `<div>` elements are matched). |
| `id` | yes | The Amazon product identifier (ASIN). Elements without `id` are ignored with a console warning. |

Notes:

- The widget looks products up **by ASIN only**. Keyword search is available through the
  [`/product?keyword=`](api.md#get-product) API but not through the widget markup.
- Since `id` must be unique in an HTML page, the same product can only appear once per
  page.
- While loading, the script replaces the element's `class` with `amw-widget` (plus
  `amw-widget-lazy` until data is requested) and stores `data-product-id` and
  `data-language` on it.

## Languages

The language is read from the page's `<html lang="...">` attribute and must be one of
the exact values below. Any other value, including regional variants such as `en-US`,
and a missing attribute fall back to **French**.

| `lang` | Language | Button label |
|---|---|---|
| `fr` | French (default) | ➕ Plus d'infos |
| `en` | English | 🚀 Let's go ! |
| `es` | Spanish | 🚀 Yo voy ! |
| `de` | German | 🚀 Los geht's! |
| `it` | Italian | 🚀 Andiamo! |
| `pt` | Portuguese | 🚀 Vamos lá! |
| `nl` | Dutch | 🚀 Laten we gaan! |

Prices are displayed as formatted by Amazon for the configured marketplace.

## What a card shows

- the product's main image, title (truncated to 70 characters) and price, or a
  "not available" label when Amazon returns no offer;
- a `-NN%` badge when the offer has savings;
- the date of the last product update (the time AMW fetched it from Amazon);
- the whole card is a link to the product page with your partner tag, opened in a new
  tab with `rel="sponsored nofollow"`.

For each product, a schema.org `Product` JSON-LD block (name, image, brand, SKU/ASIN,
offer price and availability) is appended to `<head>` to help search engines.

## API location { #api-location }

The script calls `window.location.origin + "/item"`, i.e. **the origin of the page that
embeds it**, under the `/item` path:

```text
https://your-site.example/item/product?id=B084DN3XVN
```

The recommended setup is therefore:

- AMW configured with `Server.path: /item` (the default in `config/docker.yml`);
- your web server proxying `/item/` to AMW ([Reverse proxy](getting-started/reverse-proxy.md)).

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

## Loading behaviour

| Setting | Value |
|---|---|
| Lazy loading | `IntersectionObserver`, starts 50 px before the card enters the viewport (immediate loading if unsupported) |
| Request timeout | 10 s |
| Retries | 1 retry after 1 s on timeout or error |
| In-memory cache | 5 minutes per product and language, per page |
| Dynamic content | `div.amw` elements added after page load are processed automatically |

When the product cannot be loaded (404, network error, timeout), the card shows a
localized error message.

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
| `setApiConfig({ timeout, retryAttempts, retryDelay })` | Tunes the request timeout (ms), total number of attempts and delay between attempts (ms). |
| `getCacheStats()` / `clearCache()` | Inspects or clears the in-memory product cache. |
| `isLazyLoadingSupported()` | `true` if `IntersectionObserver` is available. |
| `destroy()` | Disconnects the lazy loading observer. |

## Styling

The script injects its stylesheet once, in `<style id="amw-widget-styles">`. Every class
it uses is prefixed with `amw-widget` (`.amw-widget`, `.amw-widget-title`,
`.amw-widget-price`, `.amw-widget-badge`, ...), so you can override the look from your
own CSS, for example:

```css
.amw-widget { border-color: #ff9900; }
```

## Example

![AMW widgets in a French blog post](assets/amazon-modern-widget.png){ width="600" loading=lazy }

## Legacy iframe integration

Older AMW versions offered a `/card` endpoint for iframe embedding. It no longer exists:
use the JavaScript widget.
