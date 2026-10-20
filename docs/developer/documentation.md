# Documentation site

This site is the single source of project documentation. It is built with
[MkDocs](https://www.mkdocs.org/) and
[Material for MkDocs](https://squidfunk.github.io/mkdocs-material/), and published to
<https://ltoinel.github.io/amw/> by the [documentation workflow](ci-cd.md#documentation).
Update it in the same pull request as the behaviour or configuration it describes.

| Path | Content |
|---|---|
| `mkdocs.yml` | Site configuration and navigation |
| `docs/` | Pages, in three parts: `user-guide/`, `installation/`, `developer/` |
| `docs/overrides/` | Theme overrides (Docker pulls in the header) |
| `docs/stylesheets/`, `docs/javascripts/` | Custom styles and scripts |
| `docs/assets/screenshots/` | Generated screenshots (see below) |
| `docs/requirements.txt` | Pinned Python dependencies |

## Build and preview

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r docs/requirements.txt
mkdocs serve            # live preview on http://127.0.0.1:8000/amw/
mkdocs build --strict   # what CI runs: warnings, broken links and anchors are errors
```

The configuration reference embeds the real `config/*.yml` files (`pymdownx.snippets`),
so it cannot drift from the shipped samples.

## Screenshots

The user guide images are captured from the real product: the compiled server, the
real widget and the end-to-end [mock Amazon API](testing.md#end-to-end-tests) with a
catalog of demo products. Product images are replaced by simple illustrations, since the
mock points to Amazon's CDN.

```bash
npx playwright install --with-deps chromium   # once
npm run docs:screenshots                       # builds, then writes docs/assets/screenshots/*.png
```

The script is `scripts/docs-screenshots.ts`. It captures:

| File | Shows |
|---|---|
| `blog-article.png` | A blog article with three cards |
| `product-card.png` | A card with a savings badge |
| `product-unavailable.png` | A card without offer |
| `product-card-fr.png` | The same card on a French page |
| `product-lazy.png` | The lazy loading placeholder |
| `product-error.png` | The error state |
| `swagger-ui.png` | The Swagger UI (`Server.swagger: true`) |

Regenerate them when the widget's look changes, optionally optimise them losslessly
(any PNG optimiser), and commit them. On Linux, the widget's emoji labels need an emoji
font (`fonts-noto-color-emoji`, installed by `playwright install --with-deps`).
