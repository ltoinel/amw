#!/bin/bash

# 🐳 AMW Docker Build Script
# Builds Docker images for different environments

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Project information
PROJECT_NAME="amw"
REGISTRY_USER="ltoinel"

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

# Function to build specific image
build_image() {
    local env=$1
    local dockerfile=$2
    local tag=$3
    
    print_status "Building $env image: $tag"
    
    if docker build -f "docker/$dockerfile" -t "$tag" .; then
        print_success "Successfully built $env image: $tag"
    else
        print_error "Failed to build $env image: $tag"
        exit 1
    fi
}

# Function to build multi-platform image
build_multiplatform() {
    local dockerfile=$1
    local tag=$2
    
    print_status "Building multi-platform image: $tag"
    
    if docker buildx build \
        --platform linux/amd64,linux/arm64 \
        -f "docker/$dockerfile" \
        -t "$tag" \
        --push .; then
        print_success "Successfully built and pushed multi-platform image: $tag"
    else
        print_error "Failed to build multi-platform image: $tag"
        exit 1
    fi
}

# Get version from package.json
get_version() {
    node -p "require('./package.json').version"
}

# Main build function
main() {
    local environment=${1:-"all"}
    local push=${2:-false}
    local version=$(get_version)
    
    print_status "🐳 Building AMW Docker Images"
    print_status "Version: $version"
    print_status "Environment: $environment"
    
    # Change to project root directory
    cd "$(dirname "$0")/../.."
    
    case $environment in
        "dev"|"development")
            build_image "Development" "Dockerfile.dev" "$PROJECT_NAME:dev"
            build_image "Development" "Dockerfile.dev" "$PROJECT_NAME:dev-$version"
            ;;
        
        "test"|"testing")
            build_image "Testing" "Dockerfile.test" "$PROJECT_NAME:test"
            build_image "Testing" "Dockerfile.test" "$PROJECT_NAME:test-$version"
            ;;
        
        "prod"|"production")
            build_image "Production" "Dockerfile" "$PROJECT_NAME:latest"
            build_image "Production" "Dockerfile" "$PROJECT_NAME:$version"
            
            if [ "$push" = "true" ]; then
                print_status "Pushing production images to registry..."
                docker tag "$PROJECT_NAME:latest" "$REGISTRY_USER/$PROJECT_NAME:latest"
                docker tag "$PROJECT_NAME:$version" "$REGISTRY_USER/$PROJECT_NAME:$version"
                docker push "$REGISTRY_USER/$PROJECT_NAME:latest"
                docker push "$REGISTRY_USER/$PROJECT_NAME:$version"
                print_success "Production images pushed to registry"
            fi
            ;;
        
        "multiplatform"|"multi")
            print_status "Building multi-platform production image..."
            build_multiplatform "Dockerfile" "$REGISTRY_USER/$PROJECT_NAME:latest"
            build_multiplatform "Dockerfile" "$REGISTRY_USER/$PROJECT_NAME:$version"
            ;;
        
        "all")
            print_status "Building all environments..."
            build_image "Development" "Dockerfile.dev" "$PROJECT_NAME:dev"
            build_image "Testing" "Dockerfile.test" "$PROJECT_NAME:test"
            build_image "Production" "Dockerfile" "$PROJECT_NAME:latest"
            build_image "Production" "Dockerfile" "$PROJECT_NAME:$version"
            ;;
        
        *)
            print_error "Unknown environment: $environment"
            print_status "Available environments: dev, test, prod, multiplatform, all"
            exit 1
            ;;
    esac
    
    print_success "🎉 Docker build completed successfully!"
    
    # Show built images
    print_status "Built images:"
    docker images | grep "$PROJECT_NAME" | head -10
}

# Help function
show_help() {
    echo "🐳 AMW Docker Build Script"
    echo ""
    echo "Usage: $0 [environment] [push]"
    echo ""
    echo "Environments:"
    echo "  dev, development  - Build development image with hot reload"
    echo "  test, testing     - Build testing image with test tools"
    echo "  prod, production  - Build production image (optimized)"
    echo "  multiplatform     - Build multi-platform production image"
    echo "  all               - Build all environments (default)"
    echo ""
    echo "Options:"
    echo "  push              - Push production images to registry"
    echo ""
    echo "Examples:"
    echo "  $0                    # Build all environments"
    echo "  $0 dev                # Build development image only"
    echo "  $0 prod push          # Build and push production image"
    echo "  $0 multiplatform      # Build multi-platform image"
}

# Check if help is requested
if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    show_help
    exit 0
fi

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    print_error "Docker is not installed or not available in PATH"
    exit 1
fi

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    print_error "package.json not found. Please run this script from the project root directory."
    exit 1
fi

# Run main function
main "$@"