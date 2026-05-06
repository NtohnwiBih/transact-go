# ─── Stage 1: Dependencies ────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && \
    cp -R node_modules /tmp/prod_modules && \
    npm ci

# ─── Stage 2: Development ─────────────────────────────────────────────────────
# This stage is used by docker-compose for local dev (hot-reload via ts-node).
# It does NOT pre-build — NestJS watch mode compiles on the fly.
FROM node:20-alpine AS development
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# No RUN npm run build here — the watch command handles compilation
CMD ["npm", "run", "start:dev"]

# ─── Stage 3: Builder (used by production stage below) ────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ─── Stage 4: Production ──────────────────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 nestjs

COPY --from=builder --chown=nestjs:nodejs /app/dist         ./dist
COPY --from=deps    --chown=nestjs:nodejs /tmp/prod_modules ./node_modules
COPY --chown=nestjs:nodejs package.json ./

RUN mkdir -p /app/logs && chown nestjs:nodejs /app/logs

USER nestjs

EXPOSE 3004

HEALTHCHECK --interval=30s --timeout=10s --start-period=45s --retries=3 \
  CMD wget -qO- http://localhost:3004/api/v1/health/live || exit 1

CMD ["node", "dist/main"]