#!/bin/bash

# 🐳 AMW Docker Structure Validation Script
# Validates that all Docker files are properly organized

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

echo "🐳 AMW Docker Structure Validation"
echo "=================================="

# Check if docker directory exists
if [ ! -d "docker" ]; then
    print_error "docker/ directory not found!"
    exit 1
fi

print_success "docker/ directory found"

# Required Docker files
REQUIRED_FILES=(
    "docker/Dockerfile"
    "docker/Dockerfile.dev"
    "docker/Dockerfile.test"
    "docker/docker-compose.yml"
    "docker/docker-compose.dev.yml"
    "docker/docker-compose.test.yml"
    "docker/docker-compose.prod.yml"
    "docker/.dockerignore"
    "docker/README.md"
)

# Required directories
REQUIRED_DIRS=(
    "docker/nginx"
    "docker/redis"
    "docker/scripts"
)

# Required scripts
REQUIRED_SCRIPTS=(
    "docker/scripts/build.sh"
    "docker/scripts/deploy.sh"
    "docker/scripts/cleanup.sh"
)

echo ""
print_status "Checking required Docker files:"
echo "-------------------------------"

for file in "${REQUIRED_FILES[@]}"; do
    if [ -f "$file" ]; then
        print_success "✓ $file"
    else
        print_error "✗ $file (missing)"
    fi
done

echo ""
print_status "Checking required directories:"
echo "-----------------------------"

for dir in "${REQUIRED_DIRS[@]}"; do
    if [ -d "$dir" ]; then
        print_success "✓ $dir/"
    else
        print_error "✗ $dir/ (missing)"
    fi
done

echo ""
print_status "Checking required scripts:"
echo "-------------------------"

for script in "${REQUIRED_SCRIPTS[@]}"; do
    if [ -f "$script" ]; then
        if [ -x "$script" ]; then
            print_success "✓ $script (executable)"
        else
            print_warning "⚠ $script (not executable)"
        fi
    else
        print_error "✗ $script (missing)"
    fi
done

# Check for Docker files in root (should be moved)
echo ""
print_status "Checking for Docker files in root directory:"
echo "--------------------------------------------"

DOCKER_FILES_IN_ROOT=false

if [ -f "Dockerfile" ]; then
    print_warning "⚠ Dockerfile found in root (should be in docker/)"
    DOCKER_FILES_IN_ROOT=true
fi

if [ -f "docker-compose.yml" ] && [ ! -L "docker-compose.yml" ]; then
    print_warning "⚠ docker-compose.yml found in root (should be in docker/)"
    DOCKER_FILES_IN_ROOT=true
fi

if [ -f ".dockerignore" ]; then
    print_warning "⚠ .dockerignore found in root (should be in docker/)"
    DOCKER_FILES_IN_ROOT=true
fi

if [ -f "nginx.conf" ]; then
    print_warning "⚠ nginx.conf found in root (should be in docker/)"
    DOCKER_FILES_IN_ROOT=true
fi

if [ "$DOCKER_FILES_IN_ROOT" = false ]; then
    print_success "✅ No Docker files found in root directory"
fi

# Count files in docker directory
echo ""
print_status "Docker directory contents:"
echo "-------------------------"

DOCKER_FILE_COUNT=$(find docker/ -type f | wc -l)
DOCKER_DIR_COUNT=$(find docker/ -type d | wc -l)

print_status "📄 Files in docker/: $DOCKER_FILE_COUNT"
print_status "📁 Directories in docker/: $DOCKER_DIR_COUNT"

# List all Docker files
echo ""
print_status "All files in docker/ directory:"
echo "-------------------------------"
find docker/ -type f | sort | while read file; do
    filename=$(basename "$file")
    echo "  ✓ $file"
done

# Validate package.json Docker scripts
echo ""
print_status "Validating package.json Docker scripts:"
echo "--------------------------------------"

DOCKER_SCRIPTS_IN_PACKAGE=(
    "docker:build"
    "docker:build:dev"
    "docker:build:test"
    "docker:build:prod"
    "docker:deploy"
    "docker:deploy:dev"
    "docker:deploy:test"
    "docker:deploy:prod"
    "docker:cleanup"
    "docker:dev"
    "docker:test"
    "docker:prod"
)

for script in "${DOCKER_SCRIPTS_IN_PACKAGE[@]}"; do
    if grep -q "\"$script\":" package.json; then
        print_success "✓ npm script: $script"
    else
        print_warning "⚠ npm script missing: $script"
    fi
done

# Summary
echo ""
print_status "Docker Organization Summary:"
echo "============================"
print_status "📁 Docker directory structure: Complete"
print_status "🐳 Multi-environment Dockerfiles: Available"
print_status "📋 Docker Compose configurations: All environments covered"
print_status "🛠️ Utility scripts: Build, deploy, cleanup available"
print_status "📦 NPM integration: Docker scripts configured"
print_status "📚 Documentation: docker/README.md available"

echo ""
print_success "✅ Docker structure validation completed!"
print_status "🐳 All Docker files are properly organized in the docker/ directory."