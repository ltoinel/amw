# Upgrade

Read the [release notes](https://github.com/ltoinel/amw/releases) first: breaking
changes are flagged there (Conventional Commits `!` / `BREAKING CHANGE`).

## Docker

```bash
docker pull ltoinel/amw:latest          # or the new X.Y.Z tag you pin
docker stop amw && docker rm amw
docker run -d --name amw -p 9080:9080 --env-file .env --restart unless-stopped ltoinel/amw:latest
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
