/* ============================================
   Validación del contenido de proyectos.
   Todo lo que llega del admin pasa por aquí antes
   de tocar el disco o el repo.
   ============================================ */

export const MAX_TEXT = 4000;

const CATEGORIA_RE = /^[a-z0-9-]{2,24}$/;
const ID_RE = /^[a-z0-9-]{2,40}$/;
const IMAGEN_RE = /^(img\/)?[a-zA-Z0-9._\/-]+\.(svg|png|jpe?g|webp|avif)$/;

function str(v, max) {
  if (v == null) return '';
  return String(v).slice(0, max);
}

export function validateProject(input, categoriasIds) {
  const errors = [];
  const p = input && typeof input === 'object' ? input : {};

  const id = str(p.id, 40).trim();
  const titulo = str(p.titulo, 120).trim();
  const categoria = str(p.categoria, 24).trim();
  const imagen = str(p.imagen, 200).trim();

  if (id && !ID_RE.test(id)) {
    errors.push('El id solo admite minúsculas, números y guiones (ej. "48-hour").');
  }
  if (titulo.length < 2) {
    errors.push('El título es obligatorio.');
  }
  if (!categoriasIds.includes(categoria)) {
    errors.push(`La categoría "${categoria}" no existe. Válidas: ${categoriasIds.join(', ')}.`);
  }
  if (imagen && !IMAGEN_RE.test(imagen)) {
    errors.push('La imagen debe ser una ruta dentro de img/ con extensión svg, png, jpg, webp o avif.');
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      id,
      titulo,
      categoria,
      cliente: str(p.cliente, 80).trim(),
      anio: str(p.anio, 8).trim(),
      duracion: str(p.duracion, 24).trim(),
      resumen: str(p.resumen, 400).trim(),
      detalle: str(p.detalle, MAX_TEXT).trim(),
      meta: str(p.meta, 200).trim(),
      imagen,
      alt: str(p.alt, 160).trim() || titulo,
      destacado: p.destacado === true,
      pendiente: p.pendiente === true,
    },
  };
}

export function validateCategorias(input) {
  const list = Array.isArray(input) ? input : [];
  if (!list.length) return { ok: false, errors: ['Tiene que haber al menos una categoría.'] };
  if (list.length > 12) return { ok: false, errors: ['Máximo 12 categorías.'] };

  const seen = new Set();
  const out = [];

  for (const raw of list) {
    const c = raw && typeof raw === 'object' ? raw : {};
    const id = str(c.id, 24).trim();
    const nombre = str(c.nombre, 40).trim();

    if (!CATEGORIA_RE.test(id)) {
      return { ok: false, errors: [`Id de categoría inválido: "${id}". Minúsculas, números y guiones.`] };
    }
    if (seen.has(id)) {
      return { ok: false, errors: [`Categoría duplicada: "${id}".`] };
    }
    if (nombre.length < 2) {
      return { ok: false, errors: [`Falta el nombre de la categoría "${id}".`] };
    }
    seen.add(id);
    out.push({ id, nombre });
  }

  return { ok: true, value: out };
}
