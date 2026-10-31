<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/banner-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/banner-light.svg">
  <img alt="Amazon Modern Widgets: fast, beautiful Amazon product cards for your blog" src="docs/assets/banner-light.svg" width="860">
</picture>

[![CI](https://img.shields.io/github/actions/workflow/status/ltoinel/amw/ci.yml?branch=develop&label=CI&logo=github)](https://github.com/ltoinel/amw/actions/workflows/ci.yml?query=branch%3Adevelop)
[![Coverage](https://img.shields.io/endpoint?url=https://ltoinel.github.io/amw/badges/coverage.json)](https://ltoinel.github.io/amw/developer/testing/#coverage-thresholds)
[![npm version](https://img.shields.io/npm/v/amazon-modern-widgets?logo=npm)](https://www.npmjs.com/package/amazon-modern-widgets)
[![Docker pulls](https://img.shields.io/docker/pulls/ltoinel/amw?logo=docker)](https://hub.docker.com/r/ltoinel/amw)
[![License](https://img.shields.io/github/license/ltoinel/amw)](LICENSE)

</div>

**Amazon Modern Widgets (AMW)** replaces the dated Amazon affiliate widgets with fast,
responsive product cards. A small Node.js server queries the Amazon Creators API with
your partner tag and caches the results in Redis. A single `widget.js` turns
`<div class="amw" id="ASIN">` placeholders into clickable cards on any website or CMS
(Ghost, WordPress, Drupal, static sites…), with lazy loading, seven languages and
SEO-friendly JSON-LD.

## 📖 Full documentation: https://ltoinel.github.io/amw/

## Quick start

Credentials are passed as environment variables: copy
[`.env.example`](.env.example) to `.env` and fill in your Creators API credentials
([all variables](https://ltoinel.github.io/amw/installation/configuration/#environment-variables)).

**Docker** (port `9080`, API under `/item`):

```bash
docker run -d --name amw -p 127.0.0.1:9080:9080 --env-file .env \
  ltoinel/amw:latest            # or ghcr.io/ltoinel/amw:latest
curl http://localhost:9080/item/health
```

**From a clone**, `./start.sh` runs everything (`./start.sh --help`):

```bash
./start.sh docker   # AMW + Redis in Docker, http://localhost:9080/item
./start.sh dev      # development container with hot reload
./start.sh          # local Node.js 26 run with config/production.yml
./start.sh stop     # stop the Docker stacks
```

**npm** (Node.js 26):

```bash
npm install amazon-modern-widgets
mkdir config && cp node_modules/amazon-modern-widgets/config/sample.yml config/production.yml
# edit config/production.yml (credentials, Server.projectDir, Server.path: /item)
node node_modules/amazon-modern-widgets/dist/main.js
```

Then proxy `/item/` from your website to AMW
([NGINX example](https://ltoinel.github.io/amw/installation/reverse-proxy/)).

## Add a widget to your page

```html
<html lang="en">
  <!-- ... -->
  <div class="amw" id="B084DN3XVN"></div>
  <script src="/item/widget.js" defer></script>
</html>
```

<img src="docs/assets/screenshots/blog-article.png" alt="AMW product cards in a blog article" width="560">

See [Add widgets to your website](https://ltoinel.github.io/amw/user-guide/integration/)
for the embedding options, JavaScript API and styling, and
[Product cards](https://ltoinel.github.io/amw/user-guide/widget/) for what readers see
(languages, savings badge, lazy loading).

## Contributing

Issues and pull requests are welcome. Every change follows *issue → branch → pull
request to `develop`* with [Conventional Commits](https://www.conventionalcommits.org/):
see [AGENTS.md](AGENTS.md) and the
[contributing guide](https://ltoinel.github.io/amw/developer/contributing/).

## License

[MIT](LICENSE) © Ludovic Toinel
