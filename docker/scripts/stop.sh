#!/bin/bash

# 🛑 AMW Stop Script
# Simple script to stop AMW services

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🛑 Stopping AMW Services${NC}"
echo -e "${BLUE}=========================${NC}"
echo ""

# Navigate to the docker directory
cd "$(dirname "$0")/.."

# Check if services are running
if docker-compose -f docker-compose.yml ps | grep -q "Up"; then
    echo -e "${YELLOW}📋 Stopping services...${NC}"
    echo ""
    
    # Stop services
    if docker-compose -f docker-compose.yml down; then
        echo ""
        echo -e "${GREEN}✅ AMW services stopped successfully!${NC}"
        echo ""
    else
        echo ""
        echo -e "${RED}❌ Failed to stop some services!${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}ℹ️  No services are currently running${NC}"
fi

# Option to remove volumes
echo ""
read -p "Do you want to remove data volumes? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}🗑️  Removing volumes...${NC}"
    docker-compose -f docker-compose.yml down -v
    echo -e "${GREEN}✅ Volumes removed${NC}"
fi

echo ""
echo -e "${BLUE}🏁 Cleanup complete!${NC}"