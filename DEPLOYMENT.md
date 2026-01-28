# Huawei OLT Manager - Deployment Guide

## Quick Start (Docker Compose)

### Prerequisites
- Docker and Docker Compose installed
- Domain name pointing to your server (optional, for SSL)

### 1. Clone and Configure

```bash
# Copy environment file
cp .env.example .env

# Edit configuration
nano .env
```

Update these values in `.env`:
```
DATABASE_URL=postgresql://postgres:oltmanager2024@db:5432/oltmanager
POSTGRES_PASSWORD=oltmanager2024
SESSION_SECRET=your-secret-key-here  # Generate with: openssl rand -hex 32
```

### 2. Deploy with Docker Compose

```bash
# Build and start
docker-compose up -d

# Check logs
docker-compose logs -f
```

The app will be available at `http://your-server:5000`

### 3. Initialize Database

The database will be created automatically on first run.

---

## Production Deployment (with Nginx + SSL)

### Using the Deploy Script

```bash
# Make executable
chmod +x deploy.sh

# Deploy with domain and SSL
./deploy.sh --domain olt.yourdomain.com --email admin@yourdomain.com

# Deploy without SSL (for testing)
./deploy.sh --domain olt.yourdomain.com --skip-ssl
```

### Script Options

| Option | Description |
|--------|-------------|
| `--domain DOMAIN` | Your domain name |
| `--email EMAIL` | Email for Let's Encrypt SSL |
| `--port PORT` | Base port to search from (default: 3000) |
| `--skip-ssl` | Skip SSL configuration |
| `--skip-nginx` | Skip Nginx setup |

---

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `SESSION_SECRET` | Session encryption key (32+ chars) | Yes |
| `POSTGRES_PASSWORD` | PostgreSQL password (docker-compose) | Yes |

---

## Default Login

After deployment, login with:
- **Username:** `adhielesmana`
- **Password:** `admin123!`

**Important:** Change this password after first login!

---

## Management Commands

```bash
# View logs
docker logs -f huawei-olt-manager

# Restart application
docker restart huawei-olt-manager

# Stop application
docker stop huawei-olt-manager

# Start application
docker start huawei-olt-manager

# Rebuild after code changes
docker-compose up -d --build
```

---

## Database Backup

```bash
# Manual backup
docker exec huawei-olt-db pg_dump -U postgres oltmanager > backup.sql

# Restore from backup
cat backup.sql | docker exec -i huawei-olt-db psql -U postgres oltmanager
```

---

## Troubleshooting

### Container won't start
```bash
docker logs huawei-olt-manager
```

### Database connection issues
```bash
# Check if database is running
docker ps | grep huawei-olt-db

# Test connection
docker exec huawei-olt-db psql -U postgres -c "SELECT 1"
```

### Port already in use
The deploy script automatically finds an available port. For docker-compose:
```bash
# Change port in docker-compose.yml
ports:
  - "8080:5000"  # Use port 8080 instead
```

---

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Nginx     │────▶│   App       │────▶│  PostgreSQL │
│  (SSL/80)   │     │  (5000)     │     │  (5432)     │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │  Huawei OLT │
                    │  (SSH/22)   │
                    └─────────────┘
```
