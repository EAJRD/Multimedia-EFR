/* ============================================
   Helpers de respuesta, compartidos por la API.
   Los handlers usan la firma (req, res) de Node, que
   Vercel y Express entienden igual.
   ============================================ */

export function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

export function fail(res, status, message, extra = {}) {
  send(res, status, { error: message, ...extra });
}

export function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (c) => {
      size += c.length;
      // 1 MB es de sobra para este contenido y corta en abuso.
      if (size > 1024 * 1024) {
        reject(Object.assign(new Error('Cuerpo demasiado grande'), { code: 'TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('El cuerpo no es JSON válido'), { code: 'BAD_JSON' }));
      }
    });
    req.on('error', reject);
  });
}

/** Límite de intentos por IP y por endpoint. En memoria: suficiente para
 *  una sola instancia. Con varias réplicas haría falta Redis. */
const hits = new Map();

export function rateLimit({ windowMs = 15 * 60_000, max = 10 } = {}) {
  return function check(req, res, next) {
    const key = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'local';
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || now > entry.reset) {
      hits.set(key, { count: 1, reset: now + windowMs });
      return next();
    }
    if (++entry.count > max) {
      const retry = Math.ceil((entry.reset - now) / 1000);
      return fail(res, 429, `Demasiados intentos. Prueba en ${retry} segundos.`, { retryAfter: retry });
    }
    next();
  };
}

/** Envuelve un handler async y manda los errores a `fail` con el código
 *  que corresponde, sin filtrar detalles internos al cliente. */
export function guard(fn) {
  return async function handler(req, res) {
    try {
      await fn(req, res);
    } catch (e) {
      // Una promesa puede rechazar con cualquier valor, incluso undefined.
      const err = e instanceof Error ? e : new Error(String(e));
      if (err.code === 'TOO_LARGE') return fail(res, 413, err.message);
      if (err.code === 'BAD_JSON') return fail(res, 400, err.message);
      if (err.code === 'READ_ONLY') return fail(res, 503, err.message);
      console.error('[api]', err);
      return fail(res, 500, 'Error interno del servidor.');
    }
  };
}
