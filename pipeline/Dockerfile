FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY --from=builder /app/dist ./dist
# Static assets for the share page (OG image, store badges). serveStatic
# resolves `root: "./public"` against process.cwd() = /app, so the dir must
# be at the runtime image's working directory.
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "dist/server.js"]
