# imagen del sitio + API
FROM node:22-slim

# better-sqlite3 necesita compilar si no encuentra un binario precompilado.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Primero solo los manifiestos, para que la capa de dependencias
# se reutilice mientras no cambien las versiones.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

# El contenido se guarda en un volumen, no en la imagen.
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/data/multimedios.sqlite

VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=4s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--env-file-if-exists=.env", "server/index.js"]
