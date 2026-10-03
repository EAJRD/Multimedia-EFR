/* ============================================
   Backend GitHub: data/projects.json y data/users.json
   viven en el repo. Cada cambio del admin es un commit.
   Funciona en Vercel, donde no hay disco.

   El contenido va en claro: es público a propósito.
   El registro de usuarios va cifrado, porque el repo es público y los
   hashes no deberían estar a la vista. Ver secret-box.js.

   --- Por qué las lecturas no van por la API ---

   Medido contra api.github.com: entre 0,6 y 3,6 s por petición, con
   errores 500 propios de GitHub de vez en cuando. Vercel da 10 s a la
   función y se las agotaba: crear un usuario devolvía 504. Ese endpoint
   es para escribir; para leer el mismo archivo está raw.githubusercontent,
   que es CDN y responde en 0,15 s.

   Así que: leer por la CDN, escribir por la API (no hay otra forma de
   hacer commit), y toda llamada con AbortSignal.timeout para que un
   cuelgue se convierta en un error útil en vez de un 504 sin pistas.
   ============================================ */

import { abrir, sellar } from './secret-box.js';

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

// Holgado para la CDN, corto para la API: el tope lo pone la función.
const MS_READ = 4000;
const MS_WRITE = 5000;
const INTENTOS = 3;

/* Una instancia de Vercel atiende muchas peticiones seguidas. Lo que
   acaba de escribir el admin se le sirve de memoria: así no depende de
   que la CDN ya se haya dado cuenta, que puede tardar. */
const CACHE_MS = 5 * 60_000;
const cache = new Map();

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}

export function isAvailable() {
  return Boolean(process.env.GITHUB_TOKEN && process.env.GITHUB_REPO);
}

function rama() {
  return process.env.GITHUB_BRANCH || 'main';
}

function fileUrl(path) {
  const repo = required('GITHUB_REPO'); // "EAJRD/Multimedia-EFR"
  return `/repos/${repo}/contents/${path}`;
}

function rawUrl(path) {
  return `${RAW}/${required('GITHUB_REPO')}/${rama()}/${path}`;
}

/* Un 429 o un 5xx se van a repetir si se reintenta ya; un 404 o un 403
   no, así que no gastamos tiempo en ellos. */
function esTransitorio(status) {
  return status === 429 || status >= 500;
}

const respiro = (ms) => new Promise((r) => setTimeout(r, ms));

/** Una llamada a la API de GitHub con presupuesto de tiempo y reintentos.
 *  Lanza con `status` para que el llamante pueda decidir. */
async function api(path, { method = 'GET', body, raw, timeout = MS_READ } = {}) {
  const carga = body !== undefined ? JSON.stringify(body) : undefined;
  let ultimo;

  for (let intento = 1; intento <= INTENTOS; intento++) {
    try {
      const res = await fetch(`${API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${required('GITHUB_TOKEN')}`,
          Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'multimedios-site',
          ...(carga !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        signal: AbortSignal.timeout(timeout),
        ...(carga !== undefined ? { body: carga } : {}),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        const err = new Error(`GitHub ${res.status}: ${detail.slice(0, 300)}`);
        err.status = res.status;
        if (!esTransitorio(res.status)) throw err;
        ultimo = err;
      } else {
        return raw ? res.text() : res.json();
      }
    } catch (e) {
      ultimo = e;
      // Un 404/403 ya no mejora al reintentar: se propaga tal cual.
      if (e.status && !esTransitorio(e.status)) throw e;
    }
    if (intento < INTENTOS) await respiro(250 * intento);
  }

  throw ultimo || new Error('GitHub no respondió');
}

/** Lectura por la CDN. Devuelve null si el archivo no existe. */
async function leerCrudo(path) {
  try {
    const res = await fetch(rawUrl(path), {
      headers: { 'User-Agent': 'multimedios-site' },
      signal: AbortSignal.timeout(MS_READ),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`raw.githubusercontent ${res.status}`);
    return res.text();
  } catch (e) {
    // Si el repo fuera privado la CDN no sirve; el llamador cae a la API.
    throw Object.assign(e, { porRed: true });
  }
}

/** El JSON del archivo tal y como está en el repo, sin descifrar.
 *  Cachea por dentro y siembra la cache al escribir. */
async function readRaw(path, fallback) {
  const guardado = cache.get(path);
  if (guardado && Date.now() - guardado.at < CACHE_MS) return guardado.valor;

  let texto;
  try {
    texto = await leerCrudo(path);
  } catch {
    texto = undefined; // red o repo privado: se reintenta por la API
  }

  if (texto === undefined) {
    try {
      texto = await api(fileUrl(path), { raw: true });
    } catch (e) {
      if (e.status === 404) return fallback;
      throw e;
    }
  }

  if (texto === null) return fallback;

  const valor = JSON.parse(texto);
  remember(path, valor);
  return valor;
}

/* Se guarda una copia: si quien lee muta lo que recibe, la cache no queda
   envenenada con un cambio a medio hacer. */
function remember(path, valor) {
  cache.set(path, { valor: structuredClone(valor), at: Date.now() });
}

/** Sube un archivo al repo. `contenidoBase64` va tal cual, sin pasar
 *  por JSON.stringify: aquí pueden ir imágenes binarias. */
async function putFile(path, contenidoBase64, mensaje) {
  let sha;
  try {
    sha = (await api(fileUrl(path), { timeout: MS_WRITE })).sha;
  } catch (e) {
    if (e.status !== 404) throw e;
  }

  await api(fileUrl(path), {
    method: 'PUT',
    timeout: MS_WRITE,
    body: {
      message: mensaje,
      content: contenidoBase64,
      ...(sha ? { sha } : {}),
      branch: rama(),
    },
  });

  return { path, sha };
}

async function writeJson(path, value, mensaje) {
  const res = await putFile(path, Buffer.from(JSON.stringify(value, null, 2) + '\n').toString('base64'), mensaje);
  // Lo que se acaba de escribir es la versión buena: se sirve de memoria.
  remember(path, value);
  return res;
}

const EMPTY = { categorias: [], proyectos: [] };

export const githubStore = {
  name: 'github',

  async getProjects() {
    return readRaw('data/projects.json', EMPTY);
  },

  async saveProjects(data, mensaje = 'contenido: actualizar proyectos') {
    return writeJson('data/projects.json', data, mensaje);
  },

  async getUsers() {
    return abrir(await readRaw('data/users.json', { usuarios: [] }));
  },

  async saveUsers(data, mensaje = 'admin: actualizar usuarios') {
    // sellar() lanza si no hay SESSION_SECRET. Mejor no escribir que
    // dejar los hashes a la vista de cualquiera que abra el repo.
    return writeJson('data/users.json', sellar(data), mensaje);
  },

  /** Sube un binario al repo. Lo usa api/upload.js para las imágenes.
   *  Devuelve la ruta pública para guardarla en el proyecto. */
  async putAsset(ruta, base64, mensaje = 'contenido: subir imagen') {
    return putFile(ruta, base64, mensaje);
  },
};

/** Vacía la cache. Solo para los tests: si no, un test que escribe
    poisoning deja a los siguientes leyendo de memoria sin ir a la red. */
export function resetCache() {
  cache.clear();
}