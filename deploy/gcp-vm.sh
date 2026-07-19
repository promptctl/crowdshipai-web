#!/usr/bin/env bash
# CrowdShip web — reproducible deploy to a single Compute Engine VM (crowdshipai-platform-m5t.3).
#
# ONE box, ONE writer, ONE persistent disk — the deploy target chosen to represent the app's
# actual persistence shape (a single local SQLite file under cwd/.data), not to contradict it
# [FRAMING:representation]. A container VM on Container-Optimized OS runs the image published to
# Artifact Registry; the boot disk holds /var/lib/crowdship-data across container replacements.
#
# A deploy is a reviewable, reversible event: this script is the whole definition, and
# `gcloud compute instances delete crowdship-web` is the whole rollback [LAW:no-ambient-temporal-coupling].
#
# Secrets are NOT in this file. They are read from the environment at run time, so the committed
# artifact carries no credential [LAW:effects-at-boundaries]. Hardening these into Secret Manager
# instead of instance metadata is crowdshipai-platform-m5t.8.
#
# Required env:
#   AUTH_SECRET          32+ char secret for the session-cookie signing key
#   LIVEKIT_URL          wss URL of the LiveKit SFU (streaming; omit to run with the in-memory fake)
#   LIVEKIT_API_KEY      LiveKit API key
#   LIVEKIT_API_SECRET   LiveKit API secret
# Optional env (defaults shown):
#   PROJECT=vertical-augury-494703-p6  REGION=us-central1  ZONE=us-central1-a
#   IMAGE=us-central1-docker.pkg.dev/$PROJECT/crowdship/web:v1
#   MACHINE_TYPE=e2-small  INSTANCE=crowdship-web
set -euo pipefail

PROJECT="${PROJECT:-vertical-augury-494703-p6}"
REGION="${REGION:-us-central1}"
ZONE="${ZONE:-us-central1-a}"
INSTANCE="${INSTANCE:-crowdship-web}"
MACHINE_TYPE="${MACHINE_TYPE:-e2-small}"
IMAGE="${IMAGE:-${REGION}-docker.pkg.dev/${PROJECT}/crowdship/web:v2}"

: "${AUTH_SECRET:?set AUTH_SECRET (openssl rand -hex 32)}"

# The static IP is the app's public identity: it must be known before boot because the
# production auth config pins AUTH_URL to it (a poisoned Host header cannot then re-scope the
# session cookie) [LAW:no-silent-failure]. auth.ts sets trustHost=false in production for exactly
# this reason, so AUTH_URL is mandatory, not optional.
IP="$(gcloud compute addresses describe crowdship-web-ip --region="$REGION" --project="$PROJECT" --format='value(address)')"
AUTH_URL="http://${IP}"

# The startup script runs as root on the VM: authenticate docker to Artifact Registry with the
# VM's own service-account credentials, then run the one container with the data volume mounted
# and every env value the runtime needs. --restart always makes a crash or reboot self-heal.
STARTUP="$(mktemp)"
trap 'rm -f "$STARTUP"' EXIT
cat > "$STARTUP" <<EOF
#!/bin/bash
set -euo pipefail
# COS mounts / (and \$HOME=/root) read-only for integrity; point docker's credential config at
# the writable partition or configure-docker aborts the whole boot [LAW:no-silent-failure].
export HOME=/var/lib/crowdship-home
mkdir -p "\$HOME"
docker-credential-gcr configure-docker --registries=${REGION}-docker.pkg.dev
mkdir -p /var/lib/crowdship-data
docker pull ${IMAGE}
docker rm -f crowdship-web 2>/dev/null || true
docker run -d --name crowdship-web --restart always \\
  -p 80:3000 \\
  -v /var/lib/crowdship-data:/app/apps/web/.data \\
  -e AUTH_SECRET='${AUTH_SECRET}' \\
  -e AUTH_URL='${AUTH_URL}' \\
  -e LIVEKIT_URL='${LIVEKIT_URL:-}' \\
  -e LIVEKIT_API_KEY='${LIVEKIT_API_KEY:-}' \\
  -e LIVEKIT_API_SECRET='${LIVEKIT_API_SECRET:-}' \\
  ${IMAGE}
EOF

# Recreate cleanly so a redeploy is deterministic, never a half-updated instance.
gcloud compute instances delete "$INSTANCE" --zone="$ZONE" --project="$PROJECT" --quiet 2>/dev/null || true
gcloud compute instances create "$INSTANCE" \
  --project="$PROJECT" --zone="$ZONE" --machine-type="$MACHINE_TYPE" \
  --image-family=cos-stable --image-project=cos-cloud \
  --boot-disk-size=20GB \
  --address="$IP" --tags=crowdship-web \
  --service-account="breadly@${PROJECT}.iam.gserviceaccount.com" --scopes=cloud-platform \
  --metadata-from-file=startup-script="$STARTUP"

echo "Deployed. Live at: ${AUTH_URL}  (allow ~60-90s for first-boot image pull)"
