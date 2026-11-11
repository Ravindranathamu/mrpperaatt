FROM node:24-bookworm-slim AS deps

WORKDIR /app
COPY package.json package-lock.json ./
# better-sqlite3 includes prebuilt Linux binaries, so no compiler is needed.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY server.js ./
COPY src ./src
COPY public ./public

EXPOSE 3000
CMD ["node", "server.js"]
