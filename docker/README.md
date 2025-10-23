# 🐳 Docker Configuration

This directory contains simplified Docker configuration for AMW (Amazon Modern Widgets) deployment.

## 📁 Directory Structure

```
docker/
├── README.md                    # This documentation
├── Dockerfile                   # Production Dockerfile
├── docker-compose.yml          # Compose configuration
├── .dockerignore               # Docker build ignore patterns
├── scripts/                    # Deployment and utility scripts
│   ├── build.sh               # Build image
│   ├── start.sh               # Start services
│   ├── stop.sh                # Stop services
│   └── validate.sh            # Validate Docker configuration
└── config/                     # Configuration files
    └── redis/                  # Redis configurations
        └── redis.conf         # Redis config
```

## 🚀 Quick Start

### Build Image
```bash
# Build the Docker image
./docker/scripts/build.sh

# Or using npm script
npm run docker:build
```

### Start Services
```bash
# Start AMW and Redis
./docker/scripts/start.sh

# Or using npm script
npm run docker:start
```

### Stop Services
```bash
# Stop all services
./docker/scripts/stop.sh

# Or using npm script
npm run docker:stop
```

### View Logs
```bash
# View logs
npm run docker:logs
```

## 🛠️ Available Scripts

### Scripts
```bash
# Build image
./docker/scripts/build.sh [tag]

# Start services  
./docker/scripts/start.sh

# Stop services
./docker/scripts/stop.sh

# Validate configuration
./docker/scripts/validate.sh
```

## 🚀 Quick Start

### Build Production Image
```bash
# Build the production Docker image
./docker/build-prod.sh

# Or using npm script
npm run docker:build
```

### Start Production Services
```bash
# Start AMW and Redis in production mode
./docker/start-prod.sh

# Or using npm script
npm run docker:start
```

### Stop Production Services
```bash
# Stop all production services
./docker/stop-prod.sh

# Or using npm script
npm run docker:stop
```

### View Logs
```bash
# View production logs
npm run docker:logs
```

## 🔧 Production Dockerfile

### `Dockerfile` (Production Only)
- Multi-stage build for optimized image size
- Node.js 18 Alpine base
- Non-root user for security
- Health checks included
- Production dependencies only

## 🌍 Production Configuration

### `docker-compose.prod.yml`
- AMW application container
- Redis cache container  
- Health checks enabled
- Auto-restart policies
- Optimized for production use

### Key Features
- **Port Mapping**: AMW accessible on port 8080
- **Redis Cache**: Persistent data storage
- **Health Monitoring**: Built-in health checks
- **Auto-Restart**: Services restart automatically on failure

## 🛠️ Available Scripts

### Production Scripts
```bash
# Build production image
./docker/scripts/build-prod.sh [tag]

# Start production services  
./docker/scripts/start-prod.sh

# Stop production services
./docker/scripts/stop-prod.sh

# Validate configuration
./docker/scripts/validate.sh
```

### NPM Scripts (Recommended)
```bash
# Build image
npm run docker:build

# Start stack
npm run docker:start

# Stop stack  
npm run docker:stop

# View logs
npm run docker:logs
```

## 📊 Image Information

### Base Image
- **Image**: `node:18-alpine`
- **Final Size**: ~200MB (optimized)
- **Security**: Non-root user, minimal dependencies

### Services
- **AMW**: Main application on port 8080
- **Redis**: Cache service with persistent storage

## 🔐 Security Features

### Security
- Non-root user execution
- Minimal dependencies
- Health checks for monitoring
- Isolated container network

## � Troubleshooting

### Common Commands
```bash
# Check running containers
docker ps

# View logs
docker-compose -f docker/docker-compose.yml logs -f

# Enter container for debugging
docker exec -it amw sh

# Restart services
docker-compose -f docker/docker-compose.yml restart
```

### Build Issues
```bash
# Clear Docker cache
docker builder prune -a

# Rebuild from scratch
./docker/scripts/build.sh latest
```

## 📝 Usage Examples

### Basic Deployment
```bash
# 1. Build the image
npm run docker:build

# 2. Start services
npm run docker:start

# 3. Check status
docker ps

# 4. Test the API
curl http://localhost:8080/amw/product?keyword=test

# 5. Stop when done
npm run docker:stop
```

### Access URLs
- **AMW API**: http://localhost:8080
- **Health Check**: http://localhost:8080/amw/product?keyword=test
- **Widget**: http://localhost:8080/widget.js

---

*Simplified Docker setup for AMW deployment. Focus on simplicity and reliability.*