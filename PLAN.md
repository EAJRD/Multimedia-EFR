# Multimedios — Plan de trabajo del sitio web

Casa productora. Objetivo: mostrar portafolio por categorías, captar organizaciones
interesadas a través de un formulario, y posicionar la marca.

**Dirección de marca (decidida):** sitio de productora comercial **con un anexo
ECFR** que explica qué es Multimedios. Ver §Deuda de marca al final, porque es el
punto que hay que resolver antes de publicar.

Stack: **HTML / CSS / JS estático**. Sin build, sin dependencias en producción.
Se hospeda en Netlify, Vercel o GitHub Pages arrastrando la carpeta.

---

## Estado actual

| Pieza | Estado |
|---|---|
| `index.html` | Sitio público completo, verificado |
| `admin.html` | Panel: login, editor de proyectos, gestión de usuarios |
| `api/` | Sesión firmada, login multiusuario, CRUD de contenido |
| `server/` | Express, misma API para Docker |
| `data/projects.json` | Fuente de verdad del contenido |
| `css/`, `js/`, `img/` | Sistema de diseño y 8 posters de placeholder |
| `Dockerfile`, `docker-compose.yml` | **Sin probar**: la máquina no tiene Docker |
| `vercel.json` | Despliegue en Vercel |
| `MANUAL-DE-MARCA.md` | Reglas de marca (manda sobre el contenido) |
| `tools/` | Generador de placeholders, 96 pruebas, capturas |

Verificación: `npm run test:all` → **96/96** (26 sitio público, 50 API y
panel, 10 arranque en frío, 10 cifrado del registro).

Para verlo: `npm install && npm start` → localhost:3000. El primer admin se
crea desde `admin.html`, en el propio navegador: no hace falta ningún comando.

---

## Fase 4 — Formulario de organizaciones — **pendiente**

**El formulario valida pero no envía.** `js/main.js` hace `preventDefault` y
muestra un toast de mentira. Para ponerlo en producción:

- [ ] **Opción A — Formspree** (5 min). Cuenta, endpoint en el `action`, quitar el
      `preventDefault` de `js/main.js`.
- [ ] **Opción B — Google Forms / Sheets.** Embeber o apuntar el `action`.

Campos ya definidos: organización, tipo de organización, persona de contacto,
email, tipo de proyecto, presupuesto, fecha de entrega, mensaje, RGPD.

- [ ] Escribir una `politica-privacidad.html` de verdad. El checkbox dice que la
      aceptaste y ese enlace no existe.
- [ ] Confirmar que hay alguien leyendo el buzón antes de publicar el formulario.

---

## Fase 0 — Definición (bloqueante, va primero)

Nada de esto se puede inventar. Cada punto necesita una respuesta del equipo.

- [ ] **Cifras del hero.** Hoy pone `XX+` y `XX` a propósito. ¿Cuántos proyectos y
      cuántos años? Si no hay cifra real, se quita el bloque entero.
- [ ] **Correo de contacto.** Hoy es `multimedios@example.com`. Alguien tiene que
      leerlo. Si no hay correo propio, usar el de la ECFR con permiso.
- [ ] **Teléfono.** Hoy `(787) 000-0000`. Confirmar o borrar.
- [ ] **Categorías definitivas.** Hoy hay 4 pestañas de filtro y 6 tarjetas de
      servicio. Se editan en `data/projects.json` o desde el panel.
- [ ] **Tono de voz.** El hero actual es de agencia. La sección ECFR es de proyecto
      estudiantil. ¿Se mezclan o se separan más?
- [ ] **Presupuestos en USD.** Puerto Rico usa dólares, no euros. Ya corregido.
- [ ] **Quién aprueba.** Manual de marca §12 punto 6 sigue sin resolver.

## Fase 1 — Sistema de diseño — **hecho**

- [x] Paleta: negro `#0B0D10` de base, verde del sello `#20E898` de acento,
      rojo `#D06070` secundario y escaso.
- [x] Naranja `#FF4D2E` del borrador anterior **retirado**: no existe en el sello.
- [x] Tipografías: `Bebas Neue` (display, condensada) + `Inter` (cuerpo).
- [x] Grid responsive: 1 columna en móvil, 2 en tablet, 3 en escritorio.
- [x] Componentes: botón primario/ghost, tarjeta, badge, campo de formulario,
      steps, modal, toast.

## Fase 2 — Estructura y contenido — **hecho**

- [x] Secciones: nav, hero, organizaciones, servicios, proyectos, proceso,
      anexo ECFR, formulario, footer.
- [x] `title` de 47 caracteres, `description` y Open Graph.
- [x] Roles ARIA y `alt` en todas las imágenes.
- [x] `html-validate` sin errores.

## Fase 3 — Interacción — **hecho**

- [x] Filtro por categoría, JS vanilla.
- [x] Modal de detalle por proyecto, con foco atrapado y `Escape`.
- [x] Menú móvil con `aria-expanded` y cierre al navegar.
- [x] Validación por campo, mensajes en español, `aria-live` en el toast.
- [x] Reveal on scroll con `IntersectionObserver` y `prefers-reduced-motion`.
- [x] Sin overflow horizontal a 390 px.

## Fase 5 — Fotos — **pendiente, es lo más pesado**

Los `img/*.svg` son marcadores, no fotos. Salen de `node tools/gen-placeholders.mjs`.
Cada uno dice STILL PENDIENTE. Hay que sustituirlos:

- [ ] Un still real por proyecto, 1200×800 mínimo, `.webp`, **menos de 200 KB**.
- [ ] El SVG se regenera al añadir o quitar un proyecto.
- [ ] El sello en SVG para el favicon. El manual §12.1 lo pide y no existe.
- [ ] Créditos de foto. «Foto: Suministrada» si la imagen viene de otro medio.
- [ ] `og-image` real. Ahora apunta a una URL que no existe.

## Fase 6 — Publicación — **pendiente**

- [ ] Dominio y DNS.
- [ ] Netlify / Vercel / GitHub Pages.
- [ ] HTTPS y `sitemap.xml`.
- [ ] Search Console y analítica.
- [ ] Compartir con la Open Graph image real.

## Fase 7 — Post-lanzamiento

- [ ] Casos de estudio con métricas reales («este spot hizo X»).
- [ ] Página por proyecto (`proyecto.html?id=...`) para posicionar cada trabajo.
- [ ] Testimonios de organizaciones con las que sí se haya trabajado.

---

## Fase 8 — Panel de administración — **hecho**

- [x] Login con contraseña en cookie firmada HMAC-SHA256, `HttpOnly` + `SameSite=Lax`.
- [x] Multiusuario con bcrypt. Dos roles: `admin` crea usuarios, `editor` edita.
- [x] Arranque en frío: con el registro vacío, el panel deja crear el primer
      admin sin sesión. Se cierra solo en cuanto existe un usuario.
- [x] Editor de proyectos: crear, editar, borrar, previsualizar la imagen.
- [x] Los cambios se acumulan y se publican con un botón, no se guardan solos.
- [x] Sin API el panel avisa de que está en solo lectura, en vez de fallar en silencio.
- [x] Contenido inyectado con `textContent`. Hay prueba de XSS.
- [x] Contenido escrito a GitHub o a SQLite según el adaptador activo.
- [x] El registro de usuarios sube al repo **cifrado** (AES-256-GCM, clave derivada
      de `SESSION_SECRET`). El repo es público y los hashes no se enseñan.

Pendiente:

- [ ] **Probar `docker compose up` en una máquina con Docker.** El YAML es válido
      y Express está probado en local, pero la imagen nunca se construyó.
- [ ] Probar el despliegue en Vercel con las cuatro variables de entorno.
- [ ] Averiguar quién se pierde una contraseña: no hay recuperación.
- [ ] Guardar quién hizo cada cambio, no solo qué. El commit lo dice si el
      `GITHUB_TOKEN` es de una persona identificable.

---

## Cómo añadir una categoría

Hay dos caminos:

1. **Desde el panel** (`admin.html`): botón «+ Añadir categoría», luego_publicar».
2. **Editando `data/projects.json`** a mano y empujando el cambio.

El sitio público lee las categorías de ahí y **solo muestra las que tengan al
menos un proyecto**, así que una categoría vacía no aparece como pestaña inútil.
El bloque `.filters` en `index.html` es el respaldo para cuando no hay backend.

## Backlog

- [ ] Multiidioma (ES/EN) con `hreflang`. **Más probable ahora**: el público de
      festival y marca es casi siempre de EE. UU.
- [ ] Página de detalle por proyecto, para indexar cada trabajo.
- [ ] Subir los vídeos a Vimeo y embeber solo el `iframe`.

---

## Deuda de marca — leer antes de publicar

`MANUAL-DE-MARCA.md` §2 dice que Multimedios es un proyecto co-curricular
estudiantil y prohíbe presentarse como agencia. Este sitio hace las dos cosas:
el hero habla como productora y la sección `#ecfr` aclara qué es.

**Esto funciona mientras el anexo se lea.** Falla si alguien comparte el hero en
LinkedIn o en un pitch a un cliente: lo que se ve es «casa productora», y quien
lo lee no sabe que detrás hay un equipo estudiantil de la ECFR.

Dos salidas, y hay que elegir una antes de publicar:

1. **Reforzar el anexo.** Subirlo sobre el hero, o poner «Multimedios ECFR» en el
   `title` y en cada tarjeta. Convierte el hero en un pie de foto que siempre
   viaja con la página.
2. **Asumir el relato comercial.** Entonces el `MANUAL-DE-MARCA.md` §2, §5 y §10
   están desactualizados y hay que reescribirlos. La sección `#ecfr` del sitio
   también.

Lo que **no** funciona: publicar como está y confiar en que el anexo aparece. En
cualquier pantalla compartida, el anexo no aparece.
