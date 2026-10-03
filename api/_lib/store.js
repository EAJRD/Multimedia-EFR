/* ============================================
   Adaptador: elige backend según el entorno.

     STORE=github  → data/*.json en el repo (Vercel)
     STORE=sqlite  → base SQLite en un volumen (Docker)

   Si no se dice nada, se deduce: si hay GITHUB_REPO y no hay
   DATABASE_PATH, GitHub. Si no, SQLite. Si no hay ninguno,
   modo lectura: solo sirve el contenido del repo en disco.
   ============================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { githubStore } from './store-github.js';
import { sqliteStore } from './store-sqlite.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/* --- Backend de solo lectura: sirve los JSON del disco.
   Es el modo por defecto en desarrollo y el que permite que
   el sitio funcione aunque no haya ninguna variable de entorno. --- */

const fileStore = {
  name: 'file',
  readOnly: true,

  async getProjects() {
    return readLocal('data/projects.json', { categorias: [], proyectos: [] });
  },

  async saveProjects() {
    throw Object.assign(new Error(diagnosticoAlmacenamiento()), {
      code: 'READ_ONLY',
    });
  },

  async getUsers() {
    return readLocal('data/users.json', { usuarios: [] });
  },

  async saveUsers() {
    throw Object.assign(new Error(diagnosticoAlmacenamiento()), {
      code: 'READ_ONLY',
    });
  },

  async putAsset() {
    throw Object.assign(new Error(diagnosticoAlmacenamiento()), {
      code: 'READ_ONLY',
    });
  },
};

function readLocal(rel, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  } catch {
    return fallback;
  }
}

function pick() {
  const explicit = (process.env.STORE || '').toLowerCase();
  if (explicit === 'github') return githubStore;
  if (explicit === 'sqlite') return sqliteStore;
  if (process.env.DATABASE_PATH) return sqliteStore;
  if (process.env.GITHUB_REPO) return githubStore;
  return fileStore;
}

export const store = pick();
export const STORE_NAME = store.name;
export const IS_READ_ONLY = Boolean(store.readOnly);

/* Un error genérico ("configura GITHUB_REPO") no sirve de nada si no dice
   cuál de las dos falta, ni en qué entorno hay que ponerla, ni que cambiar
   una variable en Vercel no redeploya por sí solo. */
export function diagnosticoAlmacenamiento() {
  const enVercel = Boolean(process.env.VERCEL);
  const repoFalta = !process.env.GITHUB_REPO;
  const tokenFalta = !process.env.GITHUB_TOKEN;

  if (enVercel) {
    if (repoFalta || tokenFalta) {
      const faltan = [
        repoFalta && 'GITHUB_REPO',
        tokenFalta && 'GITHUB_TOKEN',
      ].filter(Boolean);
      return (
        `Faltan variables de entorno en Vercel (${faltan.join(' y ')}). ` +
        'En el proyecto: Settings → Environment Variables. Pon ' +
        'GITHUB_REPO=EAJRD/Multimedia-EFR y un GITHUB_TOKEN que sea un token ' +
        'fino de GitHub con permiso Contents: Read and write sobre ese repo. ' +
        'Marca Production, Preview y Development, y luego Redeploy: ' +
        'cambiar una variable no redeploya solo.'
      );
    }
    return (
      'GITHUB_REPO y GITHUB_TOKEN están puestos, pero el backend salió de solo ' +
      'lectura. Revisa que el token no haya caducado y que el repositorio sea ' +
      'ese mismo, y haz Redeploy.'
    );
  }

  return (
    'Almacenamiento de solo lectura: define DATABASE_PATH para usar SQLite, o ' +
    'GITHUB_REPO y GITHUB_TOKEN para usar GitHub. Si esperabas que el .env se ' +
    'leyera solo, arranca con "npm start": el .env lo carga el script, no Node.'
  );
}

export function requireWritable() {
  if (IS_READ_ONLY) {
    throw Object.assign(new Error(diagnosticoAlmacenamiento()), {
      code: 'READ_ONLY',
    });
  }
}

export { ROOT };
