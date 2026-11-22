# Auuki Desktop: build the static app, then serve it with Caddy.
#
# The container only serves files. Bluetooth (Web Bluetooth) and ANT+ (Web
# Serial, USB stick) run in the browser on the computer you ride with, so
# the radios/USB stick belong on that computer, not on the Docker host.
# Browsers only allow those APIs on https:// or http://localhost, which is
# why Caddy also serves HTTPS.

# glibc image: Parcel's native modules (swc, lmdb, watcher) install cleanly
FROM node:22-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npx parcel build --no-cache --dist-dir dist

FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
EXPOSE 8080 8443
