# Docker (single container)

The quickest way to try AMW: one container, no Redis. For production, prefer
[Docker Compose with Redis](docker-compose.md).

## Step 1: pull the image

The official image is published for `linux/amd64` and `linux/arm64` on two registries:

=== "Docker Hub"

    ```bash
    docker pull ltoinel/amw:latest
    ```

=== "GitHub Container Registry"

    ```bash
    docker pull ghcr.io/ltoinel/amw:latest
    ```

Releases are also tagged `X.Y.Z`, `X.Y` and `X`: pin one of them in production.

## Step 2: write your `.env`

Create a `.env` file with your [Creators API credentials](index.md#amazon-creators-api-credentials).
The image contains no credentials: environment variables are mapped onto the
configuration by `config/custom-environment-variables.yml` (see the
[environment variable reference](configuration.md#environment-variables)).

## Step 3: run the container

```bash
docker run -d --name amw \
  -p 127.0.0.1:9080:9080 \
  --env-file .env \
  --restart unless-stopped \
  ltoinel/amw:latest
```

Then [verify](verify.md) it: `curl http://localhost:9080/item/health`.

!!! warning "Publish the port on `127.0.0.1`"
    The image trusts one proxy hop (`Server.trustProxy: 1`), because AMW is meant to run
    behind a [reverse proxy](reverse-proxy.md) on the same host. A client reaching the
    container directly could then forge its IP with an `X-Forwarded-For` header and
    bypass every per-IP rate limit (`/product`, `/click`, admin login). Keep
    `-p 127.0.0.1:9080:9080`; if AMW must be reachable without a proxy, add
    `-e SERVER_TRUST_PROXY=false`.

Redis is disabled in this mode. To use an existing Redis server, add for example
`-e REDIS_ENABLED=true -e REDIS_HOST=redis.example.lan`.

!!! warning "Redis must be reachable at startup"
    When `REDIS_ENABLED=true`, AMW connects to Redis when it starts and exits if the
    server is unreachable. Start Redis first ([Docker Compose](docker-compose.md) does it
    with a health check).

## What is inside the image

| Item | Value |
|---|---|
| Base image | `node:26-alpine` (multi-stage build, production dependencies only) |
| User | `amw` (UID 1001), non-root; application files are read-only for it |
| Package managers | removed (`npm`, `npx`, `corepack`, `yarn` are not shipped) |
| Entrypoint | `dumb-init -- node dist/main.js` (proper signal handling) |
| `NODE_ENV` | `docker`, so [`config/docker.yml`](configuration.md#docker-defaults) is loaded |
| Port | `9080` |
| API base path | `/item` |
| Redis | disabled by default (`Redis.enabled: false`) |
| Health check | `wget http://localhost:9080/item/health` every 30 s |

## Settings without an environment variable

Settings such as `Server.httpCache` or `Redis.expire` have no
environment variable. Change them by mounting a `local.yml`, which node-config loads
after `docker.yml`:

```bash
docker run -d --name amw -p 127.0.0.1:9080:9080 --env-file .env \
  -v "$PWD/local.yml:/app/config/local.yml:ro" \
  ltoinel/amw:latest
```

The file is read by the non-root `amw` user: make it world-readable (`chmod 644`).
A JSON document in the `NODE_CONFIG` environment variable works too.

## Build the image yourself

From a clone of the repository:

```bash
docker build -f docker/Dockerfile -t amw:local .
# or: ./docker/scripts/build.sh [tag]
```

## Next step

[Expose AMW on your blog](reverse-proxy.md) under `/item`.
