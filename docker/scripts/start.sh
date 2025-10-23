#!/bin/bash

# 🚀 AMW Deployment Script
# Simple script to deploy AMW

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 AMW Deployment${NC}"
echo -e "${BLUE}==================${NC}"
echo ""

# Check if docker-compose is available
if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}❌ docker-compose is not installed${NC}"
    exit 1
fi

# Navigate to the docker directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOCKER_DIR="$(dirname "$SCRIPT_DIR")"
cd "$DOCKER_DIR"

echo -e "${YELLOW}📋 Starting services...${NC}"
echo ""

# Start services
if docker-compose -f docker-compose.yml up -d; then
    echo ""
    echo -e "${GREEN}✅ AMW services started successfully!${NC}"
    echo ""
    
    # Show running containers
    echo -e "${YELLOW}📦 Running Containers:${NC}"
    docker-compose -f docker-compose.yml ps
    echo ""
    
    # Display usage information
    echo -e "${BLUE}🌐 Access Information:${NC}"
    echo -e "${BLUE}=====================${NC}"
    echo -e "  AMW API: ${GREEN}http://localhost:8080${NC}"
    echo -e "  Health:  ${GREEN}http://localhost:8080/amw/product?keyword=test${NC}"
    echo ""
    
    echo -e "${BLUE}📊 Management Commands:${NC}"
    echo -e "${BLUE}=======================${NC}"
    echo -e "  View logs:    ${GREEN}docker-compose -f docker/docker-compose.yml logs -f${NC}"
    echo -e "  Stop services: ${GREEN}docker-compose -f docker/docker-compose.yml down${NC}"
    echo -e "  Restart:      ${GREEN}docker-compose -f docker/docker-compose.yml restart${NC}"
    echo ""
    
else
    echo ""
    echo -e "${RED}❌ Failed to start services!${NC}"
    exit 1
fi