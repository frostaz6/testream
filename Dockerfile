FROM node:22-trixie-slim AS builder
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY scripts ./scripts
COPY client ./client
RUN npm run build

FROM node:22-trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && \
    rm -rf /var/lib/apt/lists/* && ffmpeg -version | grep -E '^ffmpeg version [7-9]\.'
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY --from=builder /app/dist ./dist
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 3000
CMD ["node", "server/app.js"]
