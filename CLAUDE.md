# CLAUDE.md

All project instructions live in [AGENTS.md](AGENTS.md), shared with other coding agents:

@AGENTS.md

## Claude Code specifics

- Never commit or push to `develop` or `main` directly: create the GitHub issue first (`gh issue create`), work on a `<type>/<issue>-<slug>` branch, then open a pull request against `develop` (`gh pr create --base develop`).
- Issue titles, PR titles and commit messages must follow Conventional Commits.
- Run `npm run lint && npm run build && npm test` before proposing a pull request.
