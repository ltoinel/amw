#!/bin/bash

# 🐳 AMW Docker Build Script
# Simple script to build Docker image

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
IMAGE_NAME="amw"
IMAGE_TAG="${1:-latest}"
DOCKERFILE_PATH="./docker/Dockerfile"
BUILD_CONTEXT="."

echo -e "${BLUE}🐳 Building AMW Docker Image${NC}"
echo -e "${BLUE}==============================${NC}"
echo ""

# Check if Docker is installed and running
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed or not in PATH${NC}"
    exit 1
fi

if ! docker info &> /dev/null; then
    echo -e "${RED}❌ Docker daemon is not running${NC}"
    exit 1
fi

# Check if Dockerfile exists
if [ ! -f "$DOCKERFILE_PATH" ]; then
    echo -e "${RED}❌ Dockerfile not found at: $DOCKERFILE_PATH${NC}"
    exit 1
fi

# Display build information
echo -e "${YELLOW}📋 Build Information:${NC}"
echo -e "  Image Name: ${GREEN}$IMAGE_NAME${NC}"
echo -e "  Image Tag:  ${GREEN}$IMAGE_TAG${NC}"
echo -e "  Dockerfile: ${GREEN}$DOCKERFILE_PATH${NC}"
echo -e "  Context:    ${GREEN}$BUILD_CONTEXT${NC}"
echo ""

# Start build
echo -e "${BLUE}🏗️  Starting Docker build...${NC}"
echo ""

# Build the Docker image
if docker build \
    -f "$DOCKERFILE_PATH" \
    -t "$IMAGE_NAME:$IMAGE_TAG" \
    -t "$IMAGE_NAME:latest" \
    "$BUILD_CONTEXT"; then
    
    echo ""
    echo -e "${GREEN}✅ Docker image built successfully!${NC}"
    echo ""
    
    # Display image information
    echo -e "${YELLOW}📦 Image Information:${NC}"
    docker images "$IMAGE_NAME:$IMAGE_TAG" --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedAt}}"
    echo ""
    
    # Display usage instructions
    echo -e "${BLUE}🚀 Usage Instructions:${NC}"
    echo -e "${BLUE}=====================${NC}"
    echo ""
    echo -e "To run the container:"
    echo -e "${GREEN}  docker run -d -p 8080:8080 --name amw $IMAGE_NAME:$IMAGE_TAG${NC}"
    echo ""
    echo -e "To run with docker-compose:"
    echo -e "${GREEN}  docker-compose -f docker/docker-compose.yml up -d${NC}"
    echo ""
    echo -e "To view logs:"
    echo -e "${GREEN}  docker logs -f amw${NC}"
    echo ""
    echo -e "To stop the container:"
    echo -e "${GREEN}  docker stop amw${NC}"
    echo ""
    
else
    echo ""
    echo -e "${RED}❌ Docker build failed!${NC}"
    exit 1
fi