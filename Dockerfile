# CrowdShip web — the reproducible runtime artifact (crowdshipai-platform-m5t.3).
#
# One image, built from source in a linux builder so the traced dependencies — including
# the tigerbeetle-node native addon — are the target platform's own, never a host's
# [LAW:effects-at-boundaries — the native edge is resolved where it will run]. The runtime
# stage carries only Next's standalone output: server.js plus the exact node_modules the
# app traced, and nothing of the build toolchain [LAW:decomposition — the shipped part is
# just what runs].

# ---- builder: install the workspace and produce the standalone server ----
FROM node:24-bookworm-slim AS builder
WORKDIR /repo

# pnpm is pinned to the version the lockfile was written with, so a build here resolves
# the SAME dependency graph as a developer's machine [LAW:one-source-of-truth].
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

# The whole monorepo is the build input: the @crowdship/* workspace packages ship raw
# TypeScript that Next transpiles in-place, so there is no prebuilt artifact to copy —
# the source IS the dependency [LAW:one-source-of-truth]. .dockerignore keeps this to
# source only (no node_modules/.next/.data).
COPY . .

# --frozen-lockfile makes a drifted lockfile a loud build failure, never a silently
# different graph [LAW:no-silent-failure].
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @crowdship/web build

# ---- runner: the standalone server and its static assets, nothing else ----
FROM node:24-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
# Next standalone binds to HOSTNAME:PORT; a container must listen on all interfaces or the
# port publish reaches nothing [LAW:no-silent-failure — a wrong bind is a silent 000].
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# The standalone root carries server.js, the traced node_modules, and the workspace
# packages under apps/web/. Static assets are emitted outside standalone by design and
# are copied in beside server.js.
COPY --from=builder /repo/apps/web/.next/standalone ./
COPY --from=builder /repo/apps/web/.next/static ./apps/web/.next/static

# The app writes its SQLite stores under cwd/.data. Rather than depend on server.js chdiring
# into apps/web (an ambient assumption that a future Next could drop, silently sending data to
# an unmounted path), cwd is pinned to apps/web via WORKDIR — so cwd/.data is deterministically
# /app/apps/web/.data [LAW:no-ambient-temporal-coupling]. Declared a volume so a host disk mounts
# over it and signups, menus, and moderation survive a container replacement [LAW:one-source-of-truth].
RUN mkdir -p /app/apps/web/.data
VOLUME /app/apps/web/.data

WORKDIR /app/apps/web
EXPOSE 3000
# cwd is /app/apps/web, so the data dir is fixed regardless of server.js's own chdir.
CMD ["node", "server.js"]
