# Upgrade

Read the [release notes](https://github.com/ltoinel/amw/releases) first: breaking
changes are flagged there (Conventional Commits `!` / `BREAKING CHANGE`).

## Upgrading to 5.0

5.0 has two breaking changes and two behaviour changes worth checking:

- **Redis password (breaking, repository Compose stack only)**: `./start.sh docker`
  refuses to start Redis without `REDIS_PASSWORD` in `.env`. Add one before upgrading:
  `echo "REDIS_PASSWORD=$(openssl rand -hex 24)" >> .env`. The published image and
  your own Compose files are not affected.
- **Widget language (breaking)**: a page whose `<html lang>` is missing or not
  supported no longer falls back to French but to the visitor's browser language, then
  English. Regional codes (`fr-FR`, `en-US`…) are now recognised. To keep French
  everywhere, set `lang="fr"` on the page or `data-lang="fr"` on the widgets, see
  [Languages](../user-guide/widget.md#languages).
- **Port published on 127.0.0.1**: the repository Compose stack now publishes 9080 on
  the loopback interface only, because the Docker configuration trusts one proxy hop
  (`Server.trustProxy: 1`). If another host reached AMW on port 9080 directly, put a
  reverse proxy in front of it, or publish the port yourself and set
  `SERVER_TRUST_PROXY=false`, see [Reverse proxy](reverse-proxy.md).
- **Unknown products render nothing**: a widget whose product Amazon does not know
  hides itself instead of showing an error. The admin portal lists these products under
  **Products to replace**.

New and optional: the [administration portal](../user-guide/admin-portal.md) gains a
side navigation, a best performing pages view and AI insights (`Admin.insights`, off by
default).

## Docker

```bash
docker pull ltoinel/amw:latest          # or the new X.Y.Z tag you pin
docker stop amw && docker rm amw
docker run -d --name amw -p 127.0.0.1:9080:9080 --env-file .env --restart unless-stopped ltoinel/amw:latest
```

## Docker Compose

=== "Published image"

    ```bash
    docker compose pull
    docker compose up -d
    ```

=== "From a clone"

    ```bash
    git pull                       # or git checkout vX.Y.Z
    ./start.sh docker              # rebuilds the image and restarts the stack
    ```

The Redis volume is kept, so the product cache survives the upgrade.

!!! warning "The repository stack requires `REDIS_PASSWORD`"
    Since the Redis password was introduced, `docker/docker-compose.yml` (the
    `./start.sh docker` stack) refuses to start Redis without `REDIS_PASSWORD` in `.env`:
    add one (`echo "REDIS_PASSWORD=$(openssl rand -hex 24)" >> .env`) before upgrading.
    The cached products are kept: the password only protects new connections.

## npm package

```bash
npm install amazon-modern-widgets@latest
pm2 restart amw                    # or your process manager
```

Compare your `config/production.yml` with the new
`node_modules/amazon-modern-widgets/config/sample.yml` and copy
`config/custom-environment-variables.yml` again: new settings may have been added.

## From source

```bash
git pull                           # or git checkout vX.Y.Z
./start.sh                         # reinstalls dependencies if needed, rebuilds, starts
```

## After upgrading

- [Verify the installation](verify.md): `/item/health` reports the new `version`.
- Browsers and proxies may keep the previous `widget.js` for up to `Server.httpCache`
  seconds; purge your CDN or NGINX cache if you need the new widget immediately.
