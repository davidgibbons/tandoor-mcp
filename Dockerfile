# syntax=docker/dockerfile:1

# Pinned by digest, not by tag: a silent upstream re-tag must not change the
# glibc a prebuilt native addon (better-sqlite3) was compiled against without
# a diff to review. Update this digest deliberately, via Dependabot's docker
# ecosystem watch (see .github/dependabot.yml).
FROM node:24-trixie-slim@sha256:6950b66b4c0cb0151ce89fa75074673850763d096b044f422c6729b588dd4956 AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-trixie-slim@sha256:6950b66b4c0cb0151ce89fa75074673850763d096b044f422c6729b588dd4956 AS runtime
WORKDIR /app

ARG TANDOOR_MCP_VERSION=0.0.0-dev

LABEL io.modelcontextprotocol.server.name="io.github.davidgibbons/tandoor-mcp"

RUN apt-get update && apt-get install -y --no-install-recommends gosu wget \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# The design spec defaults BIND_ADDR to 127.0.0.1:6061 for a bare
# `node dist/src/index.js` run, but the container overrides that default to
# 0.0.0.0:6061 here, because a process bound to its own loopback inside a
# container is unreachable from the host even with `-p 6061:6061` published
# — the container's loopback is not the host's. This is not a security
# regression: reachability from outside the container still depends entirely
# on whether the operator publishes the port, which
# docker-compose.example.yml makes an explicit, visible choice rather than a
# hidden default.
ENV NODE_ENV=production \
    TANDOOR_MCP_CONFIG_DIR=/config \
    BIND_ADDR=0.0.0.0:6061 \
    TANDOOR_MCP_VERSION=$TANDOOR_MCP_VERSION \
    PUID=1000 \
    PGID=1000

VOLUME ["/config"]
EXPOSE 6061

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- "http://localhost:${BIND_ADDR##*:}/healthz" || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/src/index.js"]
