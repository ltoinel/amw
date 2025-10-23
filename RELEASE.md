# 🚀 Release Guide

This guide explains how to create and publish a new release of Amazon Modern Widgets.

## Prerequisites

Before creating a release, ensure:

1. ✅ All tests pass: `npm test`
2. ✅ Code is linted: `npm run lint`
3. ✅ Build succeeds: `npm run build`
4. ✅ All changes are committed and pushed
5. ✅ You're on the `main` or `develop` branch

## GitHub Secrets Configuration

Ensure the following secrets are configured in GitHub repository settings (see [SECRETS.md](.github/SECRETS.md)):

- `NPM_TOKEN` - For NPM publishing
- `DOCKERHUB_USERNAME` - Your Docker Hub username
- `DOCKERHUB_TOKEN` - Docker Hub access token

## Release Process

### Automatic Release (Recommended)

1. **Update version in package.json:**
   ```bash
   # For patch release (3.0.0 → 3.0.1)
   npm version patch
   
   # For minor release (3.0.0 → 3.1.0)
   npm version minor
   
   # For major release (3.0.0 → 4.0.0)
   npm version major
   ```

2. **Push the tag:**
   ```bash
   git push origin develop --tags
   ```

3. **GitHub Actions will automatically:**
   - ✅ Run all tests
   - ✅ Build the project
   - ✅ Publish to NPM
   - ✅ Build and push Docker images to:
     - GitHub Container Registry (`ghcr.io/ltoinel/amw`)
     - Docker Hub (`ltoinel/amw`)
   - ✅ Create GitHub Release with artifacts

### Manual Release Trigger

You can also trigger a release manually from GitHub Actions:

1. Go to **Actions** tab in GitHub
2. Select **🚀 Release** workflow
3. Click **Run workflow**
4. Enter the version (e.g., `v3.0.1`)
5. Click **Run workflow**

## Release Workflow Details

The release workflow performs the following steps:

### 1. Build & Test 🏗️
- Checks out the code
- Sets up Node.js 20
- Installs dependencies
- Runs linting
- Builds the project
- Runs all tests with coverage
- Uploads build artifacts

### 2. NPM Publishing 📦
- Builds the production package
- Publishes to NPM registry
- Uses semantic versioning

### 3. Docker Build & Push 🐳
- Builds multi-platform images (linux/amd64, linux/arm64)
- Pushes to GitHub Container Registry
- Pushes to Docker Hub
- Tags with version and `latest`

### 4. GitHub Release 📦
- Creates a new GitHub release
- Attaches build artifacts
- Generates release notes

## Published Artifacts

After a successful release, the package will be available at:

### NPM
```bash
npm install amazon-modern-widgets@latest
```

### Docker Hub
```bash
docker pull ltoinel/amw:latest
docker pull ltoinel/amw:3.0.0
```

### GitHub Container Registry
```bash
docker pull ghcr.io/ltoinel/amw:latest
docker pull ghcr.io/ltoinel/amw:3.0.0
```

### GitHub Release
- Source code archives (.zip, .tar.gz)
- Build artifacts
- Release notes

## Version Naming Convention

Follow semantic versioning (SemVer):

- **Major (x.0.0)**: Breaking changes
- **Minor (0.x.0)**: New features, backwards compatible
- **Patch (0.0.x)**: Bug fixes, backwards compatible

Example versions:
- `v3.0.0` - Major release with breaking changes
- `v3.1.0` - Minor release with new features
- `v3.0.1` - Patch release with bug fixes

## Troubleshooting

### NPM Publishing Fails

**Error:** `npm ERR! 403 Forbidden`
- Check that `NPM_TOKEN` is valid
- Verify you have publish permissions
- Ensure package version is incremented

### Docker Push Fails

**Error:** `unauthorized: authentication required`
- Verify `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` are set
- Check that the token has write permissions
- Ensure the Docker Hub account has access

### Build Fails

**Error:** Tests or build fail
- Run `npm test` locally to reproduce
- Fix failing tests or build errors
- Commit and push fixes before retrying

### Version Already Exists

**Error:** `version already published`
- Increment the version number in package.json
- Create a new tag with the updated version
- Push the new tag

## Post-Release Checklist

After a successful release:

1. ✅ Verify NPM package: https://www.npmjs.com/package/amazon-modern-widgets
2. ✅ Verify Docker Hub images: https://hub.docker.com/r/ltoinel/amw
3. ✅ Check GitHub release: https://github.com/ltoinel/amw/releases
4. ✅ Test installation: `npm install amazon-modern-widgets@latest`
5. ✅ Test Docker image: `docker pull ltoinel/amw:latest`
6. ✅ Update documentation if needed
7. ✅ Announce the release (if major/minor)

## Rollback

If a release has issues:

1. **NPM**: Use `npm deprecate amazon-modern-widgets@<version> "reason"`
2. **Docker**: Remove the problematic tag from Docker Hub
3. **Fix the issue** and create a new patch release

## Support

For issues or questions:
- Open an issue: https://github.com/ltoinel/amw/issues
- Check documentation: https://github.com/ltoinel/amw/blob/develop/README.md
