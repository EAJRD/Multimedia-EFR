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
npm test            # 26  sitio público
npm run test:api    # 54  API, login y panel, con navegador de verdad
npm run test:cold   # 11  arranque en frío: crear el primer admin
npm run test:caja   # 10  el registro de usuarios no sale en claro al repo

npm run test:all   # las cuatro, 101 en total
```

Las tres últimas levantan su propio servidor y su propia base de datos
temporal, y restauran `data/users.json` al terminar. `test:all` no puede
correr dos veces a la vez: compiten por el mismo archivo de usuarios.

---

## Desplegar en Vercel (para enseñarlo ya)

### Antes: el token de GitHub

El admin guarda cada cambio como un commit en el repo, así que Vercel necesita
un token que pueda escribir. Sin esto el panel abre pero no guarda nada.

En GitHub → **Settings → Developer settings → Personal access tokens →
Fine-grained tokens → Generate new token**:

- **Resource owner**: `EAJRD`
- **Repository access**: *Only select repositories* → `Multimedia-EFR`
- **Permissions → Repository permissions → Contents**: *Read and write*
- Caducidad: la que quieras. Ponle recordatorio en el calendario, porque al
  caducar el admin deja de guardar y avisa con un error en vez de callarse.

Copia el token. Se muestra una sola vez.

### Luego: el despliegue

1. Entra en [vercel.com/new](https://vercel.com/new), botón **Add New →
   Project**, e importa `EAJRD/Multimedia-EFR`. No hay que tocar Framework
   Preset ni Build Command: `vercel.json` ya lo define.
2. En **Settings → Environment Variables** añade las cuatro. Ojo al
   desplegador de abajo:

   | Nombre | Valor |
   |---|---|
   | `SESSION_SECRET` | una cadena de 64 caracteres, ver abajo |
   | `GITHUB_REPO` | `EAJRD/Multimedia-EFR` |
   | `GITHUB_TOKEN` | el token de la sección anterior |
   | `GITHUB_BRANCH` | `main` |

   En el desplegable **Environment** marca las tres: **Production**,
   **Preview** y **Development**. Con el valor por defecto solo quedan en
   Production, y cualquier redeploy de prueba se cae por falta de variables.
3. **Deploy**.

Para generar el `SESSION_SECRET`:

```bash
openssl rand -hex 32
```

O bien, para que no dependa de que tengas `openssl`:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

### Comprobar que funciona

1. Abre la URL de Vercel. La portada debe mostrar los 7 proyectos.
2. Abre `TU-URL/admin.html`. Como el registro de usuarios está vacío, debe
   aparecer **«Todavía no hay ningún usuario»** con un formulario. Crea el
   primer admin ahí: en Vercel no hay forma de crear usuarios por comando.
3. Entra, edita un proyecto, guarda. Después `git pull` en local: el cambio
   tiene que haber llegado como commit a `main`. Si sí, GitHub está leyendo y
   escribiendo bien y el despliegue está completo.

Ese primer admin es la única forma de crear el resto. **Anota la contraseña**:
no hay forma de recuperarla, solo de cambiarla desde el panel.

### Por qué GitHub guarda el contenido

Vercel no tiene disco: cada función arranca en frío y el sistema de archivos
se borra. Si el admin guardara en un archivo, los cambios se perderían. Escribiendo
`data/projects.json` en el repo, cada cambio es un commit: se ve en el historial
y se puede deshacer con `git revert`.

El registro de usuarios no va en claro, aunque el repo sea público: antes de
subirlo se cifra con AES-256-GCM usando una clave derivada de
`SESSION_SECRET` (`api/_lib/secret-box.js`). El archivo que sube al repo es
ilegible sin esa clave, que solo vive en las variables de Vercel. Aun así
**cambia el `SESSION_SECRET` si crees que se ha filtrado**: cambia es
exactamente lo que rompe la lectura del registro.

`data/users.json` está en `.gitignore`, así que un `git pull` normal no lo
trae. Lo que escribe la API sí se commitea, y por eso va cifrado.

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
