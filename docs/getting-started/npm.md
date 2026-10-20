# Run with npm / Node.js

AMW requires **Node.js 24** (the version used by CI and the Docker image;
`package.json` declares `node >= 18`, but older versions are not tested).

## From the npm package

The [`amazon-modern-widgets`](https://www.npmjs.com/package/amazon-modern-widgets)
package contains the compiled server (`dist/`), the minified widget
(`dist/widgets/widget.js`) and the sample configuration files.

```bash
mkdir amw && cd amw
npm install amazon-modern-widgets
mkdir config
cp node_modules/amazon-modern-widgets/config/sample.yml config/production.yml
```

Edit `config/production.yml` (see [Configuration](../configuration.md)). Two keys need
special attention with this layout:

- `Server.projectDir` must point to the **installed package**, because the server
  serves `<projectDir>/dist/widgets/widget.js`, for example
  `/home/me/amw/node_modules/amazon-modern-widgets/`;
- `Server.path` should be `/item` if you use the widget as is (see
  [API location](../widget.md#api-location)).

Then start the server from the directory that contains `config/`
(node-config looks for `./config` in the current working directory):

```bash
NODE_ENV=production node node_modules/amazon-modern-widgets/dist/main.js
```

`NODE_ENV` defaults to `production` when it is not set, so `config/production.yml` is
loaded.

## From a clone of the repository

```bash
git clone https://github.com/ltoinel/amw.git
cd amw
npm ci
cp config/sample.yml config/production.yml   # then edit it
npm run build                                 # compiles to dist/
npm start                                     # node dist/main.js
```

Set `Server.projectDir` to the absolute path of the clone. `config/production.yml` is
git-ignored, so your credentials will not be committed.

## Keep it running with PM2

```bash
sudo npm install -g pm2
pm2 start dist/main.js --name amw
pm2 startup     # then run the command it prints
pm2 save
```

A systemd unit or any other process manager works just as well. The server shuts down
gracefully on `SIGTERM`, `SIGINT` and `SIGUSR2`.

## Check that it works

```bash
curl http://localhost:8080/amw/health      # port and path from your configuration
```

```json
{"status":"ok","version":"4.0.0","timestamp":"...","uptime":12.3,"redis":"disabled"}
```

Next: put AMW behind your [reverse proxy](reverse-proxy.md).
