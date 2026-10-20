# Configuration

AMW is configured with [node-config](https://github.com/node-config/node-config): YAML
files located in the `config/` directory of the **current working directory**, plus
[environment variables](#environment-variables) for credentials and the most common
settings.

## Which file is loaded?

`NODE_ENV` selects the file; AMW sets it to `production` when it is not defined.

| `NODE_ENV` | File | Typical use |
|---|---|---|
| `production` (default) | `config/production.yml` | npm / Node.js installs; create it from `config/sample.yml` |
| `docker` | `config/docker.yml` | set by the Docker image |
| `development` | `config/development.yml` | `npm run dev`, the dev container (`./start.sh dev`) |

On top of that file, node-config merges, in this order, `local.yml` and
`local-<NODE_ENV>.yml` if they exist, then the
[environment variables](#environment-variables) mapped by
`config/custom-environment-variables.yml`, and finally the `NODE_CONFIG` environment
variable. Later sources override earlier ones key by key.

!!! danger "Never commit credentials"
    `config/sample.yml`, `config/docker.yml` and `config/development.yml` are committed
    and must only contain placeholders or empty values. Put credentials in environment
    variables (a `.env` file created from `.env.example`, which is never committed) or
    in `config/production.yml`, which is excluded from the repository, the npm package
    and the Docker image.

## Reference

### Amazon

Credentials and defaults for the [Amazon Creators API](https://affiliate-program.amazon.com/creatorsapi).

| Key | Sample value | Description |
|---|---|---|
| `Amazon.credentialId` | `<YOUR CREDENTIAL ID>` | Creators API credential ID. |
| `Amazon.credentialSecret` | `<YOUR CREDENTIAL SECRET>` | Creators API credential secret. |
| `Amazon.version` | `3.2` | Version of your Creators API credential, as shown in the Creators API dashboard. |
| `Amazon.partnerTag` | `<YOUR PARTNER TAG>` | Your Associates tracking ID; it is embedded in every product URL returned by Amazon. |
| `Amazon.marketplace` | `www.amazon.fr` | Marketplace to query, e.g. `www.amazon.com`, `www.amazon.de`. |
| `Amazon.condition` | `New` | Offer condition filter: `New` or `Any`. |

### Server

| Key | `sample.yml` | `docker.yml` | Description |
|---|---|---|---|
| `Server.port` | `8080` | `9080` | HTTP port (1-65535). Falls back to `8080` if empty or `0`. |
| `Server.debug` | `true` | `false` | `true` switches AMW loggers to debug level (full Amazon responses are logged) and exposes error messages in unexpected HTTP 500 responses. Use `false` in production. |
| `Server.path` | `/amw` | `/item` | Base path of every endpoint. Must start with `/`; defaults to `/amw` if empty. The widget expects `/item`, see [API location](widget.md#api-location). |
| `Server.cors` | `false` | `false` | `true` adds `Access-Control-Allow-Origin: *` to every response. Only needed if pages on other origins call the API directly. |
| `Server.projectDir` | `<PATH>` | `/app/` | **Required.** Absolute path of the directory that contains `dist/widgets/widget.js` (repository clone, installed npm package, or `/app/` in Docker). The path must not contain hidden (dot) directories: the file is then refused and `/widget.js` answers 500. |
| `Server.httpCache` | `3600` | `604800` | `max-age` in seconds sent in the `Cache-Control` header of every response. Falls back to `300` if empty or `0`; must not be negative. |
| `Server.rateLimit` | `120` | `120` | Maximum `/product` requests per client IP per one-minute window; beyond it AMW answers HTTP 429. Defaults to `120` when the key is absent. Counters are kept in memory, per AMW process. |
| `Server.swagger` | `false` | `false` | `true` serves an interactive [Swagger UI](api.md#swagger-ui) at `<path>/docs/` and the OpenAPI document at `<path>/openapi.json`. Off by default (and when absent) to keep the public surface minimal. |
| `Server.trustProxy` | `false` | `1` | Express [`trust proxy`](https://expressjs.com/en/guide/behind-proxies.html) setting, which decides how the client IP is derived from `X-Forwarded-For`: `false` (use the socket address), a number of proxy hops (e.g. `1` behind a single NGINX), or a list of trusted addresses/subnets such as `loopback, 10.0.0.0/8`. Avoid `true`: it trusts any `X-Forwarded-For` value. Defaults to `false` when absent. |

### Redis

| Key | `sample.yml` | `docker.yml` | Description |
|---|---|---|---|
| `Redis.enabled` | `false` | `false` | Must be the boolean `true` to enable the cache; any other value disables it. |
| `Redis.host` | `localhost` | `localhost` | Redis host. |
| `Redis.port` | `6379` | `6379` | Redis port. |
| `Redis.username` | empty | empty | Redis ACL user name (optional). |
| `Redis.password` | empty | empty | Redis password (optional). |
| `Redis.expire` | `3600` | `2630000` | Time to live of cached products, in seconds (`2630000` is about one month). Must be positive; defaults to `3600` if empty or `0`. |

When Redis is enabled, AMW connects at startup and **exits if Redis is unreachable**.
If Redis becomes unavailable later, requests still succeed by calling Amazon directly,
and `/health` reports `"redis": "disconnected"`. The Docker Compose stacks enable Redis
with `REDIS_ENABLED=true` and `REDIS_HOST=redis`.

## Environment variables

`config/custom-environment-variables.yml` maps the following variables onto
configuration keys, whatever the `NODE_ENV`. Unset or empty variables are ignored and
the YAML value is kept. Variables marked *JSON* are parsed as JSON, so write `true`,
`false` or a number.

| Variable | Configuration key | Format |
|---|---|---|
| `AMAZON_CREDENTIAL_ID` | `Amazon.credentialId` | string |
| `AMAZON_CREDENTIAL_SECRET` | `Amazon.credentialSecret` | string |
| `AMAZON_CREDENTIAL_VERSION` | `Amazon.version` | string |
| `AMAZON_PARTNER_TAG` | `Amazon.partnerTag` | string |
| `AMAZON_MARKETPLACE` | `Amazon.marketplace` | string |
| `SERVER_PORT` | `Server.port` | JSON |
| `SERVER_DEBUG` | `Server.debug` | JSON |
| `SERVER_PATH` | `Server.path` | string |
| `SERVER_CORS` | `Server.cors` | JSON |
| `SERVER_PROJECT_DIR` | `Server.projectDir` | string |
| `SERVER_RATE_LIMIT` | `Server.rateLimit` | JSON |
| `SERVER_SWAGGER` | `Server.swagger` | JSON |
| `REDIS_ENABLED` | `Redis.enabled` | JSON |
| `REDIS_HOST` | `Redis.host` | string |
| `REDIS_PORT` | `Redis.port` | JSON |
| `REDIS_USERNAME` | `Redis.username` | string |
| `REDIS_PASSWORD` | `Redis.password` | string |

`Amazon.condition`, `Server.httpCache`, `Server.trustProxy` and `Redis.expire` have no
variable: set them in a YAML file (for Docker, a mounted
[`local.yml`](getting-started/docker.md#other-ways-to-configure-the-container)).

[`.env.example`](https://github.com/ltoinel/amw/blob/develop/.env.example) lists the
variables: copy it to `.env`, which is never committed. Both Docker Compose files and
`docker run --env-file .env` read it; for a local Node.js run, export the variables in
your shell.

Other variables:

| Variable | Effect |
|---|---|
| `NODE_ENV` | Selects `config/<NODE_ENV>.yml`. Defaults to `production`; the Docker image sets `docker`. |
| `NODE_CONFIG` | JSON document merged on top of everything else, e.g. `NODE_CONFIG='{"Server":{"httpCache":86400}}'`. |
| `NODE_CONFIG_DIR` | Directory containing the configuration files (default: `./config`). |
| `AMW_DEV_PORT` | Host port of the development container (default `8080`), see [Local development](development.md#docker-development-environment). |

## Docker defaults

`config/docker.yml` as shipped in the image (credentials are empty on purpose: provide
them with environment variables):

```yaml
--8<-- "config/docker.yml"
```

## Development defaults

`config/development.yml`, loaded by `npm run dev` and the dev container:

```yaml
--8<-- "config/development.yml"
```

## Complete sample

`config/sample.yml`, the starting point for `config/production.yml`:

```yaml
--8<-- "config/sample.yml"
```
