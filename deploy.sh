#!/bin/bash

# ============================================================
# Huawei OLT Manager - Deployment Script
# ============================================================
# Features:
# - Auto-detect available Docker port
# - Skip nginx install if already exists
# - Skip nginx config if already exists
# - Auto SSL configuration with Let's Encrypt
# - Database backup on every deployment
# - Cleanup unused Docker resources older than 24h
# ============================================================

set -e

# Configuration - Modify these as needed
APP_NAME="huawei-olt-manager"
DOMAIN="${DOMAIN:-olt.example.com}"
EMAIL="${EMAIL:-admin@example.com}"
BASE_PORT="${BASE_PORT:-3000}"
MAX_PORT_ATTEMPTS=100
BACKUP_DIR="/var/backups/${APP_NAME}"
DOCKER_IMAGE="${APP_NAME}:latest"
CONTAINER_NAME="${APP_NAME}"
NGINX_CONF_DIR="/etc/nginx/sites-available"
NGINX_ENABLED_DIR="/etc/nginx/sites-enabled"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# ============================================================
# 1. Auto-detect available Docker port
# ============================================================
find_available_port() {
    local port=$BASE_PORT
    local attempts=0
    
    log_info "Finding available port starting from $BASE_PORT..."
    
    while [ $attempts -lt $MAX_PORT_ATTEMPTS ]; do
        # Check if port is in use by any process
        if ! ss -tuln | grep -q ":$port " && \
           ! docker ps --format '{{.Ports}}' 2>/dev/null | grep -q ":$port->"; then
            log_success "Found available port: $port"
            echo $port
            return 0
        fi
        log_warn "Port $port is in use, trying next..."
        port=$((port + 1))
        attempts=$((attempts + 1))
    done
    
    log_error "Could not find available port after $MAX_PORT_ATTEMPTS attempts"
    exit 1
}

# ============================================================
# 2. Check and install Nginx
# ============================================================
setup_nginx() {
    log_info "Checking Nginx installation..."
    
    if command -v nginx &> /dev/null; then
        log_success "Nginx already installed, skipping installation"
    else
        log_info "Installing Nginx..."
        if command -v apt-get &> /dev/null; then
            sudo apt-get update
            sudo apt-get install -y nginx
        elif command -v yum &> /dev/null; then
            sudo yum install -y nginx
        elif command -v dnf &> /dev/null; then
            sudo dnf install -y nginx
        else
            log_error "Could not detect package manager. Please install Nginx manually."
            exit 1
        fi
        sudo systemctl enable nginx
        sudo systemctl start nginx
        log_success "Nginx installed successfully"
    fi
}

# ============================================================
# 3. Create Nginx configuration (skip if exists)
# ============================================================
create_nginx_config() {
    local port=$1
    local config_file="${NGINX_CONF_DIR}/${APP_NAME}"
    
    log_info "Checking Nginx configuration for ${APP_NAME}..."
    
    if [ -f "$config_file" ]; then
        log_success "Nginx configuration already exists, skipping"
        
        # Update port in existing config if different
        if grep -q "proxy_pass http://127.0.0.1:${port}" "$config_file"; then
            log_info "Port configuration is up to date"
        else
            log_warn "Updating port in existing configuration..."
            sudo sed -i "s|proxy_pass http://127.0.0.1:[0-9]*;|proxy_pass http://127.0.0.1:${port};|g" "$config_file"
            sudo nginx -t && sudo systemctl reload nginx
            log_success "Port updated in Nginx configuration"
        fi
        return 0
    fi
    
    log_info "Creating Nginx configuration..."
    
    # Create sites-available and sites-enabled if they don't exist
    sudo mkdir -p "$NGINX_CONF_DIR" "$NGINX_ENABLED_DIR"
    
    sudo tee "$config_file" > /dev/null <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 86400;
    }
}
EOF

    # Enable the site
    if [ ! -L "${NGINX_ENABLED_DIR}/${APP_NAME}" ]; then
        sudo ln -s "$config_file" "${NGINX_ENABLED_DIR}/${APP_NAME}"
    fi
    
    # Test and reload Nginx
    sudo nginx -t && sudo systemctl reload nginx
    log_success "Nginx configuration created and enabled"
}

# ============================================================
# 4. Setup SSL with Let's Encrypt (skip if exists)
# ============================================================
setup_ssl() {
    log_info "Checking SSL configuration..."
    
    # Check if SSL is already configured
    if [ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
        log_success "SSL certificate already exists for ${DOMAIN}, skipping"
        return 0
    fi
    
    # Check if nginx config already has SSL
    if grep -q "ssl_certificate" "${NGINX_CONF_DIR}/${APP_NAME}" 2>/dev/null; then
        log_success "SSL already configured in Nginx, skipping"
        return 0
    fi
    
    log_info "Setting up SSL with Let's Encrypt..."
    
    # Install certbot if not present
    if ! command -v certbot &> /dev/null; then
        log_info "Installing Certbot..."
        if command -v apt-get &> /dev/null; then
            sudo apt-get update
            sudo apt-get install -y certbot python3-certbot-nginx
        elif command -v yum &> /dev/null; then
            sudo yum install -y certbot python3-certbot-nginx
        elif command -v dnf &> /dev/null; then
            sudo dnf install -y certbot python3-certbot-nginx
        else
            log_error "Could not install certbot. Please install it manually."
            return 1
        fi
    fi
    
    # Obtain SSL certificate
    log_info "Obtaining SSL certificate for ${DOMAIN}..."
    sudo certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos --email "${EMAIL}" --redirect
    
    if [ $? -eq 0 ]; then
        log_success "SSL certificate obtained and configured"
        
        # Setup auto-renewal cron job if not exists
        if ! crontab -l 2>/dev/null | grep -q "certbot renew"; then
            (crontab -l 2>/dev/null; echo "0 12 * * * /usr/bin/certbot renew --quiet") | crontab -
            log_success "SSL auto-renewal cron job added"
        fi
    else
        log_warn "SSL setup failed. You may need to configure it manually."
        log_warn "Make sure your domain ${DOMAIN} points to this server."
    fi
}

# ============================================================
# 5. Backup database before deployment
# ============================================================
backup_database() {
    log_info "Backing up database..."
    
    # Create backup directory
    sudo mkdir -p "$BACKUP_DIR"
    
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_file="${BACKUP_DIR}/db_backup_${timestamp}.sql"
    
    # Check if container exists and is running
    if docker ps -q -f name="${CONTAINER_NAME}" 2>/dev/null | grep -q .; then
        # Try to backup from running container
        if docker exec "${CONTAINER_NAME}" pg_dump -U postgres 2>/dev/null > "$backup_file"; then
            log_success "Database backed up to: $backup_file"
            
            # Compress the backup
            gzip "$backup_file"
            log_success "Backup compressed: ${backup_file}.gz"
            
            # Keep only last 7 backups
            ls -t "${BACKUP_DIR}"/db_backup_*.sql.gz 2>/dev/null | tail -n +8 | xargs -r rm
            log_info "Old backups cleaned up (keeping last 7)"
        else
            log_warn "Could not backup database from container (may not have PostgreSQL inside)"
        fi
    else
        # Check for external PostgreSQL database URL
        if [ -n "$DATABASE_URL" ]; then
            log_info "Backing up external database..."
            PGPASSWORD=$(echo $DATABASE_URL | sed -n 's/.*:\/\/[^:]*:\([^@]*\)@.*/\1/p') \
            pg_dump "$DATABASE_URL" > "$backup_file" 2>/dev/null && \
            gzip "$backup_file" && \
            log_success "External database backed up: ${backup_file}.gz" || \
            log_warn "Could not backup external database"
        else
            log_warn "No running container or DATABASE_URL found, skipping backup"
        fi
    fi
}

# ============================================================
# 6. Cleanup unused Docker resources older than 24h
# ============================================================
cleanup_docker() {
    log_info "Cleaning up unused Docker resources older than 24 hours..."
    
    # Remove stopped containers older than 24h
    docker container prune -f --filter "until=24h" 2>/dev/null || true
    log_info "Removed old stopped containers"
    
    # Remove unused images older than 24h
    docker image prune -a -f --filter "until=24h" 2>/dev/null || true
    log_info "Removed unused images"
    
    # Remove unused volumes (be careful with this)
    docker volume prune -f 2>/dev/null || true
    log_info "Removed unused volumes"
    
    # Remove build cache older than 24h
    docker builder prune -f --filter "until=24h" 2>/dev/null || true
    log_info "Removed old build cache"
    
    # Remove unused networks
    docker network prune -f 2>/dev/null || true
    log_info "Removed unused networks"
    
    log_success "Docker cleanup completed"
}

# ============================================================
# Build and deploy the application
# ============================================================
deploy_application() {
    local port=$1
    
    log_info "Building Docker image..."
    
    # Check if Dockerfile exists, if not create one
    if [ ! -f "Dockerfile" ]; then
        log_info "Creating Dockerfile..."
        create_dockerfile
    fi
    
    # Build the image
    docker build -t "${DOCKER_IMAGE}" .
    log_success "Docker image built successfully"
    
    # Stop and remove existing container if running
    if docker ps -a -q -f name="${CONTAINER_NAME}" 2>/dev/null | grep -q .; then
        log_info "Stopping existing container..."
        docker stop "${CONTAINER_NAME}" 2>/dev/null || true
        docker rm "${CONTAINER_NAME}" 2>/dev/null || true
    fi
    
    # Run the new container
    log_info "Starting new container on port ${port}..."
    docker run -d \
        --name "${CONTAINER_NAME}" \
        --restart unless-stopped \
        -p "127.0.0.1:${port}:5000" \
        -e NODE_ENV=production \
        -e DATABASE_URL="${DATABASE_URL}" \
        -e SESSION_SECRET="${SESSION_SECRET:-$(openssl rand -hex 32)}" \
        -v "${APP_NAME}_data:/app/data" \
        "${DOCKER_IMAGE}"
    
    # Wait for container to be healthy
    log_info "Waiting for application to start..."
    sleep 5
    
    if docker ps -q -f name="${CONTAINER_NAME}" | grep -q .; then
        log_success "Application deployed successfully!"
        log_info "Container running on port ${port}"
    else
        log_error "Container failed to start. Check logs with: docker logs ${CONTAINER_NAME}"
        exit 1
    fi
}

# ============================================================
# Create Dockerfile if it doesn't exist
# ============================================================
create_dockerfile() {
    cat > Dockerfile <<'EOF'
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy built application
COPY --from=builder /app/dist ./dist

# Create data directory
RUN mkdir -p /app/data

# Expose port
EXPOSE 5000

# Set environment
ENV NODE_ENV=production

# Start the application
CMD ["node", "dist/index.js"]
EOF
    log_success "Dockerfile created"
}

# ============================================================
# Main deployment flow
# ============================================================
main() {
    echo ""
    echo "============================================================"
    echo "  Huawei OLT Manager - Deployment Script"
    echo "============================================================"
    echo ""
    
    # Check if running as root or with sudo
    if [ "$EUID" -ne 0 ] && ! sudo -n true 2>/dev/null; then
        log_warn "Some operations may require sudo access"
    fi
    
    # Check Docker installation
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --domain)
                DOMAIN="$2"
                shift 2
                ;;
            --email)
                EMAIL="$2"
                shift 2
                ;;
            --port)
                BASE_PORT="$2"
                shift 2
                ;;
            --skip-ssl)
                SKIP_SSL=true
                shift
                ;;
            --skip-nginx)
                SKIP_NGINX=true
                shift
                ;;
            --help)
                echo "Usage: ./deploy.sh [OPTIONS]"
                echo ""
                echo "Options:"
                echo "  --domain DOMAIN    Set the domain name (default: olt.example.com)"
                echo "  --email EMAIL      Email for Let's Encrypt (default: admin@example.com)"
                echo "  --port PORT        Base port to start searching from (default: 3000)"
                echo "  --skip-ssl         Skip SSL configuration"
                echo "  --skip-nginx       Skip Nginx configuration"
                echo "  --help             Show this help message"
                echo ""
                echo "Environment variables:"
                echo "  DATABASE_URL       PostgreSQL connection string"
                echo "  SESSION_SECRET     Session encryption secret"
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                exit 1
                ;;
        esac
    done
    
    log_info "Domain: ${DOMAIN}"
    log_info "Email: ${EMAIL}"
    echo ""
    
    # Step 1: Find available port
    APP_PORT=$(find_available_port)
    echo ""
    
    # Step 2: Cleanup old Docker resources
    cleanup_docker
    echo ""
    
    # Step 3: Backup database
    backup_database
    echo ""
    
    # Step 4: Setup Nginx (if not skipped)
    if [ "$SKIP_NGINX" != "true" ]; then
        setup_nginx
        echo ""
        
        # Step 5: Create Nginx config
        create_nginx_config "$APP_PORT"
        echo ""
        
        # Step 6: Setup SSL (if not skipped)
        if [ "$SKIP_SSL" != "true" ]; then
            setup_ssl
            echo ""
        fi
    fi
    
    # Step 7: Deploy application
    deploy_application "$APP_PORT"
    echo ""
    
    # Final summary
    echo "============================================================"
    echo -e "${GREEN}  Deployment Complete!${NC}"
    echo "============================================================"
    echo ""
    echo "  Application: ${APP_NAME}"
    echo "  Container:   ${CONTAINER_NAME}"
    echo "  Port:        ${APP_PORT}"
    if [ "$SKIP_NGINX" != "true" ]; then
        echo "  Domain:      https://${DOMAIN}"
    fi
    echo ""
    echo "  Useful commands:"
    echo "    View logs:     docker logs -f ${CONTAINER_NAME}"
    echo "    Stop:          docker stop ${CONTAINER_NAME}"
    echo "    Start:         docker start ${CONTAINER_NAME}"
    echo "    Restart:       docker restart ${CONTAINER_NAME}"
    echo ""
    echo "============================================================"
}

# Run main function
main "$@"
