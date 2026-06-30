#!/bin/bash

# Winner App Deployment Script
# This script syncs files to the server and rebuilds the Docker container

# Configuration
SERVER="tickets.revival.com"
REMOTE_PATH="/srv/win/"
LOCAL_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/"
REMOTE_USER="root"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Starting Winner App Deployment${NC}"
echo "================================"

# Step 1: Rsync files to server
echo -e "${YELLOW}📁 Syncing files to server...${NC}"
rsync -avz --exclude 'node_modules' \
    --exclude '.git' \
    --exclude 'data/' \
    --exclude '.DS_Store' \
    --exclude '*.log' \
    --exclude 'dist/' \
    --exclude '.env' \
    "${LOCAL_PATH}" "${REMOTE_USER}@${SERVER}:${REMOTE_PATH}"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Files synced successfully${NC}"
else
    echo -e "${RED}❌ File sync failed${NC}"
    exit 1
fi

# Step 2: SSH to server and rebuild Docker
echo -e "${YELLOW}🐳 Rebuilding Docker container on server...${NC}"
ssh ${REMOTE_USER}@${SERVER} << 'ENDSSH'
cd /srv/win/
echo "Current directory: $(pwd)"

# Stop and remove existing container
echo "Stopping existing container..."
docker-compose down

# Rebuild the container
echo "Building new container..."
docker-compose up -d --build

# Wait for container to be ready
echo "Waiting for container to start..."
sleep 5

# Check if container is running
if docker ps | grep -q "winner-app"; then
    echo "✅ Container is running"
    docker ps | grep "winner-app"
else
    echo "❌ Container failed to start"
    docker logs winner-app 2>&1 | tail -20
    exit 1
fi

# Show container logs (last 10 lines)
echo ""
echo "Recent container logs:"
docker logs winner-app 2>&1 | tail -10
ENDSSH

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✅ Deployment completed successfully!${NC}"
    echo -e "Access the app at: ${GREEN}https://tickets.revival.com/win${NC}"
else
    echo -e "${RED}❌ Docker rebuild failed${NC}"
    exit 1
fi

echo "================================"
echo -e "${GREEN}🎉 Deployment finished${NC}"