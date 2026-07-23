# hahaplan — one Node process serving the API, the WebSocket, and the built
# web app. node:sqlite is built in, so there's no native module to compile.
FROM node:24-slim
WORKDIR /app

# Install all deps: the image builds the web app (needs Vite) and runs the
# server through tsx (`npm start`), both dev dependencies.
COPY package*.json ./
RUN npm ci

# Build the SPA into web/dist, which the server serves statically in prod.
COPY . .
RUN npm run build

# Show data (the SQLite file) defaults to an ephemeral in-image dir, so it
# works on hosts without a persistent volume (e.g. Koyeb's free tier) — shows
# are lost on redeploy, which is fine for this app. For persistence on a paid
# host, mount a disk at /app/data and shows survive redeploys.
ENV PORT=8787
ENV DATA_DIR=/app/data
EXPOSE 8787

CMD ["npm", "start"]
