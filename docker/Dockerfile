# Use Node.js LTS (Long Term Support) alpine version for smaller image size
FROM node:26-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files for dependency installation
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code and build scripts
COPY src/ ./src/
COPY scripts/ ./scripts/

# Build the TypeScript application
RUN npm run build

# Production dependencies stage (keeps npm out of the final image)
FROM node:26-alpine AS deps

WORKDIR /app

COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Production stage - multi-stage build for smaller final image
FROM node:26-alpine AS production

# Install dumb-init for proper signal handling and drop the package managers,
# which are not needed at runtime
RUN apk add --no-cache dumb-init && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg

# Create app user for security (don't run as root)
RUN addgroup -g 1001 -S nodejs && \
    adduser -S amw -u 1001 -G nodejs

# Set working directory
WORKDIR /app

# Application files stay owned by root (read-only for the app user);
# copying instead of chown -R avoids duplicating them in an extra layer
COPY package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY config/docker.yml config/custom-environment-variables.yml ./config/
COPY resources/ ./resources/

# Only the logs directory needs to be writable
RUN mkdir -p logs && chown amw:nodejs logs

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
