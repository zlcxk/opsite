ARG NODE_VERSION=22

# ---------------------------------------------------------------------------
# 1. Runtime dependencies only.
#    better-sqlite3 ships prebuilt N-API binaries for glibc and musl, so this
#    stage needs no compiler toolchain. Ignoring install scripts is safe here
#    and keeps the runtime node_modules minimal and predictable.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS prod-deps
WORKDIR /app

ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# better-sqlite3 ships every platform's prebuilt addon plus the SQLite C sources.
# The Alpine runtime only needs the musl addons; drop the rest and verify the
# remaining binding still loads.
RUN node -e "const fs = require('fs'); const p = require('path'); const root = 'node_modules/better-sqlite3'; for (const file of fs.readdirSync(p.join(root, 'prebuilds'))) { if (!file.startsWith('linuxmusl-')) fs.rmSync(p.join(root, 'prebuilds', file)); } for (const file of ['deps', 'src', 'binding.gyp']) fs.rmSync(p.join(root, file), { recursive: true, force: true }); const Database = require('better-sqlite3'); new Database(':memory:').close();"

# ---------------------------------------------------------------------------
# 2. Build the frontend and compile the server to plain JavaScript.
#    Debian slim keeps the frontend toolchain on glibc for maximum compatibility;
#    none of these dependencies or binaries reach the runtime stage.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app

ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

COPY package.json package-lock.json ./
# No install scripts are required: esbuild / Tailwind oxide / rolldown ship
# their platform binaries as optional dependencies, and better-sqlite3's
# prebuilt addon is unused in this stage.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts --no-audit --no-fund

COPY tsconfig.json tsconfig.server.json vite.config.ts index.html ./
COPY shared ./shared
COPY server ./server
COPY src ./src

RUN npm run build:docker

# ---------------------------------------------------------------------------
# 3. Minimal runtime.
#    Contains only: production node_modules, compiled server JS, static assets
#    and package.json. No TypeScript, Vite, source files or build toolchain.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data \
    CLIENT_DIR=/app/dist/client

LABEL org.opencontainers.image.title="Opsite" \
      org.opencontainers.image.description="个人运维情报工作台"

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist/client ./dist/client
COPY --from=build --chown=node:node /app/dist-server/server ./server
COPY --chown=node:node package.json ./

# SQLite database, WAL files and backups all live on this single volume.
RUN mkdir -p /app/data && chown node:node /app/data

USER node
EXPOSE 8787
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8787) + '/api/health').then((res) => process.exit(res.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server/index.js"]
