# Deploy — CrowdShip web

The reproducible deploy for `apps/web` (ticket `crowdshipai-platform-m5t.3`). A deploy is a
reviewable, reversible event: the image is built from source and the running site is one
Compute Engine VM defined entirely by [`gcp-vm.sh`](./gcp-vm.sh).

## Target shape — and why

One VM, one persistent disk, one container. The app's persistence is a **single local SQLite
file** under `cwd/.data` (`apps/web/src/server/identity.ts`), written by one process. The deploy
target represents that shape honestly instead of contradicting it — so **not** Cloud Run (ephemeral
disk, autoscaled to many instances would split-brain the DB and wipe it on cold start). The boot
disk holds `/var/lib/crowdship-data`, mounted into the container at `/app/apps/web/.data`, so
signups, menus, and moderation survive a **container** replacement (a reboot or image restart on the
same VM).

> **Durability caveat:** the store lives on the VM's *boot* disk, and `gcp-vm.sh` deletes and
> recreates the VM on each run — so a **redeploy resets the store**. Data survives container
> restarts, not VM recreation. Moving `/var/lib/crowdship-data` onto a **separate persistent disk**
> that outlives the VM is the durability follow-on (with `m5t.6`); acceptable for now only because
> the coin economy is a fake and there are no real users yet.

> Coins are still the in-memory stand-in (`apps/web/src/server/market.ts`) — no real money moves.
> Wiring TigerBeetle + Stripe is the real-money follow-on (`payments-rky.*`), tracked separately.

## Steps

The image is built by Cloud Build into Artifact Registry, then the VM pulls it at boot:

```bash
PROJECT=vertical-augury-494703-p6 REGION=us-central1
# 1. Build the image from source (linux/amd64) into Artifact Registry
gcloud builds submit --tag $REGION-docker.pkg.dev/$PROJECT/crowdship/web:v2 \
  --project=$PROJECT --region=$REGION

# 2a. FIRST deploy only — generate the signing key ONCE and store it, then deploy:
AUTH_SECRET=$(openssl rand -hex 32)
echo "AUTH_SECRET=$AUTH_SECRET" >> ../apps/web/.env.local   # persist it (never committed)
set -a; . ../apps/web/.env.local; set +a                    # AUTH_SECRET + LIVEKIT_*
./deploy/gcp-vm.sh

# 2b. EVERY LATER deploy — REUSE the stored key (regenerating it logs every user out):
set -a; . ../apps/web/.env.local; set +a                    # AUTH_SECRET + LIVEKIT_*
./deploy/gcp-vm.sh
```

`AUTH_SECRET` must be **stable across deploys** — a fresh value makes every live JWT cookie
unverifiable and force-logs-out all users. Persisting it in a store (Secret Manager) is `m5t.8`.

One-time infrastructure the script assumes already exists (created once, idempotently):
- Artifact Registry repo `crowdship` (docker) in the region
- Static external IP `crowdship-web-ip`
- Firewall rule `crowdship-web-allow-http` (tcp:80,443 → tag `crowdship-web`)
- Service account `breadly@<project>.iam.gserviceaccount.com` (the VM's identity; needs at least
  **Artifact Registry Reader** to pull the image and **Logs Writer**) — the script pins the VM to it

## Runtime env (contract)

| Var | Required | Why |
|-----|----------|-----|
| `AUTH_SECRET` | yes | 32+ char session-cookie signing key; the server refuses to boot without it in production. |
| `AUTH_URL` | yes | Defines the app's one canonical host. `auth.ts` runs with `trustHost: true` (self-hosted Auth.js v5 requires it), and the edge middleware refuses any request whose `Host` isn't `AUTH_URL`'s host — so `AUTH_URL` both pins the redirect/cookie origin and defines the host the middleware allows. The script derives it from the static IP. A validating ingress (TLS + reverse proxy) is the tracked hardening follow-on. |
| `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | for streaming | Real video ingest/playback. Omit and `stream.ts` falls back to the in-memory broker (no real stream). |

## Rollback

```bash
gcloud compute instances delete crowdship-web --zone=us-central1-a --project=vertical-augury-494703-p6
```

## Known gaps (tracked)

- **Secrets go in via instance metadata**, readable by project members. Harden into Secret Manager
  → `crowdshipai-platform-m5t.8`.
- **HTTP only** (raw IP, no TLS). A domain + managed cert / load balancer is the next step.
- **No CI/CD trigger** — build+deploy are run by hand → `crowdshipai-platform-m5t.4`.
- **Single instance, no horizontal scale** — a deliberate consequence of the single-writer SQLite
  shape; the 10k-concurrent posture is `crowdshipai-platform-m5t.7`.
