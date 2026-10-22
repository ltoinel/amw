# 🐳 Docker Configuration

This directory contains the Docker configuration of AMW (Amazon Modern Widgets). The usual entry point is the `start.sh` script at the repository root.

## 📁 Directory Structure

```
docker/
├── README.md                   # This documentation
├── Dockerfile                  # Production image (multi-stage, non-root)
├── docker-compose.yml          # Production stack (AMW + Redis)
├── Dockerfile.dev              # Development image (dev dependencies, hot reload)
├── docker-compose.dev.yml      # Development environment (app + Redis)
├── scripts/
│   ├── build.sh                # Build the production image only
│   └── validate.sh             # Check the Docker setup
└── config/
    └── redis/
        └── redis.conf          # Redis configuration (production stack)
```

## 🔑 Configuration

Both compose files read an optional `.env` file at the repository root (copy `.env.example`). The variables are mapped onto the configuration by `config/custom-environment-variables.yml`; the compose files enable Redis and point the app to their Redis service.

## 🚀 Usage

Docker with Compose v2 is required.

```bash
cp .env.example .env    # then fill in your Amazon credentials

./start.sh docker       # production stack, in the background (npm run docker)
./start.sh dev          # development environment, in the foreground
./start.sh stop         # stop both stacks (volumes are kept)
```

| Stack       | Compose file             | URL                                   |
|-------------|--------------------------|---------------------------------------|
| Production  | `docker-compose.yml`     | http://localhost:9080/item/health     |
| Development | `docker-compose.dev.yml` | http://localhost:8080/amw/health      |

The development environment runs `npm run dev` with the sources bind-mounted: the server restarts on every change in `src/` or `config/`. `node_modules` lives in a named volume; after changing dependencies, run `docker compose -f docker/docker-compose.dev.yml run --rm app npm ci`. VS Code Dev Containers uses the same environment (`.devcontainer/devcontainer.json`).

### Plain Docker Compose

```bash
docker compose -f docker/docker-compose.yml up --build -d
docker compose -f docker/docker-compose.yml logs -f
docker compose -f docker/docker-compose.yml down
```

### Image Only

```bash
./docker/scripts/build.sh [tag]

# Redis is disabled by default in the image
docker run -d --name amw -p 127.0.0.1:9080:9080 --env-file .env amw:latest
```

## 🔐 Security

- Non-root user, no package manager in the production image
- Production dependencies only
- Credentials only through environment variables, never baked into the image
- Redis is reachable only on the internal compose network (its port is not published)
