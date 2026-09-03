#!/bin/bash
set -euo pipefail

# Winner App Deployment Script
# Syncs the source tree to the server and rebuilds the container from it.
#
# The target moved to rmi-services (GCP, us-east1-b) on 2026-09-02. What that
# changed, and why this script no longer looks like it used to:
#
#   * SSH goes through the host's IAP tunnel alias, not win.revival.com. Port 22
#     on the public address is firewalled; `ssh rmi-services` is defined in
#     ~/.ssh/config with a `gcloud compute start-iap-tunnel` ProxyCommand.
#     Override with WINNER_APP_SSH_HOST if your alias differs.
#   * The project lives in /srv/winner-app, not /srv/win.
#   * The live stack is described by compose.yml, which is NOT in this repo — it
#     is host-specific (Traefik labels, no published port, resource limits). The
#     repo's own docker-compose.yml is the Elestio/nginx pattern and must not be
#     the file that gets applied here, so the compose file is named explicitly.
#   * The remote user is not root; docker and the env file need sudo.
#
# PREFLIGHT is the important part. The server refuses to start without its auth
# configuration, and rsync deliberately never carries .env — so a variable added
# to the app but not to /srv/winner-app/.env would build fine, then crash-loop
# under `restart: unless-stopped`. The check below runs BEFORE anything is
# rebuilt, so that failure mode costs an error message instead of an outage.

# Configuration
SERVER="${WINNER_APP_SSH_HOST:-rmi-services}"
REMOTE_PATH="/srv/winner-app"
COMPOSE_FILE="${REMOTE_PATH}/compose.yml"
LOCAL_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/"

# Environment variables the server validates at startup (backend/auth-config.ts).
# Keep this list in step with loadAuthConfig() — a variable that is required there
# and missing here turns a caught deploy error back into a crash loop.
REQUIRED_VARS="ADMIN_USERNAME ADMIN_PASSWORD GOOGLE_CLIENT_ID GOOGLE_HOSTED_DOMAIN"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Starting Winner App Deployment${NC}"
echo "================================"
echo "Target: ${SERVER}:${REMOTE_PATH}"

# ---------------------------------------------------------------------------
# Step 0: Preflight — never rebuild into a configuration that cannot boot
# ---------------------------------------------------------------------------
echo -e "${YELLOW}🔍 Preflight checks...${NC}"

if ! ssh -o BatchMode=yes -o ConnectTimeout=60 "${SERVER}" true 2>/dev/null; then
    echo -e "${RED}❌ Cannot reach ${SERVER} over SSH${NC}"
    echo "   The public win.revival.com:22 is firewalled — this needs the IAP tunnel alias."
    echo "   Check that 'ssh ${SERVER}' works and that gcloud is authenticated."
    exit 1
fi

# Everything else runs in one remote shell: each SSH round-trip re-establishes
# the IAP tunnel, which is slow.
if ! ssh -o BatchMode=yes "${SERVER}" "
    set -e
    if [ ! -f '${COMPOSE_FILE}' ]; then
        echo 'MISSING_COMPOSE'
        exit 1
    fi
    if ! sudo -n test -f '${REMOTE_PATH}/.env'; then
        echo 'MISSING_ENV'
        exit 1
    fi
    missing=''
    for var in ${REQUIRED_VARS}; do
        # Present AND non-empty: an empty value fails the app's startup validation
        # exactly as an absent one does.
        if ! sudo -n grep -qE \"^\${var}=.+\" '${REMOTE_PATH}/.env'; then
            missing=\"\${missing} \${var}\"
        fi
    done
    if [ -n \"\${missing}\" ]; then
        echo \"MISSING_VARS:\${missing}\"
        exit 1
    fi
    echo 'PREFLIGHT_OK'
" 2>/dev/null | grep -q PREFLIGHT_OK; then
    echo -e "${RED}❌ Preflight failed — nothing was deployed${NC}"
    echo "   Re-run the check by hand to see which item failed:"
    echo "     ssh ${SERVER} \"sudo grep -oE '^[A-Z_]+=' ${REMOTE_PATH}/.env\""
    echo "   Required (present and non-empty): ${REQUIRED_VARS}"
    echo "   See .env.example for what each one is."
    exit 1
fi
echo -e "${GREEN}✅ Preflight passed — compose file and all required env vars present${NC}"

# ---------------------------------------------------------------------------
# Step 1: Sync files to the server
# ---------------------------------------------------------------------------
echo -e "${YELLOW}📁 Syncing files to server...${NC}"

# No --delete: compose.yml and .env live only on the server and must survive.
rsync -avz --exclude 'node_modules' \
    --exclude '.git' \
    --exclude 'data/' \
    --exclude '.DS_Store' \
    --exclude '*.log' \
    --exclude 'dist/' \
    --exclude '.env' \
    "${LOCAL_PATH}" "${SERVER}:${REMOTE_PATH}/"

echo -e "${GREEN}✅ Files synced successfully${NC}"

# ---------------------------------------------------------------------------
# Step 2: Rebuild and swap the container
# ---------------------------------------------------------------------------
echo -e "${YELLOW}🐳 Rebuilding container on server...${NC}"

ssh -o BatchMode=yes "${SERVER}" "
set -e
cd '${REMOTE_PATH}'

# Tag the image currently in service before it is replaced. \`up --build\` reuses
# the same tag, so without this the previous image is left dangling and rolling
# back means hunting for an image ID.
ROLLBACK_TAG=\"winner-app:rollback-\$(date +%Y%m%d-%H%M%S)\"
if sudo -n docker image inspect winner-app:1.0.0 >/dev/null 2>&1; then
    sudo -n docker tag winner-app:1.0.0 \"\${ROLLBACK_TAG}\"
    echo \"Previous image tagged \${ROLLBACK_TAG}\"
fi

# The old container keeps serving during the build, so a failed build leaves
# production untouched instead of taking it down.
sudo -n docker compose --project-directory '${REMOTE_PATH}' -f '${COMPOSE_FILE}' up -d --build

echo 'Waiting for the container to become healthy...'
for i in \$(seq 1 30); do
    status=\$(sudo -n docker compose --project-directory '${REMOTE_PATH}' -f '${COMPOSE_FILE}' ps --format '{{.State}} {{.Status}}' 2>/dev/null | head -1)
    case \"\${status}\" in
        *healthy*)   echo \"✅ Container healthy: \${status}\"; exit 0 ;;
        *Restarting*|*Exited*)
            echo \"❌ Container is not staying up: \${status}\"
            sudo -n docker compose --project-directory '${REMOTE_PATH}' -f '${COMPOSE_FILE}' logs --tail 40
            echo \"Roll back with: sudo docker tag \${ROLLBACK_TAG} winner-app:1.0.0 && sudo docker compose --project-directory ${REMOTE_PATH} -f ${COMPOSE_FILE} up -d\"
            exit 1 ;;
    esac
    sleep 2
done

echo '❌ Container did not report healthy within 60s'
sudo -n docker compose --project-directory '${REMOTE_PATH}' -f '${COMPOSE_FILE}' logs --tail 40
exit 1
"

echo -e "${GREEN}✅ Container is running${NC}"

# ---------------------------------------------------------------------------
# Step 3: Verify the deployed app actually answers
# ---------------------------------------------------------------------------
echo -e "${YELLOW}🌐 Verifying https://win.revival.com ...${NC}"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 https://win.revival.com/login || echo 000)
if [ "${code}" = "200" ]; then
    echo -e "${GREEN}✅ Login page responded 200${NC}"
else
    echo -e "${RED}⚠️  Login page returned ${code} — check Traefik and the container logs${NC}"
    exit 1
fi

echo "================================"
echo -e "${GREEN}🎉 Deployment finished${NC}"
echo -e "Access the app at: ${GREEN}https://win.revival.com${NC}"
