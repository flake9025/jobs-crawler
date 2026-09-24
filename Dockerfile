# --- Image de production pour le NAS ---
FROM node:20-alpine

ARG APP_VERSION=1.0.0
ARG BUILD_SHA=dev
ARG BUILD_DATE

WORKDIR /app

# Dépendances (couche cachée tant que package.json ne change pas)
COPY package.json ./
RUN npm install --omit=dev

# Code source
COPY src ./src
COPY public ./public

# Dossier de persistance du cache (monté en volume sur le NAS)
RUN mkdir -p /app/data

ENV PORT=8080
ENV APP_VERSION=$APP_VERSION
ENV BUILD_SHA=$BUILD_SHA
ENV BUILD_DATE=$BUILD_DATE
EXPOSE 8080

# Healthcheck (utilisé par Docker / le NAS)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1

CMD ["node", "src/server/index.js"]
