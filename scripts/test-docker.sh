#!/bin/bash

# Script de test pour vérifier le démarrage de l'image Docker AMW
# Ce script doit être exécuté sur un système avec Docker installé

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🐳 AMW Docker Image Test${NC}"
echo -e "${BLUE}=========================${NC}"
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed${NC}"
    echo -e "${YELLOW}Please install Docker first:${NC}"
    echo -e "  sudo apt install docker.io"
    echo -e "  sudo usermod -aG docker \$USER"
    exit 1
fi

# Build the image
echo -e "${YELLOW}📦 Building Docker image...${NC}"
cd "$(dirname "$0")/../docker"
docker build -f Dockerfile -t amw:test ..

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Image built successfully${NC}"
else
    echo -e "${RED}✗ Image build failed${NC}"
    exit 1
fi

# Start a test container
echo ""
echo -e "${YELLOW}🚀 Starting test container...${NC}"
CONTAINER_ID=$(docker run -d --name amw-test -p 9080:9080 amw:test)

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Container started: ${CONTAINER_ID:0:12}${NC}"
else
    echo -e "${RED}✗ Container failed to start${NC}"
    exit 1
fi

# Wait for container to be healthy
echo ""
echo -e "${YELLOW}⏳ Waiting for container to be healthy...${NC}"
for i in {1..60}; do
    HEALTH=$(docker inspect --format='{{.State.Health.Status}}' amw-test 2>/dev/null || echo "unknown")
    
    if [ "$HEALTH" = "healthy" ]; then
        echo -e "${GREEN}✓ Container is healthy!${NC}"
        break
    elif [ "$HEALTH" = "unhealthy" ]; then
        echo -e "${RED}✗ Container is unhealthy${NC}"
        docker logs amw-test
        docker rm -f amw-test
        exit 1
    fi
    
    echo -n "."
    sleep 1
done
echo ""

# Test the health endpoint
echo ""
echo -e "${YELLOW}🔍 Testing health endpoint...${NC}"
sleep 5  # Give extra time for server to fully start

HEALTH_RESPONSE=$(curl -s -w "\n%{http_code}" http://localhost:9080/item/health)
HTTP_CODE=$(echo "$HEALTH_RESPONSE" | tail -n 1)
BODY=$(echo "$HEALTH_RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✓ Health endpoint returned 200 OK${NC}"
    echo -e "${GREEN}✓ Response: ${BODY}${NC}"
else
    echo -e "${RED}✗ Health endpoint returned ${HTTP_CODE}${NC}"
    echo -e "${RED}✗ Response: ${BODY}${NC}"
    echo ""
    echo -e "${YELLOW}Container logs:${NC}"
    docker logs amw-test
    docker rm -f amw-test
    exit 1
fi

# Test widget.js endpoint
echo ""
echo -e "${YELLOW}🔍 Testing widget.js endpoint...${NC}"
WIDGET_RESPONSE=$(curl -s -w "\n%{http_code}" http://localhost:9080/item/widget.js)
HTTP_CODE=$(echo "$WIDGET_RESPONSE" | tail -n 1)

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✓ Widget.js endpoint returned 200 OK${NC}"
    SIZE=$(echo "$WIDGET_RESPONSE" | head -n -1 | wc -c)
    echo -e "${GREEN}✓ Widget size: ${SIZE} bytes${NC}"
else
    echo -e "${RED}✗ Widget.js endpoint returned ${HTTP_CODE}${NC}"
fi

# Show container info
echo ""
echo -e "${BLUE}📊 Container Information:${NC}"
echo -e "${BLUE}=========================${NC}"
docker ps --filter "name=amw-test" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo ""
echo -e "${BLUE}📝 Container Logs (last 20 lines):${NC}"
docker logs --tail 20 amw-test

# Cleanup
echo ""
echo -e "${YELLOW}🧹 Cleaning up...${NC}"
docker rm -f amw-test
echo -e "${GREEN}✓ Test container removed${NC}"

# Optionally remove test image (skip in CI)
if [ -t 0 ]; then
    # Interactive terminal detected
    read -p "Remove test image? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        docker rmi amw:test
        echo -e "${GREEN}✓ Test image removed${NC}"
    fi
else
    # Non-interactive (CI environment), keep the image
    echo -e "${BLUE}ℹ️  Test image kept (CI environment)${NC}"
fi

echo ""
echo -e "${GREEN}╔════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  ✅ Docker image test passed!     ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════╝${NC}"
echo ""

exit 0
