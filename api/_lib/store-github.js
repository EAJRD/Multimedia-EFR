/* ============================================
   Backend GitHub: data/projects.json y data/users.json
   viven en el repo. Cada cambio del admin es un commit.
   Funciona en Vercel, donde no hay disco.
   ============================================ */

const API = 'https://api.github.com';

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}

export function isAvailable() {
  return Boolean(process.env.GITHUB_TOKEN && process.env.GITHUB_REPO);
}

async function req(path, { method = 'GET', body, raw } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${required('GITHUB_TOKEN')}`,
      Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'multimedios-site',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`GitHub ${res.status}: ${detail.slice(0, 300)}`);
  }
  return raw ? res.text() : res.json();
}

function fileUrl(path) {
  const repo = required('GITHUB_REPO'); // "EAJRD/Multimedia-EFR"
  return `/repos/${repo}/contents/${path}`;
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await req(fileUrl(path), { raw: true }));
  } catch (e) {
    // 404 = el archivo no existe todavía. Se devuelve el valor inicial.
    if (String(e.message).includes('GitHub 404')) return fallback;
    throw e;
  }
}

async function writeJson(path, value, mensaje) {
  const repo = required('GITHUB_REPO');
  const contenido = JSON.stringify(value, null, 2) + '\n';

  let sha;
  try {
    const actual = await req(fileUrl(path));
    sha = actual.sha;
  } catch (e) {
    if (!String(e.message).includes('GitHub 404')) throw e;
  }

  await req(fileUrl(path), {
    method: 'PUT',
    body: {
      message: mensaje,
      content: Buffer.from(contenido).toString('base64'),
      ...(sha ? { sha } : {}),
      branch: process.env.GITHUB_BRANCH || 'main',
    },
  });

  return { path, sha };
}

const EMPTY = { categorias: [], proyectos: [] };

export const githubStore = {
  name: 'github',

  async getProjects() {
    return readJson('data/projects.json', EMPTY);
  },

  async saveProjects(data, mensaje = 'contenido: actualizar proyectos') {
    return writeJson('data/projects.json', data, mensaje);
  },

  async getUsers() {
    return readJson('data/users.json', { usuarios: [] });
  },

  async saveUsers(data, mensaje = 'admin: actualizar usuarios') {
    return writeJson('data/users.json', data, mensaje);
  },
};
