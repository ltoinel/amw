# Developer guide

Everything needed to work on AMW itself: how it is built, how to run and test it, and
how changes get from an issue to a release.

<div class="grid cards" markdown>

-   :material-sitemap:{ .lg .middle } **[Architecture](architecture.md)**

    ---

    Components and request flow, with diagrams.

-   :material-file-tree:{ .lg .middle } **[Code layout](code-layout.md)**

    ---

    Where each part lives and which files to touch for a change.

-   :material-docker:{ .lg .middle } **[Development environment](environment.md)**

    ---

    Dev container, `./start.sh dev`, `npm run dev` and npm scripts.

-   :material-test-tube:{ .lg .middle } **[Tests & quality](testing.md)**

    ---

    Unit tests and coverage thresholds, API and browser end-to-end tests, lint.

-   :material-source-pull:{ .lg .middle } **[Contributing](contributing.md)**

    ---

    Issue → branch → pull request, Conventional Commits, comment guidelines.

-   :material-rocket-launch:{ .lg .middle } **[CI/CD](ci-cd.md) and [releases](release.md)**

    ---

    GitHub Actions workflows and the release process.

</div>

The rules for humans and AI coding agents are summarized in
[AGENTS.md](https://github.com/ltoinel/amw/blob/develop/AGENTS.md); security issues
follow the [security policy](https://github.com/ltoinel/amw/blob/develop/SECURITY.md).
