# Alpine: Debian's ffmpeg pulls 234 packages, which takes 10+ minutes in Orchard's builder, and it builds without cache.
FROM node:22-alpine
# ffmpeg: GIF/video frames for vision. bash, git, curl, python3, openssl: the model's shell tools (and restoring backups).
RUN apk add --no-cache ffmpeg bash git curl python3 openssl
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --omit=dev
COPY . .
# Notes, sessions and timers live on a volume mounted here.
ENV DATA_DIR=/data
# HOLD=1 keeps the container up without starting the bot, e.g. to restore /data from a backup through the shell.
CMD ["sh", "-c", "if [ -n \"$HOLD\" ]; then exec sleep infinity; fi; exec node src/index.ts"]
