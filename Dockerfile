FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev for build)
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
COPY drizzle.config.ts ./

# Install production dependencies + drizzle-kit for migrations
RUN npm ci --omit=dev && npm install drizzle-kit

# Copy built application
COPY --from=builder /app/dist ./dist

# Copy shared schema for migrations
COPY --from=builder /app/shared ./shared

# Copy assets (Huawei logo, etc.)
COPY --from=builder /app/client/src/assets ./client/src/assets

# Copy startup script
COPY start.sh ./
RUN chmod +x start.sh

# Create data directory
RUN mkdir -p /app/data

# Expose port
EXPOSE 5000

# Set environment
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/api/health || exit 1

# Start with migration script
CMD ["./start.sh"]
