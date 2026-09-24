FROM node:22-alpine AS build

WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine

LABEL io.hass.version="0.8.0" \
      io.hass.type="addon" \
      io.hass.arch="aarch64|amd64"

# tini as PID 1: reaps zombies and forwards signals properly, which the bare
# node process on its own does not do reliably as container PID 1.
RUN apk add --no-cache tini wget

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY run-app.mjs ./

# Polls the ingress panel, which is already serving on INGRESS_PORT whenever
# the app is healthy -- reuses it rather than standing up a second endpoint.
# Supervisor's own `watchdog:` setting in config.yaml is what actually acts on
# a failing container; this HEALTHCHECK is what makes `docker ps` / `docker
# inspect` agree, and is a safety net if you run this outside Supervisor too.
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${INGRESS_PORT:-8099}/" || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "/app/run-app.mjs"]
