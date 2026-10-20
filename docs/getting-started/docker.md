# Run with Docker

The official image is published for `linux/amd64` and `linux/arm64` on two registries:

=== "Docker Hub"

    ```bash
    docker pull ltoinel/amw:latest
    ```

=== "GitHub Container Registry"

    ```bash
    docker pull ghcr.io/ltoinel/amw:latest
    ```

## What is inside the image

| Item | Value |
|---|---|
| Base image | `node:24-alpine` (multi-stage build, production dependencies only) |
| User | `amw` (UID 1001), non-root; application files are read-only for it |
| Package managers | removed (`npm`, `npx`, `corepack`, `yarn` are not shipped) |
| Entrypoint | `dumb-init -- node dist/main.js` (proper signal handling) |
| `NODE_ENV` | `docker`, so [`config/docker.yml`](../configuration.md#docker-defaults) is loaded |
| Port | `9080` |
| API base path | `/item` |
| Health check | `wget http://localhost:9080/item/health` every 30 s |

## Provide your configuration

The image ships `config/docker.yml` with sensible defaults (port 9080, path `/item`,
Redis on `localhost`, 1 trusted proxy hop). Your credentials and overrides go in a
**`local.yml`** file mounted next to it: [node-config](https://github.com/node-config/node-config)
loads `local.yml` after `docker.yml`, so you only need the keys you want to change.

```yaml title="local.yml"
Amazon:
  credentialId: <YOUR CREDENTIAL ID>
  credentialSecret: <YOUR CREDENTIAL SECRET>
  version: "3.2"            # your credential version
  partnerTag: <YOUR PARTNER TAG>
  marketplace: www.amazon.fr

Redis:
  enabled: true
  host: redis               # host name of your Redis server
```

!!! warning "`${...}` placeholders in `docker.yml` are not expanded"
    `config/docker.yml` contains shell-style placeholders such as
    `${AMAZON_CREDENTIAL_ID}` or `${REDIS_HOST:-localhost}`. node-config does **not**
    substitute environment variables in YAML files, so these values are used
    literally (and `Redis.enabled` is then a string, which disables Redis).
    Always override `Amazon.*` and `Redis.*` with a mounted `local.yml` as shown here,
    or with the `NODE_CONFIG` environment variable (a JSON document, see
    [Configuration](../configuration.md#environment-variables)).

The file is read by the non-root `amw` user: make sure it is world-readable
(`chmod 644 local.yml`) and mount it read-only.

## Run a single container

```bash
docker run -d --name amw \
  -p 9080:9080 \
  -v "$PWD/local.yml:/app/config/local.yml:ro" \
  --restart unless-stopped \
  ltoinel/amw:latest

curl http://localhost:9080/item/health
```

If you do not run Redis, set `Redis.enabled: false` in `local.yml`.

## Run AMW and Redis with Docker Compose

The repository contains a ready-made stack in
[`docker/docker-compose.yml`](https://github.com/ltoinel/amw/blob/develop/docker/docker-compose.yml)
(AMW built from source + `redis:7-alpine` with
[`docker/config/redis/redis.conf`](https://github.com/ltoinel/amw/blob/develop/docker/config/redis/redis.conf):
AOF persistence, 256 MB `allkeys-lru`). A minimal standalone equivalent using the
published image:

```yaml title="docker-compose.yml"
services:
  amw:
    image: ltoinel/amw:latest
    ports:
      - "9080:9080"
    volumes:
      - ./local.yml:/app/config/local.yml:ro   # contains Redis.host: redis
    depends_on:
      - redis
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data
    restart: unless-stopped

volumes:
  redis-data:
```

```bash
docker compose up -d
docker compose ps
docker compose logs -f amw
```

When working from a clone of the repository, `npm run docker` runs
`docker/scripts/start.sh`, which starts `docker/docker-compose.yml` with the legacy
`docker-compose` command. Add the `local.yml` volume to that file first.

## Build the image yourself

```bash
git clone https://github.com/ltoinel/amw.git
cd amw
docker build -f docker/Dockerfile -t amw:local .
# or: ./docker/scripts/build.sh [tag]
```

## Next steps

- Put AMW behind your [reverse proxy](reverse-proxy.md) under `/item`.
- [Add the widget](../widget.md) to your pages.
