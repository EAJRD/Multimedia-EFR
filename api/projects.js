/* ============================================
   /api/projects
     GET        → contenido público (sin sesión hace falta)
     POST       → { proyectos, categorias }  reemplaza todo
     PUT        → { proyecto }               upsert de uno
     DELETE     → { id }                     borra uno
   ============================================ */

import { store, IS_READ_ONLY } from './_lib/store.js';
import { readSession } from './_lib/session.js';
import { validateProject, validateCategorias } from './_lib/validate.js';
import { send, fail, readBody, guard } from './_lib/http.js';

function sesionValida(req) {
  return Boolean(readSession(req.headers.cookie, process.env.SESSION_SECRET));
}

function slugify(s, fallback) {
  const base = String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || fallback;
}

export const handler = guard(async (req, res) => {
  const method = req.method.toUpperCase();

  /* --- público --- */
  if (method === 'GET') {
    const data = await store.getProjects();
    return send(res, 200, data, {
      // El sitio público puede cachear un minuto; el admin, no.
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
      'X-Store': store.name,
    });
  }

  if (!sesionValida(req)) return fail(res, 401, 'Necesitas iniciar sesión.');

  const data = await store.getProjects();
  const cats = (data.categorias || []).map((c) => c.id);
  const body = await readBody(req);

  /* --- reemplazar todo --- */
  if (method === 'POST') {
    if (IS_READ_ONLY) return fail(res, 503, 'Almacenamiento de solo lectura: configura GITHUB_REPO o DATABASE_PATH.');

    const c = validateCategorias(body.categorias);
    if (!c.ok) return fail(res, 400, c.errors.join(' '), { errores: c.errors });

    if (!Array.isArray(body.proyectos)) return fail(res, 400, 'La lista de proyectos debe ser un array.');

    const vistos = new Set();
    const proyectos = [];
    for (const raw of body.proyectos) {
      const v = validateProject(raw, c.value.map((x) => x.id));
      if (!v.ok) return fail(res, 400, v.errors.join(' '), { errores: v.errors });

      let id = v.value.id || slugify(v.value.titulo, 'proyecto');
      if (vistos.has(id)) return fail(res, 400, `Id duplicado: "${id}".`);
      vistos.add(id);

      proyectos.push({ ...v.value, id });
    }

    await store.saveProjects({ categorias: c.value, proyectos });
    return send(res, 200, { ok: true, total: proyectos.length, categorias: c.value.length });
  }

  /* --- upsert de uno --- */
  if (method === 'PUT') {
    if (IS_READ_ONLY) return fail(res, 503, 'Almacenamiento de solo lectura: configura GITHUB_REPO o DATABASE_PATH.');

    const v = validateProject(body.proyecto, cats);
    if (!v.ok) return fail(res, 400, v.errors.join(' '), { errores: v.errors });

    const id = v.value.id || slugify(v.value.titulo, 'proyecto');
    const proyecto = { ...v.value, id };

    const i = data.proyectos.findIndex((p) => p.id === id);
    const proyectos = data.proyectos.slice();
    if (i >= 0) proyectos[i] = proyecto;
    else proyectos.push(proyecto);

    await store.saveProjects({ categorias: data.categorias, proyectos });
    return send(res, i >= 0 ? 200 : 201, { ok: true, proyecto, creado: i < 0 });
  }

  /* --- borrar uno --- */
  if (method === 'DELETE') {
    if (IS_READ_ONLY) return fail(res, 503, 'Almacenamiento de solo lectura: configura GITHUB_REPO o DATABASE_PATH.');

    const id = String(body.id || '');
    const i = data.proyectos.findIndex((p) => p.id === id);
    if (i < 0) return fail(res, 404, `No existe el proyecto "${id}".`);

    const proyecto = data.proyectos[i];
    const proyectos = data.proyectos.filter((p) => p.id !== id);

    await store.saveProjects({ categorias: data.categorias, proyectos });
    return send(res, 200, { ok: true, borrado: proyecto });
  }

  return fail(res, 405, 'Método no permitido.');
});

export default handler;
