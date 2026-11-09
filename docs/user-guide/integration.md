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
site-wide code stuffing.

## Markup

| Attribute | Required | Description |
|---|---|---|
| `class="amw"` | yes | The script processes every `div.amw` element (only `<div>` elements are matched). |
| `id` | yes | The Amazon product identifier (ASIN). Elements without `id` are ignored with a console warning. |

- The widget looks products up **by ASIN only**. Keyword search is available through the
  [`/product?keyword=`](api.md#get-product) API but not through the widget markup.
- Since `id` must be unique in an HTML page, the same product can only appear once per
  page.
- To get the `id` of a product, see [Finding the ASIN of a product](#finding-the-asin).

## Finding the ASIN of a product { #finding-the-asin }

The ASIN is Amazon's product identifier: 10 uppercase letters or digits, such as
`B084DN3XVN`. There are two ways to read it on the product page.

=== "In the address"

    It follows `/dp/` or `/gp/product/` in the address of the page. Ignore what comes
    before and after:

    ```text
    https://www.amazon.fr/Some-Product-Title/dp/B084DN3XVN/ref=sr_1_1?keywords=headphones
                                                ^^^^^^^^^^
    ```

=== "In the product details"

    Scroll down to the **Product details** section (*Détails sur le produit* on
    amazon.fr), which has an **ASIN** line. Books usually show an **ISBN-10** instead,
    which is their ASIN once any hyphens are removed.

To extract it in a script:

```javascript
const asin = url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?#]|$)/)?.[1];
```

- **Short links**: an `amzn.to` link does not contain the ASIN. Open it in your browser
  and read the address of the page it leads to.
- **Variants**: each color or size usually has its own ASIN. Select the variant first, as
  the address then changes.
- **Marketplace**: copy the ASIN from the Amazon site of your
  [`Amazon.marketplace`](../installation/configuration.md). The same product can have
  another ASIN, or none, on another site: Amazon then reports it as missing and the card
  stays hidden.

To check an ASIN, ask your server for it:

```bash
curl "https://www.example.com/item/product?id=B084DN3XVN"
```

Once embedded, a product the Amazon API does not return is listed under **To replace** in the
[administration portal](admin-portal.md).

## Stuffing: adding cards automatically { #stuffing }

Instead of placing each card by hand, the Stuffing function of `widget.js` adds them to your articles. Turn it on
and set the most cards per article in the **Stuffing** view of the [administration portal](admin-portal.md), or
with `Stuffing.count` in the [configuration](../installation/configuration.md). It is off by default, and adds 5
cards at most. Switched off in the portal, it adds no card and keeps its other settings.

Each site has its own Stuffing: the view applies to the active site of the portal, and a site
follows the settings of every site until you save its own. The server writes the settings of
these sites into `widget.js` (`AMW_SITE_SETTINGS`), and the widget applies those of the page's
host.

- **A total**: the cards you already placed in the article container count. With 3 and one card of
  yours in the article, Stuffing adds 2; with three, it adds none. Cards elsewhere on the page
  (sidebar, footer) do not count.
- **Per site**: the **Stuffing** view lists the [sites](admin-portal.md#sites) of the portal, each with its own
  number; an empty field keeps the default.
- **Short articles**: with **words per card** (`Stuffing.wordsPerCard`), an article gets at most
  one card per that many words. With 300, an article of 700 words gets 2 cards at most, one of 250
  words none, whatever the maximum. 0, the default, applies the maximum alone.
- **Where**: at the end of a paragraph, right before an `h2` or `h3` heading of the element whose
  id is the **article container** (`main-content` by default), spread evenly over these places. An
  article with fewer places gets fewer cards, and a heading next to a card you placed yourself is
  left alone.
- **Which products** depends on the **mode**, set in the same view or with `Stuffing.mode`:
  - **Page recommendations** (`recommendation`, the default): one [recommendation](widget.md) per
    page, a single billed call to Claude whatever the number of cards. Claude is asked for that
    number of different products, those a reader is the most likely to buy while reading the
    article. It can return fewer: the other cards then show the **products** listed in the
    **Stuffing** view (ASINs, 20 at most, in order), then, with the
    [`fallback`](../installation/configuration.md), the most clicked products of the site.
    Requires `Recommendation.enabled`, your site in `Server.allowedSites`, Redis and
    `ANTHROPIC_API_KEY`.
  - **Best products of the site** (`popular`): the most clicked products of the page's site over
    the last 30 days, the best first, then the products listed in the **Stuffing** view while the
    site has too few clicks. Clicks are ranked for the sites of the [Sites](admin-portal.md#sites)
    page only, and need Redis. Claude is never called.
  - **Custom product list** (`manual`): the first card shows the first product of the list, the second card
    the second one, and so on, on every page; a product that has left Amazon gives its card to the
    next one. Cards beyond the end of the list stay hidden. Claude is never called, so it works
    without `Recommendation.enabled`.
- **Delay**: a change reaches pages when `widget.js` leaves the browser and CDN caches, up to
  an hour later.
- **Raising the number** bills each page already answered one more call, when a visitor reaches the
  new cards. The products already shown keep their place. `Recommendation.dailyLimit` still applies.
- Pages pinned to a hashed `widget.<hash>.js` do not get these settings and add nothing.

## Debugging { #debugging }

The widget keeps the console of your visitors quiet. To see what it does, add `data-debug`:

```html
<script src="/item/widget.js" data-debug defer></script>
```

From JavaScript, `AmwWidget.setApiConfig({ debug: true })` does the same from that point on.
Warnings about a real problem, such as an unknown theme, always appear.

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
