#!/bin/bash

# 🧹 AMW Docker Cleanup Script
# Cleans up Docker images, containers, volumes, and networks

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Project information
PROJECT_NAME="amw"

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

# Function to get disk space usage
get_disk_usage() {
    docker system df 2>/dev/null || echo "Unable to get Docker disk usage"
}

# Function to cleanup stopped containers
cleanup_containers() {
    print_status "Cleaning up stopped containers..."
    
    local stopped_containers=$(docker ps -aq --filter "status=exited")
    if [ -n "$stopped_containers" ]; then
        docker rm $stopped_containers
        print_success "Removed stopped containers"
    else
        print_status "No stopped containers to remove"
    fi
}

# Function to cleanup dangling images
cleanup_dangling_images() {
    print_status "Cleaning up dangling images..."
    
    local dangling_images=$(docker images -qf "dangling=true")
    if [ -n "$dangling_images" ]; then
        docker rmi $dangling_images
        print_success "Removed dangling images"
    else
        print_status "No dangling images to remove"
    fi
}

# Function to cleanup old AMW images
cleanup_old_images() {
    local keep_latest=${1:-3}
    print_status "Cleaning up old AMW images (keeping latest $keep_latest)..."
    
    # Get all AMW images sorted by creation date
    local amw_images=$(docker images --format "table {{.Repository}}:{{.Tag}}\t{{.CreatedAt}}" | grep "$PROJECT_NAME" | tail -n +$((keep_latest + 1)) | cut -f1)
    
    if [ -n "$amw_images" ]; then
        echo "$amw_images" | while read image; do
            if [ -n "$image" ]; then
                docker rmi "$image" || print_warning "Failed to remove image: $image"
            fi
        done
        print_success "Cleaned up old AMW images"
    else
        print_status "No old AMW images to remove"
    fi
}

# Function to cleanup unused volumes
cleanup_volumes() {
    print_status "Cleaning up unused volumes..."
    
    local unused_volumes=$(docker volume ls -qf "dangling=true")
    if [ -n "$unused_volumes" ]; then
        docker volume rm $unused_volumes
        print_success "Removed unused volumes"
    else
        print_status "No unused volumes to remove"
    fi
}

# Function to cleanup unused networks
cleanup_networks() {
    print_status "Cleaning up unused networks..."
    
    # Remove networks not used by any containers
    docker network prune -f
    print_success "Cleaned up unused networks"
}

# Function to cleanup build cache
cleanup_build_cache() {
    print_status "Cleaning up Docker build cache..."
    
    # Remove all build cache
    docker builder prune -af
    print_success "Cleaned up build cache"
}

# Function to show Docker system information
show_docker_info() {
    print_status "Docker System Information:"
    echo ""
    
    print_status "Disk Usage:"
    get_disk_usage
    echo ""
    
    print_status "Running Containers:"
    docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"
    echo ""
    
    print_status "AMW Images:"
    docker images --format "table {{.Repository}}:{{.Tag}}\t{{.Size}}\t{{.CreatedAt}}" | grep -E "(REPOSITORY|$PROJECT_NAME)" || echo "No AMW images found"
    echo ""
    
    print_status "Volumes:"
    docker volume ls
    echo ""
    
    print_status "Networks:"
    docker network ls
}

# Function to perform full cleanup
full_cleanup() {
    local force=${1:-false}
    
    if [ "$force" != "true" ]; then
        print_warning "This will remove ALL unused Docker resources!"
        print_warning "Running containers and their images will NOT be affected."
        read -p "Are you sure you want to continue? (y/N): " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            print_status "Cleanup cancelled"
            return 0
        fi
    fi
    
    print_status "🧹 Starting full Docker cleanup..."
    
    # Show disk usage before cleanup
    print_status "Disk usage BEFORE cleanup:"
    get_disk_usage
    echo ""
    
    # Perform cleanup steps
    cleanup_containers
    cleanup_dangling_images
    cleanup_old_images 3
    cleanup_volumes
    cleanup_networks
    cleanup_build_cache
    
    # Show disk usage after cleanup
    echo ""
    print_status "Disk usage AFTER cleanup:"
    get_disk_usage
    
    print_success "🎉 Full cleanup completed!"
}

# Function to cleanup specific AMW environment
cleanup_environment() {
    local env=$1
    local compose_file="docker/docker-compose.$env.yml"
    
    if [ ! -f "$compose_file" ]; then
        print_error "Compose file not found: $compose_file"
        exit 1
    fi
    
    print_status "Cleaning up $env environment..."
    
    # Check if Docker Compose is available
    if command -v docker-compose &> /dev/null; then
        DOCKER_COMPOSE="docker-compose"
    elif docker compose version &> /dev/null; then
        DOCKER_COMPOSE="docker compose"
    else
        print_error "Docker Compose is not available"
        exit 1
    fi
    
    # Stop and remove containers, networks, and volumes for this environment
    $DOCKER_COMPOSE -f "$compose_file" down -v --rmi all --remove-orphans
    
    print_success "✅ $env environment cleaned up"
}

# Function to emergency cleanup
emergency_cleanup() {
    print_warning "🚨 EMERGENCY CLEANUP - This will remove EVERYTHING!"
    print_warning "This includes ALL containers, images, volumes, and networks!"
    read -p "Type 'EMERGENCY' to confirm: " confirmation
    
    if [ "$confirmation" != "EMERGENCY" ]; then
        print_status "Emergency cleanup cancelled"
        return 0
    fi
    
    print_status "Performing emergency cleanup..."
    
    # Stop all containers
    docker stop $(docker ps -aq) 2>/dev/null || true
    
    # Remove everything
    docker system prune -af --volumes
    
    print_success "🎉 Emergency cleanup completed"
}

# Main cleanup function
main() {
    local action=${1:-"help"}
    
    print_status "🧹 AMW Docker Cleanup Script"
    
    # Change to project root directory
    cd "$(dirname "$0")/../.."
    
    case $action in
        "containers")
            cleanup_containers
            ;;
        
        "images")
            cleanup_dangling_images
            cleanup_old_images 3
            ;;
        
        "volumes")
            cleanup_volumes
            ;;
        
        "networks")
            cleanup_networks
            ;;
        
        "cache")
            cleanup_build_cache
            ;;
        
        "dev"|"test"|"prod")
            cleanup_environment "$action"
            ;;
        
        "full")
            full_cleanup
            ;;
        
        "force")
            full_cleanup true
            ;;
        
        "emergency")
            emergency_cleanup
            ;;
        
        "info"|"status")
            show_docker_info
            ;;
        
        *)
            show_help
            ;;
    esac
}

# Help function
show_help() {
    echo "🧹 AMW Docker Cleanup Script"
    echo ""
    echo "Usage: $0 [action]"
    echo ""
    echo "Actions:"
    echo "  containers        - Remove stopped containers"
    echo "  images           - Remove dangling and old AMW images"
    echo "  volumes          - Remove unused volumes"
    echo "  networks         - Remove unused networks"
    echo "  cache            - Remove build cache"
    echo "  dev|test|prod    - Cleanup specific environment"
    echo "  full             - Perform full cleanup (interactive)"
    echo "  force            - Perform full cleanup (non-interactive)"
    echo "  emergency        - Remove EVERYTHING (dangerous!)"
    echo "  info|status      - Show Docker system information"
    echo ""
    echo "Examples:"
    echo "  $0 info              # Show system information"
    echo "  $0 containers        # Remove stopped containers"
    echo "  $0 images            # Cleanup old images"
    echo "  $0 dev               # Cleanup development environment"
    echo "  $0 full              # Interactive full cleanup"
    echo "  $0 force             # Non-interactive full cleanup"
}

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    print_error "Docker is not installed or not available in PATH"
    exit 1
fi

# Run main function
main "$@"