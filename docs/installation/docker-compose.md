# Docker Compose with Redis

The recommended production setup: AMW and a Redis cache, so that most page views never
reach the Amazon API (see [Caching & quotas](../user-guide/caching.md)).

## Option A: published image

### Step 1: create a directory with your `.env`

```bash
mkdir amw && cd amw
# create .env with your Creators API credentials (see the installation overview)
echo "REDIS_PASSWORD=$(openssl rand -hex 24)" >> .env
```

`REDIS_PASSWORD` protects Redis: without it, any container on the same Docker network
could rewrite the cached products, and therefore the links your widgets render. AMW
reads it from the same `.env`.

### Step 2: write `docker-compose.yml`

```yaml title="docker-compose.yml"
services:
  amw:
    image: ltoinel/amw:latest          # pin a release tag (X.Y.Z) in production
    ports:
      - "127.0.0.1:9080:9080"          # only the local reverse proxy needs access
    env_file: .env
    environment:
      REDIS_ENABLED: "true"
      REDIS_HOST: redis
    depends_on:
      redis:
        condition: service_healthy     # AMW exits if Redis is unreachable at startup
    restart: unless-stopped

  redis:
    image: redis:8-alpine
    env_file: .env                     # for REDIS_PASSWORD
    # Refuses to start without a password; the image entrypoint still drops root
    command:
      - sh
      - -c
      - ': "$${REDIS_PASSWORD:?set REDIS_PASSWORD in .env}"; exec docker-entrypoint.sh redis-server --requirepass "$$REDIS_PASSWORD"'
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD-SHELL", "REDISCLI_AUTH=\"$$REDIS_PASSWORD\" redis-cli ping | grep -q PONG"]
      interval: 10s
    restart: unless-stopped

volumes:
  redis-data:
```

### Step 3: start the stack

```bash
docker compose up -d
docker compose ps
docker compose logs -f amw
```

Then [verify](verify.md) it and [expose it on your blog](reverse-proxy.md).

## Option B: from a clone, with `./start.sh`

The repository ships a production stack,
[`docker/docker-compose.yml`](https://github.com/ltoinel/amw/blob/develop/docker/docker-compose.yml):
it builds AMW from source and runs it with `redis:8-alpine` configured by
[`docker/config/redis/redis.conf`](https://github.com/ltoinel/amw/blob/develop/docker/config/redis/redis.conf)
(AOF persistence, `allkeys-lru` eviction). It reads the `.env` file at the repository
root, which must set `REDIS_PASSWORD` (Redis refuses to start without it), and sets
`REDIS_ENABLED=true` and `REDIS_HOST=redis` itself.

```bash
git clone https://github.com/ltoinel/amw.git
cd amw
cp .env.example .env        # then fill in your credentials
./start.sh docker           # same as: npm run docker
```

`./start.sh docker` checks that Docker and Compose v2 are available, warns if `.env` is
missing, builds and starts the stack in the background and prints the health URL
(`http://localhost:9080/item/health`).

```bash
./start.sh stop             # stops the dev and production stacks, keeps the Redis volume
```

Without the script:

```bash
docker compose -f docker/docker-compose.yml up -d --build
docker compose -f docker/docker-compose.yml logs -f amw
docker compose -f docker/docker-compose.yml down
```

!!! important "Port published on `127.0.0.1` only"
    Both options publish port `9080` on the loopback interface only: the image trusts
    one proxy hop (`Server.trustProxy: 1`), so a client reaching AMW directly could
    forge its IP with `X-Forwarded-For` and bypass every per-IP rate limit. Keep it
    that way and let the [reverse proxy](reverse-proxy.md) on the host connect to
    `127.0.0.1:9080`. To expose AMW without a proxy, publish `9080:9080` **and** set
    `SERVER_TRUST_PROXY=false`.
