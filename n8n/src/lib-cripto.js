/* =====================================================================
   lib-cripto — SHA-256, HMAC, PBKDF2, base64url y JWT, en JS PURO.

   Por qué a mano: el sandbox de los nodos Code de n8n no expone
   `require`, ni `node:crypto`, ni `process`. No hay de dónde sacar una
   librería. Tampoco se asume `Buffer` ni `TextEncoder`: todo lo que
   sigue usa nada más Uint8Array, DataView, Math y JSON.

   Este archivo NO se edita en n8n. Se edita aquí y se reconstruye con
   n8n/build.py, que lo inyecta en los workflows que lo necesitan.
   ===================================================================== */

const K256 = [
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];

function rotr(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }

function sha256(msg) {
  const H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,
             0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const l = msg.length;
  const padLen = (((l + 9) + 63) & ~63);
  const m = new Uint8Array(padLen);
  m.set(msg);
  m[l] = 0x80;
  const dv = new DataView(m.buffer);
  // Longitud en BITS, 64 bits big-endian. Se parte en dos palabras de 32
  // porque l*8 se sale del entero seguro de JS mucho antes que el campo.
  dv.setUint32(padLen - 8, Math.floor(l / 536870912));
  dv.setUint32(padLen - 4, (l << 3) >>> 0);

  const w = new Uint32Array(64);
  for (let i = 0; i < padLen; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4);
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15], y = w[t - 2];
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K256[t] + w[t]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) odv.setUint32(i * 4, H[i]);
  return out;
}

function concatBytes(a, b) {
  const r = new Uint8Array(a.length + b.length);
  r.set(a); r.set(b, a.length);
  return r;
}

function hmacSha256(key, msg) {
  const B = 64;
  let k = key.length > B ? sha256(key) : key;
  const kp = new Uint8Array(B); kp.set(k);
  const ipad = new Uint8Array(B), opad = new Uint8Array(B);
  for (let i = 0; i < B; i++) { ipad[i] = kp[i] ^ 0x36; opad[i] = kp[i] ^ 0x5c; }
  return sha256(concatBytes(opad, sha256(concatBytes(ipad, msg))));
}

/* PBKDF2-HMAC-SHA256 con salida de 32 bytes (un solo bloque). */
function pbkdf2Sha256(pass, salt, iters) {
  const blk = concatBytes(salt, new Uint8Array([0, 0, 0, 1]));
  let u = hmacSha256(pass, blk);
  const out = new Uint8Array(u);
  for (let i = 1; i < iters; i++) {
    u = hmacSha256(pass, u);
    for (let j = 0; j < 32; j++) out[j] ^= u[j];
  }
  return out;
}

/* --- codificaciones ------------------------------------------------ */

function utf8Bytes(str) {
  const s = String(str);
  const out = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
      const c2 = s.charCodeAt(i + 1);
      if (c2 >= 0xDC00 && c2 <= 0xDFFF) { c = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00); i++; }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return new Uint8Array(out);
}

function utf8Str(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i];
    let c, n;
    if (b < 0x80) { c = b; n = 1; }
    else if ((b & 0xE0) === 0xC0) { c = b & 31; n = 2; }
    else if ((b & 0xF0) === 0xE0) { c = b & 15; n = 3; }
    else { c = b & 7; n = 4; }
    for (let j = 1; j < n; j++) c = (c << 6) | (bytes[i + j] & 63);
    if (c > 0xFFFF) {
      c -= 0x10000;
      s += String.fromCharCode(0xD800 + (c >> 10), 0xDC00 + (c & 1023));
    } else s += String.fromCharCode(c);
    i += n;
  }
  return s;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function b64Encode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    s += B64[b0 >> 2];
    s += B64[((b0 & 3) << 4) | ((b1 === undefined ? 0 : b1) >> 4)];
    s += b1 === undefined ? '=' : B64[((b1 & 15) << 2) | ((b2 === undefined ? 0 : b2) >> 6)];
    s += b2 === undefined ? '=' : B64[b2 & 63];
  }
  return s;
}

function b64Decode(str) {
  const s = String(str).replace(/[^A-Za-z0-9+/]/g, '');
  const out = [];
  for (let i = 0; i < s.length; i += 4) {
    const n = (B64.indexOf(s[i]) << 18) | (B64.indexOf(s[i + 1]) << 12) |
              ((i + 2 < s.length ? B64.indexOf(s[i + 2]) : 0) << 6) |
              (i + 3 < s.length ? B64.indexOf(s[i + 3]) : 0);
    out.push((n >> 16) & 255);
    if (i + 2 < s.length) out.push((n >> 8) & 255);
    if (i + 3 < s.length) out.push(n & 255);
  }
  return new Uint8Array(out);
}

const b64u  = (bytes) => b64Encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (str) => b64Decode(String(str).replace(/-/g, '+').replace(/_/g, '/'));

function hex(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
  return s;
}

/* Comparación en tiempo constante. Un `===` de cadenas se corta en el
   primer carácter distinto, y esa diferencia de tiempo es medible. */
function igualSeguro(a, b) {
  const A = String(a), B = String(b);
  let dif = A.length ^ B.length;
  const n = Math.max(A.length, B.length);
  for (let i = 0; i < n; i++) dif |= (A.charCodeAt(i) || 0) ^ (B.charCodeAt(i) || 0);
  return dif === 0;
}

/* --- contraseñas ---------------------------------------------------- */
/* Formato guardado en personas.hash, todo en una columna:
     pbkdf2$<iteraciones>$<sal en base64url>$<derivado en base64url>     */

const PBKDF2_ITERS = 100000;

function hashClave(clave, salB64u, iters) {
  const it = iters || PBKDF2_ITERS;
  const sal = salB64u ? unb64u(salB64u) : null;
  if (!sal) throw new Error('hashClave: falta la sal');
  return 'pbkdf2$' + it + '$' + b64u(sal) + '$' +
         b64u(pbkdf2Sha256(utf8Bytes(clave), sal, it));
}

function verificaClave(clave, guardado) {
  try {
    const p = String(guardado || '').split('$');
    if (p.length !== 4 || p[0] !== 'pbkdf2') return false;
    const iters = parseInt(p[1], 10);
    if (!(iters > 0 && iters <= 1000000)) return false;
    return igualSeguro(hashClave(clave, p[2], iters), guardado);
  } catch (e) { return false; }
}

/* --- JWT HS256 ------------------------------------------------------ */

function firmaJwt(payload, secreto, segundos) {
  const ahora = Math.floor(Date.now() / 1000);
  const cuerpo = Object.assign({}, payload, { iat: ahora, exp: ahora + segundos });
  const h = b64u(utf8Bytes(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const c = b64u(utf8Bytes(JSON.stringify(cuerpo)));
  const f = b64u(hmacSha256(utf8Bytes(secreto), utf8Bytes(h + '.' + c)));
  return h + '.' + c + '.' + f;
}

/* Devuelve {ok, payload, error}. NUNCA lanza: un token mal formado es un
   dato de entrada, no una falla del programa, y si lanzara, n8n metería
   la ENTRADA del nodo en el payload de error — y la entrada trae el
   secreto. Ver n8n/README.md, regla 2. */
function verificaJwt(token, secreto) {
  try {
    const p = String(token || '').split('.');
    if (p.length !== 3) return { ok: false, error: 'TOKEN_MAL_FORMADO' };

    const cab = JSON.parse(utf8Str(unb64u(p[0])));
    // Sin este candado, un token con alg:"none" pasaría sin firma.
    if (cab.alg !== 'HS256') return { ok: false, error: 'TOKEN_ALG_INVALIDO' };

    const esperada = b64u(hmacSha256(utf8Bytes(secreto), utf8Bytes(p[0] + '.' + p[1])));
    if (!igualSeguro(esperada, p[2])) return { ok: false, error: 'TOKEN_FIRMA_INVALIDA' };

    const cuerpo = JSON.parse(utf8Str(unb64u(p[1])));
    if (!cuerpo.exp || Math.floor(Date.now() / 1000) >= cuerpo.exp) {
      return { ok: false, error: 'TOKEN_VENCIDO' };
    }
    return { ok: true, payload: cuerpo };
  } catch (e) {
    return { ok: false, error: 'TOKEN_ILEGIBLE' };
  }
}
