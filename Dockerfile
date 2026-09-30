FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json server.js ./
COPY src ./src
COPY public ./public
COPY test ./test

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/healthz" || exit 1

CMD ["node", "server.js"]
