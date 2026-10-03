/* ============================================
   Subida de imágenes al repo.

   Vive aquí y no en api/upload.js porque, en este proyecto de Vercel,
   cualquier función nueva dentro de api/ se registraba pero no se
   invocaba: respondía FUNCTION_INVOCATION_FAILED incluso con un
   handler de cuatro líneas sin imports, mientras api/auth.js y
   api/projects.js funcionaban sin problema. Al ser un módulo de _lib,
   lo importa una función que ya sabemos que arranca.

   Lo que llega del navegador no se confía: el tipo se deduce de los
   bytes, no del campo que manda el cliente, y el nombre del archivo se
   rehace desde cero. Un attacker podría mandar "foto.png" con un script
   dentro; por eso un SVG solo se acepta después de mirarlo.
   ============================================ */

import { store } from './store.js';

/* readBody corta en 1 MB, demasiado para una foto. 4 MB de sobra para
   este contenido, y por debajo del tope de 4,5 MB que acepta Vercel. */
export const MAX_BYTES = 4 * 1024 * 1024;
export const MAX_BASE64 = Math.ceil((MAX_BYTES * 4) / 3) + 1024;

/* Los tipos que el sitio sabe mostrar en <img>. */
const TIPOS = {
  'image/svg+xml': 'svg',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

const LIMITE_MB = Math.round(MAX_BYTES / 1024 / 1024);

/** Los primeros bytes delatan el tipo real. Es lo único que se cree. */
function sniff(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  const firmaPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length >= 8 && buf.subarray(0, 8).equals(firmaPng)) return 'image/png';
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (buf.length >= 12 && buf.subarray(4, 8).toString('ascii') === 'ftyp') {
    const marca = buf.subarray(8, 12).toString('ascii');
    if (marca === 'avif' || marca === 'avis') return 'image/avif';
  }
  const texto = buf.subarray(0, 400).toString('utf8').trim();
  if (texto.startsWith('<svg')) return 'image/svg+xml';
  if (texto.startsWith('<?xml') && texto.includes('<svg')) return 'image/svg+xml';
  return null;
}

/* Un SVG puede llevar <script>. Solo se guarda si es de los que se
   dibujan: desde <img> el navegador no ejecuta nada, pero el archivo
   también se sirve suelto y ahí sí podría. */
function svgEsSeguro(buf) {
  const texto = buf.toString('utf8');
  if (/<script[\s>]/i.test(texto)) return false;
  if (/<foreignObject/i.test(texto)) return false;
  if (/\son[a-z]+\s*=/i.test(texto)) return false;
  if (/javascript:/i.test(texto)) return false;
  return true;
}

/** Nombre nuevo y aburrido. Nada de lo que manda el cliente sobrevive
   salvo una huella, para que dos subidas seguidas no se pisen. */
function nombreSeguro(base, ext) {
  const slug =
    String(base)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'imagen';
  return `${slug}-${Date.now().toString(36)}.${ext}`;
}

/** Cuerpo con tope propio: el de readBody no da para una imagen. */
export function leerCuerpoGrande(req) {
  return new Promise((resolve, reject) => {
    const trozos = [];
    let bytes = 0;
    req.on('data', (t) => {
      bytes += t.length;
      if (bytes > MAX_BASE64) {
        reject(
          Object.assign(new Error(`La imagen supera el límite de ${LIMITE_MB} MB`), {
            code: 'TOO_LARGE',
          })
        );
        req.destroy();
        return;
      }
      trozos.push(t);
    });
    req.on('end', () => {
      const crudo = Buffer.concat(trozos).toString('utf8');
      if (!crudo.trim()) {
        return reject(Object.assign(new Error('Cuerpo vacío'), { code: 'BAD_JSON' }));
      }
      try {
        resolve(JSON.parse(crudo));
      } catch {
        reject(
          Object.assign(new Error('El cuerpo no es JSON válido'), { code: 'BAD_JSON' })
        );
      }
    });
    req.on('error', reject);
  });
}

/** Valida y guarda. Devuelve { status, cuerpo } para que el handler
    conteste, o lanza si no hay nada que hacer. */
export async function guardarImagen(body) {
  const base64 = String(body.base64 || '');
  if (!base64) {
    return { status: 400, cuerpo: { error: 'Falta la imagen.' } };
  }

  const buf = Buffer.from(base64, 'base64');
  if (!buf.length) {
    return { status: 400, cuerpo: { error: 'La imagen viene vacía.' } };
  }
  if (buf.length > MAX_BYTES) {
    return {
      status: 413,
      cuerpo: { error: `La imagen supera el límite de ${LIMITE_MB} MB.` },
    };
  }

  const tipo = sniff(buf);
  if (!tipo || !TIPOS[tipo]) {
    return {
      status: 415,
      cuerpo: { error: 'Formato no admitido. Usa SVG, PNG, JPG, WebP o AVIF.' },
    };
  }
  if (tipo === 'image/svg+xml' && !svgEsSeguro(buf)) {
    return {
      status: 415,
      cuerpo: {
        error: 'Ese SVG lleva scripts o manejadores. Quítalos y vuelve a subirlo.',
      },
    };
  }

  if (typeof store.putAsset !== 'function') {
    return { status: 501, cuerpo: { error: 'Este backend no admite subir archivos.' } };
  }

  const nombre = nombreSeguro(body.nombre || 'imagen', TIPOS[tipo]);
  const ruta = `img/${nombre}`;
  await store.putAsset(ruta, buf.toString('base64'), `contenido: imagen ${nombre}`);

  return { status: 201, cuerpo: { ok: true, ruta, url: `/${ruta}` } };
}