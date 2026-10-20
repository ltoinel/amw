# npm package

Run AMW with Node.js from the published
[`amazon-modern-widgets`](https://www.npmjs.com/package/amazon-modern-widgets) package.
It contains the compiled server (`dist/`), the minified widget
(`dist/widgets/widget.js`) and the configuration files.

AMW requires **Node.js 26** or later (`engines` in `package.json`), the version used by
CI and the Docker image.

## Step 1: install the package

```bash
mkdir amw && cd amw
npm install amazon-modern-widgets
mkdir config
cp node_modules/amazon-modern-widgets/config/sample.yml config/production.yml
cp node_modules/amazon-modern-widgets/config/custom-environment-variables.yml config/
```

The second file maps [environment variables](configuration.md#environment-variables)
such as `AMAZON_CREDENTIAL_ID` onto the configuration.

## Step 2: configure

Edit `config/production.yml` (see [Configuration](configuration.md)), or export the
`AMAZON_*` variables in the service environment. Two keys need attention with this
layout:

- `Server.projectDir` must be the absolute path of the **installed package**, because
  the server serves `<projectDir>/dist/widgets/widget.js`, for example
  `/home/me/amw/node_modules/amazon-modern-widgets/`;
- `Server.path` should be `/item` if you use the widget as is (see
  [API location](../user-guide/integration.md#api-location)).

## Step 3: start the server

Start it from the directory that contains `config/` (node-config looks for `./config`
in the current working directory):

```bash
NODE_ENV=production node node_modules/amazon-modern-widgets/dist/main.js
```

`NODE_ENV` defaults to `production` when it is not set, so `config/production.yml` is
loaded. Then [verify](verify.md) the installation.

## Step 4: keep it running

With [PM2](https://pm2.keymetrics.io/):

```bash
sudo npm install -g pm2
pm2 start node_modules/amazon-modern-widgets/dist/main.js --name amw
pm2 startup     # then run the command it prints
pm2 save
```

A systemd unit or any other process manager works just as well. The server shuts down
gracefully on `SIGTERM`, `SIGINT` and `SIGUSR2`.

## Next step

[Expose AMW on your blog](reverse-proxy.md) under `/item`.
