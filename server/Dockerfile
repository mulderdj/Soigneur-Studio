# Soigneur Studio account server: Node built-ins only (http, sqlite, crypto).
# node:sqlite needs Node 22.13 or newer.
FROM node:22-slim
WORKDIR /app
COPY app.js connections.js index.js ./
RUN mkdir -p /data && chown node:node /data
USER node
ENV PORT=3000 DATA_DIR=/data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--no-warnings", "index.js"]
