#!/bin/bash

set -euo pipefail

# ================= CONFIG =================
LOG_FILE="/volume1/web/hooks/deploy-github-jobs-crawler.log"

NAS_USER="vvadmin"
NAS_HOST="127.0.0.1"
SSH_KEY="/var/services/web/.ssh/id_rsa"

DOCKER="/usr/local/bin/docker"

# image GHCR — application Sophia Jobs Crawler (Node)
IMAGE="ghcr.io/flake9025/jobs-crawler"
TAG="latest"

CONTAINER="sophia-jobs"
APP_PORT="8080"      # port interne du conteneur
HOST_PORT="8082"     # port exposé sur le NAS (adapter si déjà pris)

# Répertoires persistants sur le NAS
APP_DIR="/volume1/docker/apps/$CONTAINER"
DATA_DIR="$APP_DIR/data"        # cache des offres d'entreprises (survit aux redéploiements)
ENV_FILE="$APP_DIR/.env"        # secrets France Travail (à créer manuellement sur le NAS)

# ================= LOG =================
log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE" || true
}

REMOTE_COMMANDS=$(
  cat <<EOF
set -e

echo "=========================================="
echo "Deploying $CONTAINER"
echo "Image: $IMAGE:$TAG"
echo "Port : $HOST_PORT -> $APP_PORT"

# Prépare les répertoires persistants.
mkdir -p "$DATA_DIR"

# Vérifie la présence du fichier d'environnement (clés France Travail).
if [ ! -f "$ENV_FILE" ]; then
  echo "ATTENTION: $ENV_FILE introuvable — l'application démarrera sans API France Travail."
  echo "Créez ce fichier avec :"
  echo "  FRANCE_TRAVAIL_CLIENT_ID=..."
  echo "  FRANCE_TRAVAIL_CLIENT_SECRET=..."
fi

echo "Pull image"
$DOCKER pull $IMAGE:$TAG

echo "Stop & remove ancien conteneur"
$DOCKER stop "$CONTAINER" || true
$DOCKER rm   "$CONTAINER" || true

# Construit l'argument --env-file seulement si le fichier existe.
ENV_ARG=""
if [ -f "$ENV_FILE" ]; then
  ENV_ARG="--env-file $ENV_FILE"
fi

$DOCKER run -d \
  --name "$CONTAINER" \
  -p "$HOST_PORT:$APP_PORT" \
  -e PORT=$APP_PORT \
  -e CACHE_FILE=/app/data/companies-cache.json \
  \$ENV_ARG \
  -v "$DATA_DIR:/app/data" \
  --restart unless-stopped \
  $IMAGE:$TAG

echo "Deploy OK for $CONTAINER"

# Nettoyage des images GHCR obsolètes (garde de l'espace disque sur le NAS).
$DOCKER image prune -f || true

echo "Single-instance deploy OK"
EOF
)

log "=========================================="
log "START DEPLOY"
log "Deploy via SSH ($NAS_USER@$NAS_HOST)"

ssh -i "$SSH_KEY" \
  -o StrictHostKeyChecking=no \
  "$NAS_USER@$NAS_HOST" \
  "$REMOTE_COMMANDS" >> "$LOG_FILE" 2>&1

log "END DEPLOY"
log "=========================================="
