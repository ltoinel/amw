# 🐳 Docker Configuration

This directory contains all Docker-related files for the AMW (Amazon Modern Widgets) project.

## 📁 Directory Structure

```
docker/
├── README.md                    # This documentation
├── Dockerfile                   # Main production Dockerfile
├── Dockerfile.dev              # Development Dockerfile with hot reload
├── Dockerfile.test             # Testing environment Dockerfile
├── docker-compose.yml          # Main compose configuration
├── docker-compose.dev.yml      # Development compose configuration
├── docker-compose.test.yml     # Testing compose configuration
├── docker-compose.prod.yml     # Production compose configuration
├── .dockerignore               # Docker build ignore patterns
├── nginx.conf                  # Nginx reverse proxy configuration
├── nginx/                      # Nginx configuration files
│   ├── nginx.conf             # Main nginx configuration
│   ├── nginx.dev.conf         # Development nginx configuration
│   └── ssl/                   # SSL certificates (production)
└── scripts/                   # Docker utility scripts
    ├── build.sh               # Build all images
    ├── deploy.sh              # Deploy to production
    └── cleanup.sh             # Cleanup old images/containers
```

## 🚀 Quick Start

### Development Environment
```bash
# Start development environment with hot reload
docker-compose -f docker/docker-compose.dev.yml up -d

# View logs
docker-compose -f docker/docker-compose.dev.yml logs -f amw
```

### Testing Environment
```bash
# Run tests in containerized environment
docker-compose -f docker/docker-compose.test.yml up --abort-on-container-exit

# Run specific test suite
docker-compose -f docker/docker-compose.test.yml run --rm amw npm test
```

### Production Environment
```bash
# Deploy production stack
docker-compose -f docker/docker-compose.prod.yml up -d

# Scale AMW instances
docker-compose -f docker/docker-compose.prod.yml up -d --scale amw=3
```

## 🔧 Available Dockerfiles

### `Dockerfile` (Production)
- Multi-stage build for optimized production image
- Node.js 18 Alpine base
- Distroless runtime for security
- Health checks included
- Multi-platform support (AMD64, ARM64)

### `Dockerfile.dev` (Development)
- Hot reload with nodemon
- Development dependencies included
- Debug ports exposed
- Volume mounts for live code editing

### `Dockerfile.test` (Testing)
- Testing environment setup
- All test dependencies
- Coverage reporting
- CI/CD optimized

## 🌍 Environment Configurations

### Development (`docker-compose.dev.yml`)
- Hot reload enabled
- Debug mode activated
- Local volumes mounted
- Development ports exposed

### Testing (`docker-compose.test.yml`)
- Isolated test environment
- Test database setup
- Coverage reporting
- CI/CD integration

### Production (`docker-compose.prod.yml`)
- Optimized for performance
- Health checks enabled
- Resource limits configured
- SSL/TLS termination
- Load balancing ready

## 🛠️ Utility Scripts

### Build Script (`scripts/build.sh`)
```bash
# Build all Docker images
./docker/scripts/build.sh

# Build specific environment
./docker/scripts/build.sh dev
./docker/scripts/build.sh test
./docker/scripts/build.sh prod
```

### Deploy Script (`scripts/deploy.sh`)
```bash
# Deploy to production
./docker/scripts/deploy.sh prod

# Deploy to staging
./docker/scripts/deploy.sh staging
```

### Cleanup Script (`scripts/cleanup.sh`)
```bash
# Clean up old images and containers
./docker/scripts/cleanup.sh
```

## 📊 Image Information

### Base Images
- **Production**: `node:18-alpine` → `gcr.io/distroless/nodejs18-debian11`
- **Development**: `node:18-alpine`
- **Testing**: `node:18-alpine`

### Image Sizes (Approximate)
- **Production**: ~150MB (distroless)
- **Development**: ~400MB (with dev tools)
- **Testing**: ~350MB (with test tools)

### Multi-Platform Support
- `linux/amd64` (Intel/AMD x86_64)
- `linux/arm64` (Apple Silicon M1/M2, ARM servers)

## 🔐 Security Features

### Production Security
- Distroless runtime (minimal attack surface)
- Non-root user execution
- Read-only root filesystem
- No package managers in runtime
- Minimal system dependencies

### Network Security
- Internal network isolation
- Nginx reverse proxy
- Rate limiting configured
- SSL/TLS termination

## 🚀 CI/CD Integration

### GitHub Actions Integration
```yaml
# Build and push images
- name: Build Docker Images
  run: |
    docker-compose -f docker/docker-compose.yml build
    docker-compose -f docker/docker-compose.test.yml run --rm test
```

### Registry Support
- Docker Hub: `ltoinel/amw`
- GitHub Container Registry: `ghcr.io/ltoinel/amw`
- Private registries supported

## 📈 Performance Optimization

### Build Performance
- Multi-stage builds for smaller images
- Docker layer caching
- Optimized dependency installation
- Parallel builds supported

### Runtime Performance
- Health checks for container orchestration
- Resource limits and reservations
- Horizontal scaling ready
- Load balancing configuration

## 🔍 Troubleshooting

### Common Issues

**Build Failures**
```bash
# Clear Docker build cache
docker builder prune -a

# Rebuild without cache
docker-compose -f docker/docker-compose.yml build --no-cache
```

**Permission Issues**
```bash
# Fix file permissions
sudo chown -R $(id -u):$(id -g) .
```

**Network Issues**
```bash
# Reset Docker networks
docker network prune
```

### Debug Commands
```bash
# Enter running container
docker-compose -f docker/docker-compose.dev.yml exec amw sh

# View container logs
docker-compose -f docker/docker-compose.yml logs -f amw

# Check container health
docker-compose -f docker/docker-compose.yml ps
```

## 📝 Best Practices

### Development
- Use development compose for local development
- Mount source code as volumes for hot reload
- Use separate containers for database and cache

### Testing
- Run tests in isolated containers
- Use test-specific configurations
- Generate coverage reports in containers

### Production
- Use production-optimized images
- Implement proper health checks
- Configure resource limits
- Use secrets management
- Enable logging and monitoring

---

*This Docker setup provides a complete containerization solution for the AMW project, supporting development, testing, and production environments with security and performance optimizations.*