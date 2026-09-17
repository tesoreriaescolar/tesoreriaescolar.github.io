/* Nodo: "Code - Resolver"  (workflow tes/auth)

   Login y cambio de contraseña. Aquí se compara la contraseña contra el
   HASH, se mintea el JWT y se calcula el hash nuevo.

   ⚠️ TODO va en try/catch, sin excepción. La entrada de este nodo trae
   el secreto del JWT y el hash de la persona; si el nodo lanzara, n8n
   guardaría su ENTRADA en el payload de error de la ejecución. Un nodo
   que no lanza no produce payload de error. Ver n8n/README.md regla 2.

   Y lo que sale hacia el nodo de Postgres NO lleva el token ni el
   secreto: el token se recoge después con $('Code - Resolver'), para
   que el nodo que sí puede tronar no lo tenga nunca en su entrada. */

// <<<LIB_CRIPTO>>>

const HORAS_TOKEN = 8;
const MAX_INTENTOS = 3;         // por minuto y por usuario
const VENTANA_MS = 60 * 1000;

let respuesta, sql = 'SELECT 0 AS afectadas WHERE false', params = [];

try {
  const fila = $input.first().json || {};
  const pet = $('Code - Leer petición').first().json || {};
  const d = pet.datos || {};
  const secreto = fila.jwt_secret;

  if (!secreto) {
    respuesta = { ok: false, error: 'CONFIG_SIN_SECRETO' };

  /* ---------------- LOGIN ---------------- */
  } else if (pet.accion === 'login') {
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
      } else if (!fila.ciclo_id) {
        respuesta = { ok: false, error: 'SIN_CICLO_ACTIVO',
                      mensaje: 'Todavía no hay un ciclo escolar activo. Habla con la tesorera.' };
      } else if (!fila.rol) {
        respuesta = { ok: false, error: 'SIN_MEMBRESIA',
                      mensaje: 'Tu cuenta no está dada de alta en el ciclo actual. Habla con la tesorera.' };
      } else if (fila.activo !== true) {
        respuesta = { ok: false, error: 'DESACTIVADA',
                      mensaje: 'Esta cuenta está desactivada. Habla con la tesorera.' };
      } else {
        delete st.intentos[usuario];
        const perm = fila.permisos || {};
        respuesta = {
          ok: true,
          token: firmaJwt({ persona_id: Number(fila.id) }, secreto, HORAS_TOKEN * 3600),
          sesion: {
            u: fila.usuario,
            nom: fila.nombre,
            rol: fila.rol,
            salon: fila.grupo_id === null || fila.grupo_id === undefined ? null : String(fila.grupo_id),
            tickets: perm.tickets === true,
            verPres: perm.ver_presupuesto === true,
            verTodos: perm.ver_todos_los_grupos === true
          }
        };
      }
    }

  /* ------------- CAMBIO DE CONTRASEÑA ------------- */
  } else if (pet.accion === 'password') {
    const v = verificaJwt(pet.token, secreto);
    const nueva = String(d.nueva || '');

    if (!v.ok) {
      respuesta = { ok: false, error: v.error };
    } else if (!fila.id || Number(v.payload.persona_id) !== Number(fila.id)) {
      respuesta = { ok: false, error: 'TOKEN_NO_CORRESPONDE' };
    } else if (!verificaClave(String(d.actual || ''), fila.hash || '')) {
      // Exigir la actual aunque ya traiga token: un celular prestado o
      // desbloqueado no debe poder dejar a nadie fuera de su cuenta.
      respuesta = { ok: false, error: 'CREDENCIALES',
                    mensaje: 'La contraseña actual no es correcta.' };
    } else if (nueva.length < 8) {
      respuesta = { ok: false, error: 'CLAVE_CORTA',
                    mensaje: 'La contraseña nueva tiene que ser de al menos 8 caracteres.' };
    } else {
      // La sal es NUEVA cada vez. Reusar la anterior haría que dos
      // contraseñas iguales dieran el mismo hash.
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

// Al nodo de Postgres SOLO le va el SQL y sus parámetros. El token y la
// sesión se quedan aquí y los recoge "Code - Responder auth".
return [{ json: { sql: sql, params: params, hay_escritura: params.length > 0,
                  _respuesta: respuesta } }];
