# Hosted (public-mode) image for sxt-mcp. Build from this package directory:
#   docker build -t sxt-mcp .
# Runtime env (see README "Hosted deployment"):
#   SXT_MCP_PUBLIC_URL     https origin clients connect to, e.g. https://mcp.example.com
#   SXT_MCP_TOKEN_SECRET   >= 32 random chars; seals every issued token
# The platform's PORT is honoured. No SXT or wallet credentials belong in this
# image or its env: every caller brings their own SXT API key.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
COPY docs ./docs
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
ENV NODE_ENV=production \
    PORT=8080 \
    SXT_MCP_BIND_HOST=0.0.0.0 \
    SXT_MCP_LOG_FORMAT=json
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/docs ./docs
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/http.js"]
