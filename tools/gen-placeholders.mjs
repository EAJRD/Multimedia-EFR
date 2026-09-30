// Genera posters SVG de placeholder con la paleta del sello.
// Uso: node tools/gen-placeholders.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'img');
mkdirSync(out, { recursive: true });

const W = 1200;
const H = 800;
const GREEN = '#20E898';

const posters = [
  { file: 'encajonado',       cat: 'Cortometraje',   t: 'Encajonado' },
  { file: 'ultima-tanda',     cat: 'Cortometraje',   t: 'La Última Tanda' },
  { file: '48-hour',          cat: 'Cortometraje',   t: '48 Hour Film Project' },
  { file: 'film-festival',    cat: 'Eventos',        t: 'Puerto Rico Film Festival' },
  { file: 'teatro-balboa',    cat: 'Eventos',        t: 'Teatro Balboa' },
  { file: 'reunion-2026',     cat: 'Contenido',      t: 'Reunión de voluntarios' },
  { file: 'publicidad-pend',  cat: 'Publicidad',     t: 'Por definir' },
  { file: 'redes-pend',       cat: 'Redes sociales',  t: 'Por definir' },
];

// Retícula fina, como el plano técnico detrás del diafragma del sello.
const grid = (w, h, step) => {
  let d = '';
  for (let x = 0; x <= w; x += step) d += `M${x} 0V${h}`;
  for (let y = 0; y <= h; y += step) d += `M0 ${y}H${w}`;
  return `<path d="${d}" stroke="${GREEN}" stroke-opacity=".07" stroke-width="1" fill="none"/>`;
};

// Diafragma de cámara: seis aspas, como el centro del sello.
const diaphragm = (cx, cy, r) => {
  const blades = 6;
  let d = '';
  for (let i = 0; i < blades; i++) {
    const a = (i * Math.PI * 2) / blades - Math.PI / 2;
    const a2 = a + Math.PI / blades;
    d += `M${cx} ${cy}L${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`
      + `A${r} ${r} 0 0 1 ${cx + r * Math.cos(a2)} ${cy + r * Math.sin(a2)}Z `;
  }
  return `<g><circle cx="${cx}" cy="${cy}" r="${r + 14}" fill="none" stroke="${GREEN}" stroke-width="3"/>`
    + `<path d="${d}" fill="none" stroke="#fff" stroke-width="2.5" stroke-opacity=".85"/>`
    + `<circle cx="${cx}" cy="${cy}" r="7" fill="${GREEN}"/></g>`;
};

for (const p of posters) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Marcador de posición para ${p.t}">
  <rect width="${W}" height="${H}" fill="#000"/>
  ${grid(W, H, 40)}
  ${diaphragm(W / 2, H / 2 - 30, 120)}
  <text x="${W / 2}" y="${H / 2 + 190}" text-anchor="middle" fill="#fff" font-family="'Bebas Neue','Arial Narrow',sans-serif" font-size="86" letter-spacing="4">${p.t.toUpperCase()}</text>
  <text x="${W / 2}" y="${H / 2 + 234}" text-anchor="middle" fill="${GREEN}" font-family="Inter,system-ui,sans-serif" font-size="26" letter-spacing="6">${p.cat.toUpperCase()}</text>
  <line x1="${W / 2 - 60}" y1="${H / 2 + 268}" x2="${W / 2 + 60}" y2="${H / 2 + 268}" stroke="${GREEN}" stroke-width="3"/>
  <text x="${W / 2}" y="${H / 2 + 312}" text-anchor="middle" fill="#9AA3AF" font-family="Inter,system-ui,sans-serif" font-size="22">STILL PENDIENTE · SUSTITUIR POR FOTO DEL PROYECTO</text>
</svg>
`;
  writeFileSync(join(out, `${p.file}.svg`), svg);
  console.log('escrito', `img/${p.file}.svg`);
}
