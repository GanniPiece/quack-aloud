# ---- build: compile the UI (needs dev dependencies) ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY shared ./shared
COPY server ./server
COPY src ./src
RUN npm run build

# ---- runtime: API + built UI in one process ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    API_PORT=8787 \
    DATA_DIR=/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY shared ./shared
COPY server ./server
COPY data/sample-graph.json ./data/sample-graph.json
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]   # projects, trash, and settings.json (API key) live here
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8787/api/health >/dev/null || exit 1
CMD ["npx", "tsx", "server/index.ts"]
