/* ============================================
   Backend SQLite: para Docker Compose.
   Guarda en un volumen, sin depender de GitHub.
   ============================================ */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let db = null;

export function isAvailable() {
  return Boolean(process.env.DATABASE_PATH || process.env.SQLITE_PATH);
}

function path_() {
  return process.env.DATABASE_PATH || process.env.SQLITE_PATH;
}

/* Semilla: la primera vez que se crea el volumen se copia el contenido
   del repo, para que un Docker recién levantado no salga vacío. */
function readLocal(rel, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  } catch {
    return fallback;
  }
}

function open() {
  if (db) return db;

  const Database = require('better-sqlite3');
  db = new Database(path_());
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id     TEXT PRIMARY KEY,
      body   TEXT NOT NULL,
      orden  INTEGER NOT NULL DEFAULT 0
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id    TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      body  TEXT NOT NULL
    )
  `);

  const tiene = db.prepare('SELECT COUNT(*) AS n FROM projects').get();
  if (tiene.n === 0) {
    const semilla = readLocal('data/projects.json', { categorias: [], proyectos: [] });
    db.prepare('INSERT INTO projects (id, body, orden) VALUES (?, ?, 0)').run('sitio', JSON.stringify(semilla));
    console.log(`[sqlite] volumen vacío: contenido inicial copiado de data/projects.json (${semilla.proyectos.length} proyectos)`);
  }

  const tieneUsuarios = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  if (tieneUsuarios.n === 0) {
    const semilla = readLocal('data/users.json', { usuarios: [] });
    for (const u of semilla.usuarios || []) {
      db.prepare('INSERT INTO users (id, email, body) VALUES (?, ?, ?)').run(u.id, u.email, JSON.stringify(u));
    }
    if (semilla.usuarios?.length) {
      console.log(`[sqlite] ${semilla.usuarios.length} usuario(s) copiados de data/users.json`);
    }
  }

  return db;
}

export const sqliteStore = {
  name: 'sqlite',

  async getProjects() {
    const rows = open().prepare('SELECT body FROM projects ORDER BY orden').all();
    if (!rows.length) return { categorias: [], proyectos: [] };
    return JSON.parse(rows[0].body);
  },

  async saveProjects(data) {
    const d = open();
    d.transaction(() => {
      d.prepare('DELETE FROM projects').run();
      d.prepare('INSERT INTO projects (id, body, orden) VALUES (?, ?, 0)').run(
        'sitio',
        JSON.stringify(data)
      );
    })();
    return { path: path_() };
  },

  async getUsers() {
    const rows = open().prepare('SELECT body FROM users ORDER BY email').all();
    return { usuarios: rows.map((r) => JSON.parse(r.body)) };
  },

  async saveUsers(data) {
    const d = open();
    d.transaction(() => {
      d.prepare('DELETE FROM users').run();
      const ins = d.prepare('INSERT INTO users (id, email, body) VALUES (?, ?, ?)');
      for (const u of data.usuarios) ins.run(u.id, u.email, JSON.stringify(u));
    })();
    return { path: path_() };
  },

  /* En Docker hay disco de verdad, así que una imagen no necesita
     commit: se escribe en el volumen, junto a la base de datos, y el
     servidor la sirve como estático. */
  async putAsset(ruta, base64) {
    // La ruta la fabricó upload.js; aquí solo se evita que un ".."
    // se salga del directorio de assets.
    const limpio = path.normalize(ruta).replace(/^([/\\]|\.\.[/\\])+/, '');
    if (!limpio.startsWith('img/')) {
      throw Object.assign(new Error('Los assets solo pueden ir en img/'), { code: 'BAD_PATH' });
    }
    const destino = path.join(path.dirname(path_()), limpio);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, Buffer.from(base64, 'base64'));
    return { path: limpio };
  },
};
