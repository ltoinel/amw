# CI/CD & releases

All workflows live in `.github/workflows/` and run with a read-only `GITHUB_TOKEN` by
default; jobs that publish request only the permissions they need.

## Continuous integration

[`ci.yml`](https://github.com/ltoinel/amw/blob/develop/.github/workflows/ci.yml) runs on
pushes and pull requests targeting `main` and `develop`:

| Job | Steps |
|---|---|
| Tests & Linting | `npm ci`, `npm run lint`, `npm run build`, `npm run test:ci` on Node.js 24 |
| Security Audit | `npm audit --audit-level high` |
| Docker Build Test | builds `docker/Dockerfile` and runs `scripts/test-docker.sh` (container start and health check) |
| Quality Gate | fails unless the three jobs above succeeded |

[`dependency-review.yml`](https://github.com/ltoinel/amw/blob/develop/.github/workflows/dependency-review.yml)
runs on pull requests and fails when they add dependencies with high or critical
vulnerabilities or a GPL/AGPL license.

GitHub CodeQL (default setup) and Dependabot (weekly updates of npm packages, GitHub
Actions, Docker images and Compose files, against `develop`) are configured on the
repository.

## Releases

[`release.yml`](https://github.com/ltoinel/amw/blob/develop/.github/workflows/release.yml)
runs when a `v*.*.*` tag is pushed (or manually with a version):

1. lint, build and test;
2. build and push the multi-architecture image (`linux/amd64`, `linux/arm64`) to
   `ghcr.io/ltoinel/amw` and Docker Hub `ltoinel/amw`, tagged with the version,
   `major.minor`, `major` and `latest`;
3. publish the npm package `amazon-modern-widgets`;
4. create the GitHub release with generated notes.

Required repository secrets: `NPM_TOKEN`, `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`.

Releases are prepared by the maintainer with `npm run release`
([release-it](https://github.com/release-it/release-it)), which bumps the version, tags
and creates the GitHub release.

## Documentation

[`docs.yml`](https://github.com/ltoinel/amw/blob/develop/.github/workflows/docs.yml)
builds this site with `mkdocs build --strict`:

- on pull requests that touch the documentation, as a check;
- on pushes to `develop` and on manual runs, it also deploys the site to GitHub Pages
  (<https://ltoinel.github.io/amw/>).

Before deploying, it runs the Jest suites with coverage and publishes
`badges/coverage.json`, a [shields.io endpoint](https://shields.io/badges/endpoint-badge)
document built from the line coverage in `coverage/coverage-summary.json`. The README
coverage badge reads it, so no third-party coverage service is needed. Test failures
never block the documentation: if no coverage summary is produced, the badge shows
`unknown`.
