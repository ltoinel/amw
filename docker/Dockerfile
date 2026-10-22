# syntax=docker/dockerfile:1

# Node.js 26 on Alpine, pinned by digest so that builds are reproducible and a re-pushed
# tag cannot change the base; Dependabot (docker ecosystem) updates the digest
FROM node:26-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS builder

# Set working directory
WORKDIR /app

# Copy package files for dependency installation
COPY package*.json ./
COPY admin/package*.json ./admin/
COPY tsconfig.json ./

# Install all dependencies (including devDependencies for build), the admin
# portal toolchain included: it only runs here and ends up as static files
# The npm cache lives in a BuildKit cache mount: reused across builds, never in a layer
RUN --mount=type=cache,target=/root/.npm \
    npm ci && npm --prefix admin ci --no-audit --no-fund

# Copy source code and build scripts
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY admin/ ./admin/

# Build the TypeScript application
RUN npm run build

# Production dependencies stage (keeps npm out of the final image)
FROM node:26-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS deps

WORKDIR /app

COPY package*.json ./

# Install only production dependencies
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --ignore-scripts

# Production stage - multi-stage build for smaller final image
FROM node:26-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS production

# Install dumb-init for proper signal handling and drop the package managers,
# which are not needed at runtime. dumb-init is not version-pinned: Alpine drops old
# package versions, so a pin would break the build on every base image update.
# hadolint ignore=DL3018
RUN apk add --no-cache dumb-init && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg

# Create app user for security (don't run as root)
RUN addgroup -g 1001 -S nodejs && \
    adduser -S amw -u 1001 -G nodejs

# Set working directory
WORKDIR /app

# Application files stay owned by root (read-only for the app user), and nothing is
# written to disk at runtime (logs go to stdout), so the container can run with a
# read-only root filesystem
COPY package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY config/docker.yml config/custom-environment-variables.yml ./config/
COPY resources/ ./resources/

# Switch to non-root user
USER amw

# Set environment to use docker config
ENV NODE_ENV=docker

# Expose the application port (must match config/docker.yml)
EXPOSE 9080

# Health check to ensure the application is running (basePath is /item in docker.yml)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:9080/item/health || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application directly with node (npm is not shipped)
CMD ["node", "dist/main.js"]
