# The final image keeps Ollama's supported runtime libraries together.
FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM ollama/ollama:0.32.14
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 libstdc++6 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=dependencies /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY server.js ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
ENV NODE_ENV=production \
    VERITAS_DEPLOYMENT=render \
    VERITAS_MODEL=llama3.2:latest \
    VERITAS_TIMEOUT=300 \
    VERITAS_DETECTOR_CACHE=/var/data/detector \
    OLLAMA_MODELS=/var/data/ollama \
    OLLAMA_HOST=127.0.0.1:11434 \
    OLLAMA_NO_CLOUD=1 \
    OLLAMA_NUM_PARALLEL=1 \
    OLLAMA_MAX_LOADED_MODELS=1 \
    OLLAMA_VULKAN=0 \
    PORT=10000
EXPOSE 10000
ENTRYPOINT []
CMD ["node", "scripts/start-render.js"]
