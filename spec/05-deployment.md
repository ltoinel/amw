# Deployment and Usage

## Docker Deployment (Recommended)

AMW provides Docker support for production-ready deployments with optimized containers.

### Quick Start with Docker Compose

```bash
# Clone and configure
git clone https://github.com/ltoinel/amw.git
cd amw
cp config/sample.yml config/production.yml
# Configure your Amazon PAAPI credentials

# Start all services
docker-compose up -d
```

This will start:
- AMW application container (port 8080)
- Redis cache container (port 6379) 
- Nginx reverse proxy (port 80/443)

### Docker Features

- **Multi-stage build** for optimized image size
- **Non-root security** with dedicated app user
- **Health checks** for monitoring
- **Volume mounting** for configuration and logs
- **Redis integration** for caching
- **Nginx reverse proxy** with rate limiting and caching

### Manual Docker Build

```bash
# Build image
docker build -t amw:latest .

# Run container
docker run -d \
  --name amw-app \
  -p 8080:8080 \
  -v ./config/production.yml:/app/config/production.yml:ro \
  amw:latest
```

## Traditional Node.js Deployment

### Installation

```bash
npm install
npm start
```

### Deployment with PM2

```bash
sudo npm install pm2 -g
npm run build
pm2 start dist/main.js --name "amw"
pm2 startup
pm2 save
```

## NGINX Reverse Proxy Configuration

### For Docker Setup
Use the provided `nginx.conf` with Docker Compose for production-ready configuration.

### For Traditional Deployment
```nginx
location ^~ /amw {
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_pass http://127.0.0.1:8080;
    proxy_read_timeout 600;
}
```

