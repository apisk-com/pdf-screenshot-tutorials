FROM node:22-bookworm-slim

WORKDIR /app
# Keep Chrome in the image, in a folder that the "node" user can read.
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer
# The service uses Chrome in headless mode, so skip the second browser build.
ENV PUPPETEER_CHROME_HEADLESS_SHELL_SKIP_DOWNLOAD=true

COPY package.json package-lock.json ./
# Puppeteer needs unzip to unpack Chrome. npm ci downloads Chrome.
# --install-deps then adds the Linux libraries that Chrome needs.
RUN apt-get update \
  && apt-get install -y --no-install-recommends unzip fonts-liberation fonts-noto-color-emoji \
  && npm ci --omit=dev \
  && npx puppeteer browsers install chrome --install-deps \
  && rm -rf /var/lib/apt/lists/* /root/.npm

COPY src ./src
COPY templates ./templates

# Do not run Chrome as root.
USER node
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["node", "src/server.js"]
