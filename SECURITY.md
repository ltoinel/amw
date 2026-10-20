# Security Policy

## Supported versions

Only the latest release line receives security fixes.

| Version | Supported |
| ------- | --------- |
| 4.x     | ✅        |
| < 4.0   | ❌        |

Docker images (`ltoinel/amw`, `ghcr.io/ltoinel/amw`) and the npm package `amazon-modern-widgets` follow the same policy: upgrade to the latest 4.x release to get fixes.

## Reporting a vulnerability

**Please do not open a public issue, pull request or discussion for a security problem.**

Report it privately through GitHub: [**Report a vulnerability**](https://github.com/ltoinel/amw/security/advisories/new) (Security tab → *Report a vulnerability*).

Please include:

- the affected version, deployment mode (Docker, npm, source) and configuration (Redis on/off, reverse proxy, `Server.trustProxy`);
- a description of the issue and its impact (e.g. XSS in the widget on host pages, quota exhaustion of the Amazon API, credential exposure);
- steps or a proof of concept to reproduce it;
- any suggested fix.

Never include real Amazon credentials or partner tags in a report.

## What to expect

AMW is maintained on a best-effort basis by a single maintainer. Target timelines:

| Step | Target |
| ---- | ------ |
| Acknowledgement of your report | 5 business days |
| Initial assessment (validity, severity) | 10 business days |
| Fix released for confirmed high or critical issues | 30 days |

You will be kept informed through the private advisory. Once a fix is released, the advisory is published with credit to the reporter, unless you prefer to remain anonymous. Please keep the issue confidential until then.

## Scope

In scope: the AMW server (`src/server`), the browser widget (`src/widgets/widget.js`), the Docker images and the npm package published from this repository, and the GitHub Actions workflows.

Out of scope: vulnerabilities in the Amazon Creators API itself, in third-party dependencies without a demonstrated impact on AMW (report them upstream; Dependabot tracks them here), and deployments that ignore the documented configuration (e.g. Redis exposed without authentication).
