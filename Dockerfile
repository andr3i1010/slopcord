# Alpine: Debian's ffmpeg pulls 234 packages, which takes 10+ minutes in Orchard's builder, and it builds without cache.
FROM node:22-alpine AS base
# ffmpeg: GIF/video frames for vision. bash, git, curl, python3, openssl: the model's shell tools (and restoring backups).
RUN apk add --no-cache ffmpeg bash git curl python3 openssl
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --omit=dev

# The dashboard. It takes hono from the bot's node_modules above, so the client and the server share one copy.
FROM base AS web
COPY web/package.json web/package-lock.json web/
RUN cd web && npm ci --ignore-scripts
COPY web web
RUN cd web && npm run build

FROM base
COPY . .
COPY --from=web /app/web/dist web/dist
# MCP servers in pi/mcp.json (playwright-mcp) are started by bin name; npm start adds this locally.
ENV PATH=/app/node_modules/.bin:$PATH
# Notes, sessions and timers live on a volume mounted here.
ENV DATA_DIR=/data
# The dashboard on port 8080, reachable from outside the container (Orchard's protection is in front).
ENV DASHBOARD_HOST=0.0.0.0
# HOLD=1 keeps the container up without starting the bot, e.g. to restore /data from a backup through the shell.
CMD ["sh", "-c", "if [ -n \"$HOLD\" ]; then exec sleep infinity; fi; exec node src/index.ts"]
