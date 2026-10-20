# From source with `./start.sh`

`./start.sh`, at the root of the repository, is the single entry point to run AMW from
a clone, either with Node.js on the host or in Docker.

## Step 1: clone the repository

```bash
git clone https://github.com/ltoinel/amw.git
cd amw
```

To run a released version, check out its tag (`git checkout vX.Y.Z`); `develop` holds
the latest changes.

## Step 2: choose a mode

| Command | Runs | Needs | Credentials from |
|---|---|---|---|
| `./start.sh docker` | Production stack, AMW + Redis, in the background: <http://localhost:9080/item> | Docker + Compose v2 | `.env` |
| `./start.sh` or `./start.sh local` | AMW with Node.js, in the foreground, with `config/production.yml` | Node.js >= 26, npm | `config/production.yml` or exported variables |
| `./start.sh local --env NAME` | Same, with `config/NAME.yml` | Node.js >= 26, npm | `config/NAME.yml` or exported variables |
| `./start.sh dev` | [Development container](../developer/environment.md) with hot reload: <http://localhost:8080/amw> | Docker + Compose v2 | `.env` |
| `./start.sh stop` | Stops both Docker stacks (volumes kept) | Docker + Compose v2 | |

`./start.sh --help` prints the same summary.

=== "Docker (recommended)"

    ```bash
    cp .env.example .env       # fill in your credentials
    ./start.sh docker
    ```

    See [Docker Compose with Redis](docker-compose.md#option-b-from-a-clone-with-startsh).

=== "Node.js"

    ```bash
    cp config/sample.yml config/production.yml   # fill in credentials, Server.path: /item
    ./start.sh
    ```

## What the local mode does

1. checks that Node.js 26 or later and npm are installed;
2. checks that `config/<NAME>.yml` exists (default `production`);
3. runs `npm ci` when `node_modules` is missing or older than `package-lock.json`;
4. builds the project (`npm run build`);
5. sets `SERVER_PROJECT_DIR` to the clone unless you defined it, so `Server.projectDir`
   does not need editing, and `NODE_ENV` to the configuration name;
6. runs `node dist/main.js` in the foreground: <kbd>Ctrl</kbd>+<kbd>C</kbd> stops it
   gracefully.

The local mode does not read `.env`: export the variables in your shell
(`set -a; . ./.env; set +a`) or put the credentials in the YAML file.
`config/production.yml` and `.env` are never committed.

## Without the script

```bash
npm ci
npm run build      # compiles to dist/
npm start          # node dist/main.js; set Server.projectDir to the clone
```

## Next step

[Verify](verify.md) the installation, then [expose it on your blog](reverse-proxy.md).
