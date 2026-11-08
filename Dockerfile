FROM node:22-bookworm-slim
# ffmpeg: GIF/video frames for vision. git, curl, python3: the model's shell tools.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg git curl ca-certificates python3 \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --omit=dev
COPY . .
# Notes, sessions and timers live on a volume mounted here.
ENV DATA_DIR=/data
# HOLD=1 keeps the container up without starting the bot, e.g. to restore /data from a backup through the shell.
CMD ["sh", "-c", "if [ -n \"$HOLD\" ]; then exec sleep infinity; fi; exec node src/index.ts"]
