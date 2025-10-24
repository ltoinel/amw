# 🐳 Docker Organization 

## **Simplified Docker Structure**
- `docker/Dockerfile` - Production-ready multi-stage build
- `docker/docker-compose.yml` - Main configuration (AMW + Redis)

## **Configuration Files**
- `docker/config/redis/redis.conf` - Redis configuration

## **Utility Scripts**
- `docker/scripts/build.sh` - Docker build script
- `docker/scripts/start.sh` - Start services script
- `docker/scripts/stop.sh` - Stop services script
- `docker/scripts/validate.sh` - Validation script

## Directory Structure

```
docker/
├── Dockerfile                   # Production Dockerfile (multi-stage)
├── docker-compose.yml           # Main compose configuration (AMW + Redis)
├── scripts/                     # Docker utility scripts
│   ├── build.sh                 # Build images script
│   ├── start.sh                 # Start services script
│   ├── stop.sh                  # Stop services script
│   └── validate.sh              # Validation script
└── config/                      # Configuration files
    └── redis/                   # Redis configurations
        └── redis.conf           # Redis config
```

## Updated NPM Scripts

### Docker Scripts in package.json
```json
{
  "scripts": {
    "docker": "./docker/scripts/start.sh"
  }
}
```

## Benefits of Docker Organization

### ✅ **Simplicity & Clarity**
- **Single configuration** for production deployment
- **Clear structure** with organized scripts and configs
- **No environment confusion** - production-ready by default

### ✅ **Development Experience**
- **Fast startup** with `npm run docker`
- **Easy maintenance** with organized scripts
- **Production parity** - same environment as production

### ✅ **Production Readiness**
- **Multi-stage builds** for optimized images (~150MB)
- **Security hardening** with non-root user
- **Health checks** with dedicated `/amw/health` endpoint
- **Redis caching** for optimal performance

### ✅ **Operational Excellence**
- **Automated scripts** for build, start, stop, validate
- **Health monitoring** built-in
- **Simple maintenance** with clear structure

## Usage Examples

### Quick Start
```bash
# Start services (AMW + Redis)
npm run docker

# Or manually
cd docker
./scripts/start.sh
```

### Build & Management
```bash
# Build Docker image
cd docker
./scripts/build.sh

# Stop services
./scripts/stop.sh

# Validate setup
./scripts/validate.sh
```

### Manual Docker Commands
```bash
# View logs
docker-compose -f docker/docker-compose.yml logs -f

# Check status
docker-compose -f docker/docker-compose.yml ps

# Restart services
docker-compose -f docker/docker-compose.yml restart
```

## Production Features

### **Security**
- **Non-root execution** - runs as user `amw` (uid 1001)
- **Multi-stage builds** - minimal attack surface
- **Health checks** - automatic failure detection with `/amw/health` endpoint

### **Performance**
- **Optimized images** - ~150MB final size
- **Redis caching** - reduced API calls
- **Layer caching** - faster rebuilds
- **Resource management** - CPU and memory limits configured

## CI/CD Integration

### **GitHub Actions Integration**
The Docker setup integrates with GitHub Actions workflows:

```yaml
# Release workflow builds and publishes to multiple registries
- name: Build and push Docker image
  uses: docker/build-push-action@v5
  with:
    context: .
    file: docker/Dockerfile
    platforms: linux/amd64,linux/arm64
    push: true
```

**Published to:**
- GitHub Container Registry: `ghcr.io/ltoinel/amw:latest`
- Docker Hub: `ltoinel/amw:latest`

## Migration Summary

### ✅ **Simplification Completed**
- [x] Removed dev/prod environment split
- [x] Single production-ready Dockerfile
- [x] Organized scripts in `docker/scripts/`
- [x] Organized configs in `docker/config/`
- [x] Simplified NPM scripts
- [x] Health endpoint using `/amw/health`

### ✅ **Functionality Validated**
- [x] Docker build successful
- [x] Docker Compose startup working
- [x] Health checks operational
- [x] Multi-platform support (amd64, arm64)
- [x] Multi-registry publishing configured

---

*This simplified Docker organization provides a production-ready, maintainable containerization solution for the AMW project.*