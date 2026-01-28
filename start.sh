#!/bin/sh
set -e

echo "============================================"
echo "  Huawei OLT Manager - Starting..."
echo "============================================"

# Wait for database to be ready
echo "[Startup] Waiting for database connection..."
MAX_RETRIES=30
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if node -e "
        const { Pool } = require('pg');
        const pool = new Pool({ connectionString: process.env.DATABASE_URL });
        pool.query('SELECT 1').then(() => { pool.end(); process.exit(0); }).catch(() => process.exit(1));
    " 2>/dev/null; then
        echo "[Startup] Database connected!"
        break
    fi
    RETRY_COUNT=$((RETRY_COUNT + 1))
    echo "[Startup] Waiting for database... ($RETRY_COUNT/$MAX_RETRIES)"
    sleep 2
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo "[Startup] ERROR: Could not connect to database after $MAX_RETRIES attempts"
    exit 1
fi

# Run database migrations
echo "[Startup] Running database migrations..."
npx drizzle-kit push --force || {
    echo "[Startup] WARNING: Migration push failed, trying to continue..."
}

echo "[Startup] Starting application..."
exec node dist/index.cjs
