#!/bin/bash
# Fail fast: a failed chown used to be ignored, so the permission fix silently never happened (audit 2026-07-19).
set -euo pipefail

# The data directory sits next to this script, wherever the repo is checked out. It was hardcoded to
# /srv/dev/winner/data/, a path that matched no deploy root (deploy.sh uses /srv/win/) and no longer exists.
DATA_DIR="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/data"

echo "=== Docker Rebuild Script for Winner App ==="
echo ""
echo "This script will:"
echo "1. Stop the current Docker container"
echo "2. Fix data directory permissions"
echo "3. Rebuild Docker image without cache"
echo "4. Start the new container"
echo ""
echo "Please run this script with sudo:"
echo "sudo bash rebuild-docker.sh"
echo ""

if [ "$EUID" -ne 0 ]; then 
    echo "ERROR: Please run as root (use sudo)"
    exit 1
fi

if [ ! -d "$DATA_DIR" ]; then
    echo "ERROR: data directory not found: $DATA_DIR" >&2
    exit 1
fi

# Stop existing container
echo "Stopping existing container..."
docker-compose down

# Fix permissions - Set to UID 1001 (nodejs user in container)
echo "Fixing data directory permissions..."
chown -R 1001:1001 "$DATA_DIR"
chmod -R 755 "$DATA_DIR"

# Show current permissions
echo "Current permissions:"
ls -la "$DATA_DIR"

# Remove old image
echo "Removing old Docker image..."
docker rmi winner-app:latest || true

# Rebuild without cache
echo "Rebuilding Docker image without cache..."
docker-compose build --no-cache

# Start new container
echo "Starting new container..."
docker-compose up -d

# Show container status
echo "Container status:"
docker-compose ps

# Show logs
echo ""
echo "Recent logs:"
docker-compose logs --tail=20

echo ""
echo "=== Rebuild complete! ==="
echo ""
echo "To check if the app is working:"
echo "1. Try accessing http://localhost:3001/api/health"
echo "2. Check logs with: docker-compose logs -f"
echo "3. Try adding a new list and check if it's saved to $DATA_DIR/lists.json"