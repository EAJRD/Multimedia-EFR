/* ============================================
   Servidor Express: la versión self-hosted (Docker).

   Sirve el sitio público y monta exactamente los mismos
   handlers que usa Vercel, así que el comportamiento de la
   API es idéntico en los dos despliegues.
   ============================================ */

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// El .env lo carga el flag --env-file-if-exists de los scripts de package.json,
// antes de evaluar ningún import. Si se hiciera aquí, en ESM se ejecutaría
// después de que store.js ya haya leído process.env.

import { handler as authHandler } from '../api/auth.js';
import { handler as projectsHandler } from '../api/projects.js';
import { STORE_NAME, IS_READ_ONLY, ROOT } from '../api/_lib/store.js';
import { readSession } from '../api/_lib/session.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(DIR, '..');
const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

/* --- API --- */
app.all('/api/auth', authHandler);
app.all('/api/projects', projectsHandler);

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    backend: STORE_NAME,
    soloLectura: IS_READ_ONLY,
    raiz: path.basename(ROOT),
  });
});

/* --- Puerta del admin ---
   En Docker sí se puede proteger el propio HTML: sin sesión
   válida no se sirve el archivo. En Vercel el admin.html es
   un archivo estático público, pero no lleva secretos: lo que
   protege de verdad es la API, y esa siempre pide sesión. */
app.get('/admin.html', (req, res, next) => {
  const sesion = readSession(req.headers.cookie, process.env.SESSION_SECRET);
  if (sesion) return next();
  res.status(401).sendFile(path.join(SITE, 'admin.html'), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
});

/* --- Estáticos --- */
app.use(
  express.static(SITE, {
    index: 'index.html',
    extensions: ['html'],
    setHeaders(res, filePath) {
      if (/\.(svg|png|jpe?g|webp|avif)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=604800');
      }
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  })
);

app.use((req, res) => {
  res.status(404).sendFile(path.join(SITE, '404.html'), (err) => {
    if (err) res.status(404).type('text/plain').send('404 — no encontrado');
  });
});

app.use((err, req, res, next) => {
  console.error('[server]', err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

if (process.env.SESSION_SECRET) {
  app.listen(PORT, () => {
    console.log(`Multimedios en http://localhost:${PORT}`);
    console.log(`  backend: ${STORE_NAME}${IS_READ_ONLY ? ' (solo lectura)' : ''}`);
  });
} else {
  console.error('Falta SESSION_SECRET. Copia .env.example a .env y define uno.');
  console.error('  openssl rand -hex 32');
  process.exit(1);
}
