/* ============================================
   /api/upload
     POST → { nombre, tipo, base64 }
     Guarda una imagen en el repo y devuelve su ruta pública.

   Solo admin, como todo lo que escribe. El archivo va al repo porque en
   Vercel no hay disco donde subirlo, y porque así el sitio entero se
   despliega con un git pull.

   Lo que llega del navegador no se confía: el nombre se rehace desde
   cero y el tipo se deduce de los bytes, no del campo que manda el
   cliente. Un attacker podría mandar "foto.png" con un script dentro y
   guardarlo como .svg; por eso el SVG no se acepta sin mirarlo.
   ============================================ */

import { store, requireWritable, IS_READ_ONLY } from './_lib/store.js';
import { readSession } from './_lib/session.js';
import { send, fail, guard } from './_lib/http.js';

/* El cuerpo de readBody corta en 1 MB, demasiado para una foto. Las
   imágenes del sitio son SVG livianos o JPEG de campaña: 4 MB de sobra,
   y por debajo del tope de 4,5 MB que Vercel acepta. */
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_BASE64 = Math.ceil((MAX_BYTES * 4) / 3) + 1024;

/* Tipos que el sitio sabe mostrar en <img>. */
const TIPOS = {
  'image/svg+xml': 'svg',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

/** Los primeros bytes delatan el tipo real. Es lo único que se cree. */
function sniff(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  if (buf.length >= 12 && buf.subarray(4, 8).toString('ascii') === 'ftyp') {
    const marca = buf.subarray(8, 12).toString('ascii');
    if (marca === 'avif' || marca === 'avis') return 'image/avif';
  }
  const texto = buf.subarray(0, 400).toString('utf8').trim();
  if (texto.startsWith('<svg') || (texto.startsWith('<?xml') && texto.includes('<svg'))) return 'image/svg+xml';
  return null;
}

/* Un SVG puede llevar <script>. Se guarda solo si es de los que se
   dibujan, y siempre como .svg, que el navegador no ejecuta desde
   <img> salvo que el servidor lo sirva como documento. */
function svgEsSeguro(buf) {
  const texto = buf.toString('utf8');
  if (/<script[\s>]/i.test(texto)) return false;
  if (/on[a-z]+\s*=/i.test(texto)) return false;
  if (/javascript:/i.test(texto)) return false;
  if (/<foreignObject/i.test(texto)) return false;
  return true;
}

/** Nombre nuevo y aburrido: no se reutiliza nada que venga del cliente
   fuera de una huella para que dos subidas no se pisen. */
function nombreSeguro(base, ext) {
  const slug = String(base)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'imagen';
  const sello = Date.now().toString(36);
  return `${slug}-${sello}.${ext}`;
}

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    const trozos = [];
    let bytes = 0;
    req.on('data', (t) => {
      bytes += t.length;
      if (bytes > MAX_BASE64) {
        reject(Object.assign(new Error(`La imagen supera el límite de ${Math.round(MAX_BYTES / 1024 / 1024)} MB`), { code: 'TOO_LARGE' }));
        req.destroy();
        return;
      }
      trozos.push(t);
    });
    req.on('end', () => {
      const crudo = Buffer.concat(trozos).toString('utf8');
      if (!crudo.trim()) return reject(Object.assign(new Error('Cuerpo vacío'), { code: 'BAD_JSON' }));
      try {
        resolve(JSON.parse(crudo));
      } catch {
        reject(Object.assign(new Error('El cuerpo no es JSON válido'), { code: 'BAD_JSON' }));
      }
    });
    req.on('error', reject);
  });
}

export const handler = guard(async (req, res) => {
  if (req.method.toUpperCase() !== 'POST') return fail(res, 405, 'Método no permitido.');

  const sesion = readSession(req.headers.cookie, process.env.SESSION_SECRET);
  if (!sesion || sesion.rol !== 'admin') {
    return fail(res, 403, 'Solo un admin puede subir imágenes.');
  }
  requireWritable();
  if (IS_READ_ONLY) return fail(res, 503, 'Almacenamiento de solo lectura.');

  const body = await leerCuerpo(req);
  const base64 = String(body.base64 || '');
  if (!base64) return fail(res, 400, 'Falta la imagen.');

  let buf;
  try {
    buf = Buffer.from(base64, 'base64');
  } catch {
    return fail(res, 400, 'La imagen no llega en base64 válido.');
  }
  if (!buf.length) return fail(res, 400, 'La imagen viene vacía.');
  if (buf.length > MAX_BYTES) {
    return fail(res, 413, `La imagen supera el límite de ${Math.round(MAX_BYTES / 1024 / 1024)} MB.`);
  }

  const tipo = sniff(buf);
  if (!tipo || !TIPOS[tipo]) {
    return fail(res, 415, 'Formato no admitido. Usa SVG, PNG, JPG, WebP o AVIF.');
  }
  if (tipo === 'image/svg+xml' && !svgEsSeguro(buf)) {
    return fail(res, 415, 'Ese SVG lleva scripts o manejadores. Quítalos y vuelve a subirlo.');
  }

  const nombre = nombreSeguro(body.nombre || 'imagen', TIPOS[tipo]);
  const ruta = `img/${nombre}`;

  if (typeof store.putAsset !== 'function') {
    return fail(res, 501, 'Este backend no admite subir archivos.');
  }

  await store.putAsset(ruta, buf.toString('base64'), `contenido: imagen ${nombre}`);

  send(res, 201, { ok: true, ruta, url: `/${ruta}` });
});