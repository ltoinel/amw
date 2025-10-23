#!/bin/bash

# 🔍 AMW Docker Configuration Validator
# Validates Docker setup and provides usage information

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔍 AMW Docker Configuration Validator${NC}"
echo -e "${BLUE}=====================================${NC}"
echo ""

# Navigate to the docker directory (parent of scripts/)
cd "$(dirname "$0")/.."

echo -e "${YELLOW}📋 Checking Docker configuration...${NC}"
echo ""

# Check required files
REQUIRED_FILES=(
    "Dockerfile"
    "docker-compose.yml"
    "scripts/build.sh"
    "scripts/start.sh"
    "scripts/stop.sh"
    ".dockerignore"
)

all_files_exist=true

for file in "${REQUIRED_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo -e "  ✅ $file"
    else
        echo -e "  ❌ $file (missing)"
        all_files_exist=false
    fi
done

echo ""

# Check script permissions
echo -e "${YELLOW}🔐 Checking script permissions...${NC}"
echo ""

SCRIPTS=(
    "scripts/build.sh"
    "scripts/start.sh"
    "scripts/stop.sh"
)

for script in "${SCRIPTS[@]}"; do
    if [ -x "$script" ]; then
        echo -e "  ✅ $script (executable)"
    else
        echo -e "  ❌ $script (not executable)"
        chmod +x "$script"
        echo -e "  🔧 Fixed permissions for $script"
    fi
done

echo ""

# Display configuration summary
echo -e "${BLUE}📊 Configuration Summary${NC}"
echo -e "${BLUE}=========================${NC}"
echo ""
echo -e "  Docker Files: ${GREEN}Simplified configuration${NC}"
echo -e "  Services:     ${GREEN}AMW + Redis${NC}"
echo -e "  Port:         ${GREEN}8080${NC}"
echo -e "  Scripts:      ${GREEN}3 simple scripts${NC}"
echo ""

# Display usage instructions
echo -e "${BLUE}🚀 Usage Instructions${NC}"
echo -e "${BLUE}======================${NC}"
echo ""
echo -e "1. Build production image:"
echo -e "   ${GREEN}npm run docker:build${NC}"
echo ""
echo -e "2. Start production services:"
echo -e "   ${GREEN}npm run docker:start${NC}"
echo ""
echo -e "3. View logs:"
echo -e "   ${GREEN}npm run docker:logs${NC}"
echo ""
echo -e "4. Stop services:"
echo -e "   ${GREEN}npm run docker:stop${NC}"
echo ""

# Check if Docker is available
echo -e "${YELLOW}🐳 Docker Status:${NC}"
if command -v docker &> /dev/null; then
    if docker info &> /dev/null 2>&1; then
        echo -e "  ✅ Docker is installed and running"
        
        # Show Docker version
        docker_version=$(docker --version | cut -d' ' -f3 | cut -d',' -f1)
        echo -e "  📦 Version: $docker_version"
        
        # Check docker-compose
        if command -v docker-compose &> /dev/null; then
            compose_version=$(docker-compose --version | cut -d' ' -f3 | cut -d',' -f1)
            echo -e "  📦 Docker Compose: $compose_version"
            echo -e "  🎯 Ready for production deployment!"
        else
            echo -e "  ⚠️  Docker Compose not found"
        fi
    else
        echo -e "  ⚠️  Docker is installed but not running"
    fi
else
    echo -e "  ℹ️  Docker not installed (install Docker to use container deployment)"
fi

echo ""

if [ "$all_files_exist" = true ]; then
    echo -e "${GREEN}✅ Docker configuration is valid and ready!${NC}"
    exit 0
else
    echo -e "${RED}❌ Some files are missing. Please check the configuration.${NC}"
    exit 1
fi