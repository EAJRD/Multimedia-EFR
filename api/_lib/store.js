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
    throw Object.assign(new Error('Este despliegue es de solo lectura. Define GITHUB_REPO o DATABASE_PATH.'), {
      code: 'READ_ONLY',
    });
  },

  async getUsers() {
    return readLocal('data/users.json', { usuarios: [] });
  },

  async saveUsers() {
    throw Object.assign(new Error('Este despliegue es de solo lectura. Define GITHUB_REPO o DATABASE_PATH.'), {
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

export function requireWritable() {
  if (IS_READ_ONLY) {
    throw Object.assign(new Error('Almacenamiento de solo lectura: configura GITHUB_REPO o DATABASE_PATH.'), {
      code: 'READ_ONLY',
    });
  }
}

export { ROOT };
