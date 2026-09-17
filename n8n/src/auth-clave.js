/* Nodo: "Code - Verificar clave"  (workflow tes/auth)

   Compara la contraseña contra el hash y decide qué sigue. **NO ve el
   secreto del JWT**: si el login es bueno, el token lo firma el subflujo
   tes/validar-token, que es el único que alcanza ese secreto.

   ⚠️ try/catch total de todos modos: la entrada trae el hash de la
   persona. No es el secreto que abre todo, pero tampoco tiene por qué
   acabar en el historial de ejecuciones si algo truena.

   Nota de diseño sobre el cambio de contraseña: NO se verifica la firma
   del JWT, y es a propósito. Se exige la contraseña ACTUAL, que es
   prueba de identidad más fuerte que el token. El persona_id sale del
   token sin verificar, pero mentir ahí no sirve de nada: para cambiarle
   la contraseña a alguien habría que saber la suya, y con eso se podría
   entrar de todos modos. Verificar la firma no agregaría nada y
   obligaría a que tes/auth alcanzara el secreto. */

// <<<LIB_CRIPTO>>>

const MAX_INTENTOS = 3;         // por minuto y por usuario
const VENTANA_MS = 60 * 1000;

let respuesta = null;
let sql = 'SELECT 0 AS afectadas WHERE false';
let params = [];
let firmarPersonaId = 0;        // 0 = no se firma nada

try {
  const fila = $input.first().json || {};
  const pet = $('Code - Leer petición').first().json || {};
  const d = pet.datos || {};

  /* ---------------- LOGIN ---------------- */
  if (pet.accion === 'login') {
    const usuario = String(d.usuario || '').trim().toUpperCase();

    // El contador vive en staticData, o sea en la instancia de n8n, no
    // en la base: un intento fallido no tiene por qué costar una
    // escritura. Se pierde si n8n reinicia, y está bien — es un freno
    // contra adivinar contraseñas, no una bitácora.
    const st = $getWorkflowStaticData('global');
    if (!st.intentos) st.intentos = {};
    const ahora = Date.now();
    const reg = st.intentos[usuario] || { n: 0, desde: ahora };
    if (ahora - reg.desde > VENTANA_MS) { reg.n = 0; reg.desde = ahora; }

    if (reg.n >= MAX_INTENTOS) {
      st.intentos[usuario] = reg;
      respuesta = { ok: false, error: 'DEMASIADOS_INTENTOS',
                    mensaje: 'Demasiados intentos. Espera un minuto y vuelve a probar.' };
    } else {
      const buena = fila.hash ? verificaClave(String(d.clave || ''), fila.hash) : false;

      // Mismo mensaje para "no existe" y para "contraseña mala". Si se
      // distinguieran, cualquiera podría averiguar qué usuarios existen
      // probando nombres.
      if (!buena || !fila.id) {
        reg.n += 1;
        st.intentos[usuario] = reg;
        respuesta = { ok: false, error: 'CREDENCIALES',
                      mensaje: 'Usuario o contraseña incorrectos.' };
      } else {
        delete st.intentos[usuario];
        // Contraseña correcta. El resto —que exista ciclo, que tenga
        // membresía, que la cuenta esté activa— lo comprueba el subflujo
        // al firmar, que es donde ya vive esa lógica. Aquí no se repite.
        firmarPersonaId = Number(fila.id);
        respuesta = null;   // la arma "Code - Responder auth" con el token
      }
    }

  /* ------------- CAMBIO DE CONTRASEÑA ------------- */
  } else if (pet.accion === 'password') {
    const nueva = String(d.nueva || '');

    if (!fila.id) {
      respuesta = { ok: false, error: 'TOKEN_MAL_FORMADO' };
    } else if (!verificaClave(String(d.actual || ''), fila.hash || '')) {
      // Se exige la actual aunque traiga token: un celular prestado o
      // desbloqueado no debe poder dejar a nadie fuera de su cuenta.
      respuesta = { ok: false, error: 'CREDENCIALES',
                    mensaje: 'La contraseña actual no es correcta.' };
    } else if (nueva.length < 8) {
      respuesta = { ok: false, error: 'CLAVE_CORTA',
                    mensaje: 'La contraseña nueva tiene que ser de al menos 8 caracteres.' };
    } else {
      // Sal NUEVA cada vez. Reusar la anterior haría que dos contraseñas
      // iguales dieran el mismo hash.
      const sal = [];
      for (let i = 0; i < 16; i++) sal.push(Math.floor(Math.random() * 256));
      const hash = hashClave(nueva, b64u(new Uint8Array(sal)));

      sql = `
        WITH antes AS (SELECT jsonb_build_object('hash','(anterior)') AS j)
        , upd AS (
            UPDATE personas p SET hash = $2::text
             WHERE p.id = $1::bigint AND $2::text LIKE 'pbkdf2$%'
            RETURNING p.id, jsonb_build_object('hash','(cambiado)') AS j
          )
        , log AS (
            SELECT bitacora_escribir($1::bigint, 'password', 'personas', u.id,
                                     (SELECT j FROM antes), u.j, $3::text) AS bid
              FROM upd u
          )
        SELECT (SELECT count(*) FROM upd) AS afectadas, (SELECT count(*) FROM log) AS logs`;
      params = [Number(fila.id), hash, pet.ip || null];
      respuesta = { ok: true, mensaje: 'Contraseña actualizada.' };
    }

  } else {
    respuesta = { ok: false, error: 'ACCION_DESCONOCIDA' };
  }
} catch (e) {
  respuesta = { ok: false, error: 'AUTH_FALLO' };
}

/* Lo que sale NO trae ni el hash ni ningún secreto: solo el SQL con sus
   parámetros (el hash nuevo es irreversible), a quién firmar, y la
   respuesta ya redactada para los casos que no necesitan token. */
return [{ json: { sql: sql, params: params,
                  firmar_persona_id: firmarPersonaId,
                  _respuesta: respuesta } }];
