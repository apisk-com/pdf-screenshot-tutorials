# The official Playwright image: Ubuntu 24.04, Node.js, the browsers and
# their system libraries. Keep its version equal to playwright in package.json.
FROM mcr.microsoft.com/playwright:v1.65.0-noble

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src

# Do not run Chromium as root. The image comes with the user pwuser.
USER pwuser
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["node", "src/server.js"]
