# Multimedios

Sitio público + panel de administración para Multimedios ECFR.

- **Sitio público** (`index.html`): portafolio filtrable por categoría, formulario
  para organizaciones, anexo ECFR.
- **Panel** (`admin.html`): login, editor de proyectos y gestión de usuarios.
- **API** (`api/`): Express, funciona igual en Vercel y en Docker.
- **Contenido**: `data/projects.json` es la fuente de verdad. Si no hay backend,
  el sitio usa el HTML escrito a mano como respaldo.

---

## Arranque rápido en local

```bash
npm install
npm run create-user     # te pide nombre, email y contraseña
npm start               # http://localhost:3000
```

Sin `.env` el arranque falla a propósito: pide `SESSION_SECRET` para que las
sesiones no se puedan falsificar. Genera uno con `openssl rand -hex 32`.

## Pruebas

```bash
npm test      # 26 pruebas del sitio público
npm run test:api   # 48 pruebas de la API, el login y el panel
```

Las pruebas de la API levantan su propio servidor y su propia base de datos
temporal. No tocan `data/`.

---

## Desplegar en Vercel (para enseñarlo ya)

La forma más rápida, sin terminal:

1. Entra en [vercel.com/new](https://vercel.com/new) e importa
   `EAJRD/Multimedia-EFR`. Vercel detecta `vercel.json` solo.
2. En **Settings → Environment Variables** añade:

   | Nombre | Valor |
   |---|---|
   | `SESSION_SECRET` | el que generaste con `openssl rand -hex 32` |
   | `GITHUB_REPO` | `EAJRD/Multimedia-EFR` |
   | `GITHUB_TOKEN` | un token con permiso `contents:write` sobre ese repo |
   | `GITHUB_BRANCH` | `main` |

3. Despliega.

El `GITHUB_TOKEN` se puede crear en GitHub → **Settings → Developer settings →
Personal access tokens → Fine-grained**. Marca solo ese repositorio y solo
`Contents: Read and write`. **El token nunca llega al navegador**: lo usa solo
la función de servidor.

### Por qué GitHub guarda el contenido

Vercel no tiene disco: cada función arranca en frío y el sistema de archivos
se borra. Si el admin guardara en un archivo, los cambios se perderían. Escribiendo
`data/projects.json` en el repo, cada cambio es un commit: se ve en el historial
y se puede deshacer con `git revert`.

La alternativa es un repositorio **privado**, para que `data/users.json` con los
hashes bcrypt no quede visible.

---

## Desplegar con Docker (después)

```bash
cp .env.example .env          # define SESSION_SECRET
docker compose up -d --build
docker compose logs -f
```

El contenido vive en el volumen `datos`, en SQLite. No depende de GitHub.

El compose publica en `127.0.0.1:3000` a propósito: para exponerlo hace falta un
proxy inverso con TLS, no abrir el puerto. Si lo expones, ponlo detrás de Caddy
o nginx y pon `NODE_ENV=production` para que la cookie de sesión viaje con
`Secure`.

```bash
docker compose exec web node tools/create-user.mjs   # primer admin
docker compose down                                 # parar
docker compose down -v                              # parar y borrar los datos
```

> **El `Dockerfile` y el `docker-compose.yml` de este repositorio no se han
> podido probar**: la máquina donde se escribieron no tenía Docker. El YAML es
> válido y el servidor Express sí está probado en local, pero el primer
> `docker compose up` hay que supervisionarlo.

---

## Variables de entorno

| Variable | Para qué | Obligatoria |
|---|---|---|
| `SESSION_SECRET` | Firma las cookies de sesión | Sí |
| `GITHUB_REPO` | `usuario/repo` del contenido | Vercel |
| `GITHUB_TOKEN` | Escribe en ese repo | Vercel |
| `GITHUB_BRANCH` | Rama, por defecto `main` | No |
| `DATABASE_PATH` | Ruta del SQLite | Docker |
| `STORE` | `github` o `sqlite`; se deduce sola | No |
| `LOGIN_MAX_ATTEMPTS` | Intentos de login por IP, 25 en producción | No |

Sin ninguna de estas, el sitio arranca **en modo solo lectura**: muestra el
contenido pero el panel avisa de que no puede publicar.

---

## Cómo funciona la seguridad

- Contraseñas con **bcrypt** (12 rondas), nunca en claro ni reversible.
- Cookie de sesión **firmada con HMAC-SHA256**, `HttpOnly` y `SameSite=Lax`,
  `Secure` en producción. Firma verificada en tiempo constante.
- La sesión expira a las 12 horas.
- **El límite de intentos va por IP**, no global: un campus entero puede salir
  por la misma NAT y no es un ataque.
- Dos roles: `admin` crea usuarios, `editor` solo cambia contenido.
- Todo el contenido se inyecta con `textContent`, nunca con `innerHTML`. Hay una
  prueba que mete `<img src=x onerror=...>` como título y comprueba que se
  muestra literal.
- En Docker, `/admin.html` no se sirve sin sesión válida. En Vercel sí se sirve
  como archivo estático, pero no lleva ningún secreto: lo que protege de verdad
  es la API, que siempre pide sesión.

### Lo que este panel **no** hace

- No lleva registro de cambios con autor. Cada commit de GitHub dice quién lo
  hizo, pero solo si el token pertenece a una persona identificable.
- No hay recuperación de contraseña. Si se pierde, `npm run create-user` con
  el mismo email lo **rechaza**. Hay que borrar la entrada a mano de
  `data/users.json` y volver a crearla.
- El rate limit vive en memoria: con varias réplicas de Vercel el límite real
  es `réplicas × LOGIN_MAX_ATTEMPTS`. Para una it'd pasar por Redis.

---

## Estructura

```
index.html          sitio público
admin.html          panel
data/projects.json  contenido (fuente de verdad)
data/users.json     usuarios con hashes bcrypt
api/                funciones (Vercel) — _lib/ es lo compartido
server/index.js     Express: los mismos handlers, para Docker
css/  js/  img/     estilos, scripts, posters
tools/              pruebas, capturas, generador de placeholders
```

## Los posters de `img/`

Son marcadores, no fotos. Se regeneran con `npm run placeholders`. Hay que
sustituirlos por fotos reales de cada proyecto, en `.webp` y por debajo de
200 KB. Las reglas de imagen están en `MANUAL-DE-MARCA.md` §6.4.

## Antes de publicar

- [ ] `SESSION_SECRET` definido y **distinto** en cada entorno.
- [ ] `GITHUB_TOKEN` con el mínimo de permisos, en un repo privado si puede ser.
- [ ] Correo de contacto real. Ahora es `multimedios@example.com`.
- [ ] Los `XX+` del hero son cifras pendientes de confirmar.
- [ ] Fotos reales en `img/`.
- [ ] `politica-privacidad.html`: el checkbox del formulario promete una y no
      existe.
- [ ] Leer la "Deuda de marca" de `PLAN.md`.
