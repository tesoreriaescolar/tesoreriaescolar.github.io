/* Nodo: "Code - Armar consulta"  (workflow tes/admin)

   Personas, membresías, permisos, ciclos, grupos y el "pasar de año".
   TODO aquí es de la tesorera general.

   El corte se hace dos veces a propósito: aquí arriba, para no armar
   siquiera la consulta, y otra vez dentro de cada WHERE. La de arriba
   ahorra trabajo; la del WHERE es la que cuenta. */

const s = $input.first().json || {};
const pet = $('Code - Leer petición').first().json || {};
const d = pet.datos || {};

const no = (err) => [{ json: { ok: false, error: err, sql: 'SELECT 0 AS afectadas WHERE false', params: [] } }];
if (!s.ok) return no(s.error || 'NO_AUTORIZADO');
if (s.rol !== 'admin') return no('SOLO_ADMIN');

const ADMIN = `$2::text = 'admin'`;
const LOG = (accion, tabla) => `
  , log AS (
      SELECT bitacora_escribir($1::bigint, '${accion}', '${tabla}', u.id,
                               (SELECT j FROM antes), u.j, $4::text) AS bid
        FROM upd u
    )`;
const CIERRE = `SELECT (SELECT count(*) FROM upd) AS afectadas,
                       (SELECT max(id) FROM upd)  AS id,
                       (SELECT count(*) FROM log) AS logs`;

const base = [s.persona_id, s.rol, s.grupo_id, pet.ip || null, s.ciclo_id];
let sql, params;

switch (pet.accion) {

  /* Crea la persona Y su membresía del ciclo activo en una sentencia.
     Una persona sin membresía no puede entrar (validar-token devuelve
     SIN_MEMBRESIA_EN_CICLO), así que crearla suelta sería crear una
     cuenta muerta. */
  case 'persona_crear':
    sql = `
      WITH antes AS (SELECT NULL::jsonb AS j)
      , nueva AS (
          INSERT INTO personas (nombre, usuario, hash)
          SELECT $6::text, upper(btrim($7::text)), $8::text
           WHERE ${ADMIN} AND btrim($6::text) <> '' AND btrim($7::text) <> ''
             AND $8::text LIKE 'pbkdf2$%'
          RETURNING id, to_jsonb(personas.*) AS j
        )
      , upd AS (
          INSERT INTO membresias (persona_id, ciclo_id, grupo_id, rol, permisos, activo)
          SELECT n.id, $5::bigint, $9::bigint, $10::text, $11::jsonb, true
            FROM nueva n
          RETURNING persona_id AS id, to_jsonb(membresias.*) AS j
        )${LOG('persona_crear', 'personas')}
      ${CIERRE}`;
    params = base.concat([
      String(d.nombre || ''), String(d.usuario || ''), String(d.hash || ''),
      d.rol === 'admin' ? null : d.grupo_id,
      d.rol || 'mama', JSON.stringify(permisos(d.permisos))
    ]);
    break;

  /* Cambia rol, grupo, permisos o el activo de una membresía.
     El candado importante es el de la última línea: NADIE se edita a sí
     mismo. En el prototipo esto estaba amarrado al literal 'ADMIN'
     (línea 858); aquí se compara contra el persona_id del TOKEN, que es
     lo que de verdad identifica a quien pide. Sin esto, la tesorera
     general puede degradarse por error y dejar el sistema sin nadie que
     pueda arreglarlo. */
  case 'membresia_editar':
    sql = `
      WITH antes AS (
        SELECT to_jsonb(m.*) AS j FROM membresias m
         WHERE m.persona_id = $6::bigint AND m.ciclo_id = $5::bigint
      )
      , upd AS (
          UPDATE membresias m SET
            rol      = COALESCE($7::text,   m.rol),
            grupo_id = CASE WHEN COALESCE($7::text, m.rol) = 'admin' THEN NULL
                            ELSE COALESCE($8::bigint, m.grupo_id) END,
            permisos = COALESCE($9::jsonb,  m.permisos),
            activo   = COALESCE($10::boolean, m.activo)
          WHERE m.persona_id = $6::bigint AND m.ciclo_id = $5::bigint AND ${ADMIN}
            AND m.persona_id <> $1::bigint
          RETURNING m.persona_id AS id, to_jsonb(m.*) AS j
        )${LOG('membresia_editar', 'membresias')}
      ${CIERRE}`;
    params = base.concat([
      d.persona_id, d.rol || null,
      d.grupo_id === undefined ? null : d.grupo_id,
      d.permisos === undefined ? null : JSON.stringify(permisos(d.permisos)),
      d.activo === undefined ? null : !!d.activo
    ]);
    break;

  /* Cambiar la contraseña de otra persona. El hash llega YA CALCULADO
     desde tes/auth; aquí nunca pasa una contraseña en claro. */
  case 'persona_clave':
    sql = `
      WITH antes AS (SELECT jsonb_build_object('hash','(oculto)') AS j)
      , upd AS (
          UPDATE personas p SET hash = $7::text
           WHERE p.id = $6::bigint AND ${ADMIN} AND $7::text LIKE 'pbkdf2$%'
             AND EXISTS (SELECT 1 FROM membresias m
                          WHERE m.persona_id = p.id AND m.ciclo_id = $5::bigint)
          RETURNING p.id, jsonb_build_object('hash','(cambiado)') AS j
        )${LOG('persona_clave', 'personas')}
      ${CIERRE}`;
    params = base.concat([d.persona_id, String(d.hash || '')]);
    break;

  case 'grupo_crear':
    sql = `
      WITH antes AS (SELECT NULL::jsonb AS j)
      , upd AS (
          INSERT INTO grupos (ciclo_id, letra, nombre, color, orden)
          SELECT COALESCE($6::bigint, $5::bigint), upper(btrim($7::text)),
                 btrim($8::text), $9::text, COALESCE($10::int, 99)
           WHERE ${ADMIN}
          RETURNING id, to_jsonb(grupos.*) AS j
        )${LOG('grupo_crear', 'grupos')}
      ${CIERRE}`;
    params = base.concat([d.ciclo_id || null, String(d.letra || ''), String(d.nombre || ''),
                          String(d.color || '#4C6EF5'), d.orden === undefined ? null : Number(d.orden)]);
    break;

  case 'grupo_editar':
    sql = `
      WITH antes AS (SELECT to_jsonb(g.*) AS j FROM grupos g WHERE g.id = $6::bigint)
      , upd AS (
          UPDATE grupos g SET
            nombre = COALESCE(NULLIF(btrim($7::text), ''), g.nombre),
            color  = COALESCE($8::text, g.color),
            orden  = COALESCE($9::int,  g.orden)
          WHERE g.id = $6::bigint AND ${ADMIN}
          RETURNING g.id, to_jsonb(g.*) AS j
        )${LOG('grupo_editar', 'grupos')}
      ${CIERRE}`;
    params = base.concat([d.grupo_id, d.nombre === undefined ? null : String(d.nombre),
                          d.color === undefined ? null : String(d.color),
                          d.orden === undefined ? null : Number(d.orden)]);
    break;

  /* Borrar un grupo solo si está VACÍO. Las llaves foráneas son
     RESTRICT, así que la base lo impediría de todos modos; el NOT
     EXISTS está para que la respuesta sea un rechazo limpio y no el
     texto de un error de llave foránea. */
  case 'grupo_eliminar':
    sql = `
      WITH antes AS (SELECT to_jsonb(g.*) AS j FROM grupos g WHERE g.id = $6::bigint)
      , upd AS (
          DELETE FROM grupos g
           WHERE g.id = $6::bigint AND ${ADMIN}
             AND NOT EXISTS (SELECT 1 FROM membresias   m WHERE m.grupo_id = g.id)
             AND NOT EXISTS (SELECT 1 FROM presupuestos p WHERE p.grupo_id = g.id
                                                             OR p.prestado_a_grupo_id = g.id)
             AND NOT EXISTS (SELECT 1 FROM eventos      e WHERE e.grupo_id = g.id)
             AND NOT EXISTS (SELECT 1 FROM evento_grupo x WHERE x.grupo_id = g.id)
          RETURNING g.id, to_jsonb(g.*) AS j
        )${LOG('grupo_eliminar', 'grupos')}
      ${CIERRE}`;
    params = base.concat([d.grupo_id]);
    break;

  case 'ciclo_crear':
    sql = `
      WITH antes AS (SELECT NULL::jsonb AS j)
      , upd AS (
          INSERT INTO ciclos (nombre, grado, activo)
          SELECT btrim($6::text), btrim($7::text), false
           WHERE ${ADMIN} AND btrim($6::text) <> '' AND btrim($7::text) <> ''
          RETURNING id, to_jsonb(ciclos.*) AS j
        )${LOG('ciclo_crear', 'ciclos')}
      ${CIERRE}`;
    params = base.concat([String(d.nombre || ''), String(d.grado || '')]);
    break;

  /* Cambiar el ciclo activo. Va en dos CTE y no en un solo UPDATE
     porque el índice ciclos_un_solo_activo no perdona ni un instante
     con dos activos; probado contra Postgres, las dos formas pasan y
     ésta además deja el RETURNING que necesita la bitácora. */
  case 'ciclo_activar':
    sql = `
      WITH antes AS (SELECT to_jsonb(c.*) AS j FROM ciclos c WHERE c.id = $6::bigint)
      , apaga AS (
          UPDATE ciclos SET activo = false
           WHERE activo AND id <> $6::bigint AND ${ADMIN}
          RETURNING id
        )
      , upd AS (
          UPDATE ciclos c SET activo = true
           WHERE c.id = $6::bigint AND ${ADMIN}
             AND EXISTS (SELECT 1 FROM grupos g WHERE g.ciclo_id = c.id)
             AND EXISTS (SELECT 1 FROM membresias m
                          WHERE m.ciclo_id = c.id AND m.rol = 'admin' AND m.activo)
          RETURNING c.id, to_jsonb(c.*) AS j
        )${LOG('ciclo_activar', 'ciclos')}
      SELECT (SELECT count(*) FROM upd) AS afectadas,
             (SELECT max(id) FROM upd)  AS id,
             (SELECT count(*) FROM log) AS logs,
             (SELECT count(*) FROM apaga) AS apagados`;
    params = base.concat([d.ciclo_id]);
    break;

  /* PASAR DE AÑO. Todo en una sentencia:
       1. crea el ciclo nuevo (INACTIVO)
       2. copia los grupos del ciclo actual, con su color y su orden,
          renombrando el prefijo del grado (PS3A -> PS4A)
       3. copia las membresías ACTIVAS, cada quien al grupo de la misma
          letra, conservando rol y permisos

     Lo que NO hace, a propósito: NO activa el ciclo nuevo y NO toca
     nada del viejo. Los presupuestos, eventos y gastos del año pasado
     se quedan donde están, colgados de su ciclo — que es exactamente
     "sin perder el historial". Reasignas grupos y roles con calma, y
     cuando esté listo lo activas con ciclo_activar. */
  case 'pasar_de_ano':
    sql = `
      WITH antes AS (SELECT NULL::jsonb AS j)
      , nuevo AS (
          INSERT INTO ciclos (nombre, grado, activo)
          SELECT btrim($6::text), btrim($7::text), false
           WHERE ${ADMIN} AND btrim($6::text) <> '' AND btrim($7::text) <> ''
             AND NOT EXISTS (SELECT 1 FROM ciclos c WHERE c.nombre = btrim($6::text))
          RETURNING id, grado
        )
      , gr AS (
          INSERT INTO grupos (ciclo_id, letra, nombre, color, orden)
          SELECT n.id, g.letra,
                 -- PS3A con grado nuevo PS4 queda PS4A. Si el nombre no
                 -- empieza con el grado viejo, se deja tal cual y tú lo
                 -- corriges en Configuración: adivinar de más aquí
                 -- produce nombres raros que nadie entiende de dónde
                 -- salieron.
                 CASE WHEN g.nombre LIKE c.grado || '%'
                      THEN n.grado || substr(g.nombre, length(c.grado) + 1)
                      ELSE g.nombre END,
                 g.color, g.orden
            FROM nuevo n
            CROSS JOIN ciclos c
            JOIN grupos g ON g.ciclo_id = c.id
           WHERE c.id = $5::bigint
          RETURNING id, ciclo_id, letra
        )
      , upd AS (
          INSERT INTO membresias (persona_id, ciclo_id, grupo_id, rol, permisos, activo)
          SELECT m.persona_id, n.id,
                 (SELECT x.id FROM gr x WHERE x.letra = vg.letra),
                 m.rol, m.permisos, true
            FROM nuevo n
            JOIN membresias m ON m.ciclo_id = $5::bigint AND m.activo
            LEFT JOIN grupos vg ON vg.id = m.grupo_id
          RETURNING persona_id AS id, to_jsonb(membresias.*) AS j
        )${LOG('pasar_de_ano', 'ciclos')}
      SELECT (SELECT count(*) FROM upd)   AS afectadas,
             (SELECT max(id)  FROM nuevo) AS id,
             (SELECT count(*) FROM log)   AS logs,
             (SELECT count(*) FROM gr)    AS grupos_copiados`;
    params = base.concat([String(d.nombre || ''), String(d.grado || '')]);
    break;

  default:
    return no('ACCION_DESCONOCIDA');
}

/* Las tres llaves SIEMPRE, y siempre booleanas. La restricción
   membresias_permisos_ok las exige; esto evita que un parche a medias
   se convierta en un error de base en vez de un valor por omisión. */
function permisos(p) {
  const o = p && typeof p === 'object' ? p : {};
  return {
    tickets: o.tickets === true,
    ver_presupuesto: o.ver_presupuesto !== false,
    ver_todos_los_grupos: o.ver_todos_los_grupos === true
  };
}

return [{ json: { ok: true, sql: sql, params: params } }];
