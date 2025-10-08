#!/bin/bash

# 🚀 AMW Docker Deploy Script
# Deploys AMW to different environments

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

# Function to check if Docker Compose is available
check_docker_compose() {
    if command -v docker-compose &> /dev/null; then
        DOCKER_COMPOSE="docker-compose"
    elif docker compose version &> /dev/null; then
        DOCKER_COMPOSE="docker compose"
    else
        print_error "Docker Compose is not available"
        exit 1
    fi
    print_status "Using: $DOCKER_COMPOSE"
}

# Function to deploy to specific environment
deploy_environment() {
    local env=$1
    local action=${2:-"up"}
    local compose_file="docker/docker-compose.$env.yml"
    
    if [ ! -f "$compose_file" ]; then
        print_error "Compose file not found: $compose_file"
        exit 1
    fi
    
    print_status "Deploying to $env environment..."
    print_status "Using compose file: $compose_file"
    
    case $action in
        "up")
            $DOCKER_COMPOSE -f "$compose_file" up -d
            print_success "✅ $env environment deployed successfully"
            ;;
        "down")
            $DOCKER_COMPOSE -f "$compose_file" down
            print_success "✅ $env environment stopped successfully"
            ;;
        "restart")
            $DOCKER_COMPOSE -f "$compose_file" restart
            print_success "✅ $env environment restarted successfully"
            ;;
        "logs")
            $DOCKER_COMPOSE -f "$compose_file" logs -f
            ;;
        "ps")
            $DOCKER_COMPOSE -f "$compose_file" ps
            ;;
        "build")
            $DOCKER_COMPOSE -f "$compose_file" build
            print_success "✅ $env environment built successfully"
            ;;
        *)
            print_error "Unknown action: $action"
            exit 1
            ;;
    esac
}

# Function to show environment status
show_status() {
    local env=$1
    local compose_file="docker/docker-compose.$env.yml"
    
    if [ -f "$compose_file" ]; then
        print_status "Status for $env environment:"
        $DOCKER_COMPOSE -f "$compose_file" ps
    else
        print_warning "Compose file not found for $env environment"
    fi
}

# Function to perform health checks
health_check() {
    local env=$1
    local compose_file="docker/docker-compose.$env.yml"
    
    print_status "Performing health check for $env environment..."
    
    # Wait for services to be healthy
    local max_attempts=30
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if $DOCKER_COMPOSE -f "$compose_file" ps | grep -q "Up (healthy)"; then
            print_success "✅ Health check passed for $env environment"
            return 0
        fi
        
        print_status "Waiting for services to be healthy... ($attempt/$max_attempts)"
        sleep 10
        ((attempt++))
    done
    
    print_error "❌ Health check failed for $env environment"
    $DOCKER_COMPOSE -f "$compose_file" ps
    return 1
}

# Function to backup data
backup_data() {
    local env=$1
    local backup_dir="backups/$(date +%Y%m%d_%H%M%S)"
    
    print_status "Creating backup for $env environment..."
    mkdir -p "$backup_dir"
    
    # Backup Redis data if exists
    if docker volume ls | grep -q "${PROJECT_NAME}_redis-data"; then
        print_status "Backing up Redis data..."
        docker run --rm -v "${PROJECT_NAME}_redis-data":/data -v "$(pwd)/$backup_dir":/backup alpine tar czf /backup/redis-data.tar.gz -C /data .
        print_success "Redis data backed up to $backup_dir/redis-data.tar.gz"
    fi
    
    print_success "✅ Backup completed: $backup_dir"
}

# Function to rollback deployment
rollback() {
    local env=$1
    local backup_dir=$2
    
    if [ -z "$backup_dir" ]; then
        print_error "Backup directory required for rollback"
        exit 1
    fi
    
    if [ ! -d "$backup_dir" ]; then
        print_error "Backup directory not found: $backup_dir"
        exit 1
    fi
    
    print_warning "Rolling back $env environment to backup: $backup_dir"
    
    # Stop current environment
    deploy_environment "$env" "down"
    
    # Restore Redis data if backup exists
    if [ -f "$backup_dir/redis-data.tar.gz" ]; then
        print_status "Restoring Redis data from backup..."
        docker volume rm "${PROJECT_NAME}_redis-data" || true
        docker volume create "${PROJECT_NAME}_redis-data"
        docker run --rm -v "${PROJECT_NAME}_redis-data":/data -v "$(pwd)/$backup_dir":/backup alpine tar xzf /backup/redis-data.tar.gz -C /data
        print_success "Redis data restored from backup"
    fi
    
    # Start environment
    deploy_environment "$env" "up"
    
    print_success "✅ Rollback completed for $env environment"
}

# Main deploy function
main() {
    local environment=${1:-"dev"}
    local action=${2:-"up"}
    
    print_status "🚀 AMW Docker Deploy Script"
    print_status "Environment: $environment"
    print_status "Action: $action"
    
    # Change to project root directory
    cd "$(dirname "$0")/../.."
    
    # Check prerequisites
    check_docker_compose
    
    case $environment in
        "dev"|"development")
            deploy_environment "dev" "$action"
            if [ "$action" = "up" ]; then
                print_status "Development environment available at: http://localhost:8080"
                print_status "Redis available at: localhost:6379"
            fi
            ;;
        
        "test"|"testing")
            deploy_environment "test" "$action"
            ;;
        
        "prod"|"production")
            if [ "$action" = "up" ]; then
                # Create backup before production deployment
                backup_data "prod"
            fi
            
            deploy_environment "prod" "$action"
            
            if [ "$action" = "up" ]; then
                # Perform health check after deployment
                if health_check "prod"; then
                    print_success "🎉 Production deployment successful!"
                    print_status "Application available at: http://localhost"
                else
                    print_error "Production deployment failed health check"
                    print_warning "Consider rolling back the deployment"
                    exit 1
                fi
            fi
            ;;
        
        "status")
            for env in "dev" "test" "prod"; do
                show_status "$env"
                echo ""
            done
            ;;
        
        *)
            print_error "Unknown environment: $environment"
            print_status "Available environments: dev, test, prod, status"
            exit 1
            ;;
    esac
}

# Help function
show_help() {
    echo "🚀 AMW Docker Deploy Script"
    echo ""
    echo "Usage: $0 [environment] [action]"
    echo ""
    echo "Environments:"
    echo "  dev, development  - Development environment (default)"
    echo "  test, testing     - Testing environment"
    echo "  prod, production  - Production environment"
    echo "  status            - Show status of all environments"
    echo ""
    echo "Actions:"
    echo "  up                - Start services (default)"
    echo "  down              - Stop services"
    echo "  restart           - Restart services"
    echo "  logs              - Show logs"
    echo "  ps                - Show running containers"
    echo "  build             - Build images"
    echo ""
    echo "Special Commands:"
    echo "  $0 prod backup                    # Backup production data"
    echo "  $0 prod rollback [backup_dir]     # Rollback to backup"
    echo ""
    echo "Examples:"
    echo "  $0                                # Start development environment"
    echo "  $0 dev up                         # Start development environment"
    echo "  $0 prod up                        # Deploy to production"
    echo "  $0 prod down                      # Stop production"
    echo "  $0 status                         # Show all environment status"
}

# Handle special commands
case "$2" in
    "backup")
        backup_data "$1"
        exit 0
        ;;
    "rollback")
        rollback "$1" "$3"
        exit 0
        ;;
esac

# Check if help is requested
if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    show_help
    exit 0
fi

# Run main function
main "$@"