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

Releases are also tagged `X.Y.Z`, `X.Y` and `X`.

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
| Redis | disabled by default (`Redis.enabled: false`) |
| Health check | `wget http://localhost:9080/item/health` every 30 s |

## Provide your configuration

The image contains no credentials. Pass them as **environment variables**: they are
mapped onto the configuration by `config/custom-environment-variables.yml` (see the
[environment variable reference](../configuration.md#environment-variables)).
The easiest way is a `.env` file, created from the repository's
[`.env.example`](https://github.com/ltoinel/amw/blob/develop/.env.example):

```ini title=".env"
AMAZON_CREDENTIAL_ID=<YOUR CREDENTIAL ID>
AMAZON_CREDENTIAL_SECRET=<YOUR CREDENTIAL SECRET>
AMAZON_CREDENTIAL_VERSION=3.2
AMAZON_PARTNER_TAG=<YOUR PARTNER TAG>
AMAZON_MARKETPLACE=www.amazon.fr
```

`.env` is git-ignored: never commit it.

## Run a single container

```bash
docker run -d --name amw \
  -p 9080:9080 \
  --env-file .env \
  --restart unless-stopped \
  ltoinel/amw:latest

curl http://localhost:9080/item/health
```

Redis is disabled in this mode. To use an existing Redis server, add for example
`-e REDIS_ENABLED=true -e REDIS_HOST=redis.example.lan`.

!!! warning "Redis must be reachable at startup"
    When `REDIS_ENABLED=true`, AMW connects to Redis when it starts and exits if the
    server is unreachable. Start Redis first (Compose does it with a health check).

## Run AMW and Redis with Docker Compose

From a clone of the repository, the production stack
[`docker/docker-compose.yml`](https://github.com/ltoinel/amw/blob/develop/docker/docker-compose.yml)
builds AMW from source and runs it with `redis:7-alpine`
([`docker/config/redis/redis.conf`](https://github.com/ltoinel/amw/blob/develop/docker/config/redis/redis.conf):
AOF persistence, `allkeys-lru` eviction). It reads the optional `.env` file at the
repository root and sets `REDIS_ENABLED=true` and `REDIS_HOST=redis` itself.

```bash
git clone https://github.com/ltoinel/amw.git
cd amw
cp .env.example .env        # then fill in your credentials
./start.sh docker           # same as: npm run docker
./start.sh stop             # stops the stack, keeps the Redis volume
```

`./start.sh docker` requires Docker Compose v2. It builds and starts the stack in the
background and prints the URL (`http://localhost:9080/item/health`). Without the
script:

```bash
docker compose -f docker/docker-compose.yml up -d --build
docker compose -f docker/docker-compose.yml logs -f amw
```

To run the published image instead of building it, a minimal standalone equivalent:

```yaml title="docker-compose.yml"
services:
  amw:
    image: ltoinel/amw:latest
    ports:
      - "9080:9080"
    env_file: .env
    environment:
      REDIS_ENABLED: "true"
      REDIS_HOST: redis
    depends_on:
      redis:
        condition: service_healthy
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
    restart: unless-stopped

volumes:
  redis-data:
```

## Other ways to configure the container

Settings that have no environment variable (for example `Server.httpCache`,
`Server.trustProxy` or `Redis.expire`) can be changed by mounting a `local.yml`, which
node-config loads after `docker.yml`:

```bash
docker run -d --name amw -p 9080:9080 --env-file .env \
  -v "$PWD/local.yml:/app/config/local.yml:ro" \
  ltoinel/amw:latest
```

The file is read by the non-root `amw` user: make it world-readable (`chmod 644`).
A JSON document in the `NODE_CONFIG` environment variable works too.

## Build the image yourself

```bash
docker build -f docker/Dockerfile -t amw:local .
# or: ./docker/scripts/build.sh [tag]
```

## Next steps

- Put AMW behind your [reverse proxy](reverse-proxy.md) under `/item`.
- [Add the widget](../widget.md) to your pages.
