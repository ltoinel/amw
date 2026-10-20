# Docker Compose with Redis

The recommended production setup: AMW and a Redis cache, so that most page views never
reach the Amazon API (see [Caching & quotas](../user-guide/caching.md)).

## Option A: published image

### Step 1: create a directory with your `.env`

```bash
mkdir amw && cd amw
# create .env with your Creators API credentials (see the installation overview)
```

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
it builds AMW from source and runs it with `redis:7-alpine` configured by
[`docker/config/redis/redis.conf`](https://github.com/ltoinel/amw/blob/develop/docker/config/redis/redis.conf)
(AOF persistence, `allkeys-lru` eviction). It reads the optional `.env` file at the
repository root and sets `REDIS_ENABLED=true` and `REDIS_HOST=redis` itself.

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

!!! note
    The repository stack publishes port `9080` on all interfaces. If the host is
    reachable from the Internet, restrict it with a firewall or bind it to
    `127.0.0.1` as in option A.
