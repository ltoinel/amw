# Use Node.js LTS (Long Term Support) alpine version for smaller image size
FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files for dependency installation
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code and build scripts
COPY src/ ./src/
COPY @types/ ./@types/
COPY scripts/ ./scripts/

# Build the TypeScript application
RUN npm run build

# Production stage - multi-stage build for smaller final image
FROM node:18-alpine AS production

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create app user for security (don't run as root)
RUN addgroup -g 1001 -S nodejs && \
    adduser -S amw -u 1001

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Copy configuration files and resources
COPY config/ ./config/
COPY resources/ ./resources/

# Create necessary directories and set permissions
RUN mkdir -p logs && \
    chown -R amw:nodejs /app

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

# Start the application
CMD ["npm", "start"]