/* Nodo: "Code - Armar consulta"  (workflow tes/tesoreria)

   Recaudación, personas, gastos y tickets. Mismo contrato que
   tes/presupuestos: catálogo cerrado, SQL literal, valores por $n,
   permiso en el WHERE y bitácora en la misma sentencia.

   Quién es TESORERA de un evento, que es de quien depende casi todo
   aquí: la tesorera general siempre; y en un evento de salón, la
   representante de ESE grupo — la que lo confirmó. Es quien captura sus
   gastos, su recaudación y sus tickets. */

const s = $input.first().json || {};
const pet = $('Code - Leer petición').first().json || {};
const d = pet.datos || {};

const no = (err) => [{ json: { ok: false, error: err, sql: 'SELECT 0 AS afectadas WHERE false', params: [] } }];
if (!s.ok) return no(s.error || 'NO_AUTORIZADO');

// Sigue solo quien está en la lista. Escrito así y no como
// `if (s.rol === 'mama') rechaza` para que un rol nuevo —o un rol
// ausente— quede FUERA por omisión, no dentro.
if (!(s.rol === 'admin' || s.rol === 'rep')) return no('ROL_SIN_PERMISO');

/* Los permisos se EXIGEN, nunca se descartan.
 *
 * La forma `if (x && x.y !== true) rechaza` no corre cuando x falta: un
 * `permisos` vacío pasaba de largo. Es la misma forma del CHECK que
 * devolvía NULL y dejaba pasar justo el caso que existía para atrapar.
 * Aquí se escribe al revés: SIGUE solo si el permiso vale exactamente
 * true; cualquier otra cosa —ausente, nulo, la cadena "true"— rechaza. */
const tienePermiso = (llave) => !!(s.permisos && s.permisos[llave] === true);


/* Se escribe contra el evento, así que el predicado vive en una
   subconsulta sobre eventos. 'e' es el alias del evento. */
const ES_TESORERA = `(
  $2::text = 'admin' OR
  (e.tipo = 'salon' AND $2::text = 'rep' AND e.grupo_id = $3::bigint)
)`;

const EVENTO_MIO = `EXISTS (
  SELECT 1 FROM eventos e
    JOIN presupuestos pp ON pp.id = e.presupuesto_id
   WHERE e.id = $6::bigint AND pp.ciclo_id = $5::bigint AND ${ES_TESORERA}
)`;

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

  /* Recaudación y personas se guardan con UPSERT: la fila de
     evento_grupo puede no existir todavía (grupo creado a media
     operación, o evento sin capturar). evento_grupo no tiene columna
     'id' propia, así que la bitácora apunta al evento. */
  case 'recaudacion':
  case 'personas': {
    const esRec = pet.accion === 'recaudacion';
    sql = `
      WITH antes AS (
        SELECT to_jsonb(eg.*) AS j FROM evento_grupo eg
         WHERE eg.evento_id = $6::bigint AND eg.grupo_id = $7::bigint
      )
      , upd AS (
          INSERT INTO evento_grupo (evento_id, grupo_id, recaudado, adultos, ninos, ninas)
          SELECT $6::bigint, $7::bigint,
                 COALESCE($8::numeric, 0), COALESCE($9::int, 0),
                 COALESCE($10::int, 0), COALESCE($11::int, 0)
           WHERE ${EVENTO_MIO}
             AND EXISTS (SELECT 1 FROM grupos g WHERE g.id = $7::bigint AND g.ciclo_id = $5::bigint)
          ON CONFLICT (evento_id, grupo_id) DO UPDATE SET
            recaudado = COALESCE($8::numeric, evento_grupo.recaudado),
            adultos   = COALESCE($9::int,     evento_grupo.adultos),
            ninos     = COALESCE($10::int,    evento_grupo.ninos),
            ninas     = COALESCE($11::int,    evento_grupo.ninas),
            actualizado_en = now()
          RETURNING evento_id AS id, to_jsonb(evento_grupo.*) AS j
        )${LOG(esRec ? 'recaudacion' : 'personas', 'evento_grupo')}
      ${CIERRE}`;
    params = base.concat([
      d.evento_id, d.grupo_id,
      esRec ? num(d.recaudado) : null,
      esRec ? null : num(d.adultos),
      esRec ? null : num(d.ninos),
      esRec ? null : num(d.ninas)
    ]);
    break;
  }

  /* VENTANA ANTI-REPETIDO.

     El botón deshabilitado del navegador es cortesía, no garantía: no
     cubre que la petición llegue, el servidor la procese y la red se
     caiga antes de la respuesta —ahí la persona reintenta y son dos
     renglones—, ni dos aparatos, ni una recarga a media petición.

     Así que si ya hay un gasto IDÉNTICO en el mismo evento capturado
     hace menos de 20 segundos, no se inserta otro: se devuelve el que ya
     estaba, con `repetido` en true para que la pantalla lo diga.

     ⚠️ Lo que esto NO es: un candado. Dos peticiones de verdad
     simultáneas pueden no verse entre sí y colarse las dos. Cierra el
     caso real medido —el gasto 7, dos toques con 1.482 s de diferencia—
     no el teórico. El candado de verdad es una llave de envío con índice
     único, y va cuando haya otra razón para migrar el esquema.

     ⚠️ Y su costo, que es real: dos gastos idénticos LEGÍTIMOS dentro de
     la ventana —dos taxis de $150 el mismo día, mismo proveedor— se
     convierten en uno. Por eso 20 segundos y no cinco minutos, y por eso
     la pantalla avisa en vez de callarse.

     El gemelo se busca con el MISMO permiso que la inserción: sin eso,
     preguntar por un gasto ajeno confirmaría que existe. */
  case 'gasto_crear':
    sql = `
      WITH gemelo AS (
          SELECT g.id FROM gastos g
           WHERE g.evento_id = $6::bigint
             AND g.fecha_pago = $7::date
             AND g.descripcion = $8::text
             AND g.proveedor = COALESCE($9::text, '')
             AND g.monto = $10::numeric
             AND g.creado_en > now() - interval '20 seconds'
             AND ${EVENTO_MIO}
           ORDER BY g.id DESC LIMIT 1
        )
      , antes AS (SELECT NULL::jsonb AS j)
      , upd AS (
          INSERT INTO gastos (evento_id, fecha_pago, descripcion, proveedor, monto)
          SELECT $6::bigint, $7::date, $8::text, COALESCE($9::text, ''), $10::numeric
           WHERE ${EVENTO_MIO} AND $10::numeric > 0 AND btrim($8::text) <> ''
             AND NOT EXISTS (SELECT 1 FROM gemelo)
          RETURNING id, to_jsonb(gastos.*) AS j
        )${LOG('gasto_crear', 'gastos')}
      SELECT (SELECT count(*) FROM upd) + (SELECT count(*) FROM gemelo) AS afectadas,
             COALESCE((SELECT max(id) FROM upd), (SELECT id FROM gemelo)) AS id,
             (SELECT count(*) FROM log) AS logs,
             (SELECT count(*) FROM gemelo) > 0 AS repetido`;
    params = base.concat([d.evento_id, d.fecha || null, String(d.descripcion || ''),
                          String(d.proveedor || ''), num(d.monto)]);
    break;

  case 'gasto_eliminar':
    sql = `
      WITH antes AS (SELECT to_jsonb(g.*) AS j FROM gastos g WHERE g.id = $7::bigint)
      , upd AS (
          DELETE FROM gastos g
           WHERE g.id = $7::bigint AND g.evento_id = $6::bigint AND ${EVENTO_MIO}
          RETURNING g.id, to_jsonb(g.*) AS j
        )${LOG('gasto_eliminar', 'gastos')}
      ${CIERRE}`;
    params = base.concat([d.evento_id, d.gasto_id]);
    break;

  /* Guarda la LLAVE del ticket. La foto ya subió al bucket directo
     desde el celular; aquí solo queda el apuntador. Con llave NULL se
     quita el ticket (y los cuatro campos se van juntos, que es lo que
     exige gastos_ticket_ok). */
  case 'ticket_fijar':
    if (!tienePermiso('tickets')) return no('SIN_PERMISO_TICKETS');
    sql = `
      WITH antes AS (SELECT to_jsonb(g.*) AS j FROM gastos g WHERE g.id = $7::bigint)
      , upd AS (
          UPDATE gastos g SET
            ticket_key    = $8::text,
            ticket_nombre = CASE WHEN $8::text IS NULL THEN NULL ELSE COALESCE($9::text, 'ticket') END,
            ticket_por    = CASE WHEN $8::text IS NULL THEN NULL ELSE $10::text END,
            ticket_en     = CASE WHEN $8::text IS NULL THEN NULL ELSE now() END
          WHERE g.id = $7::bigint AND g.evento_id = $6::bigint AND ${EVENTO_MIO}
          RETURNING g.id, to_jsonb(g.*) AS j
        )${LOG('ticket', 'gastos')}
      ${CIERRE}`;
    params = base.concat([d.evento_id, d.gasto_id, d.ticket_key || null,
                          d.nombre || null, s.nombre]);
    break;

  /* Las dos de URL firmada NO escriben. Lo único que hacen en la base
     es comprobar el permiso y traer la llave; la firma la calcula el
     nodo siguiente. Van por aquí y no por un atajo justamente para que
     el permiso se resuelva en el mismo WHERE que todo lo demás. */
  case 'ticket_subir_url':
  case 'ticket_ver_url': {
    const subir = pet.accion === 'ticket_subir_url';
    if (subir && !tienePermiso('tickets')) return no('SIN_PERMISO_TICKETS');
    sql = `
      SELECT g.id AS gasto_id, g.ticket_key,
             -- De config_app, NO de config: app_rw no alcanza el
             -- secreto del JWT ni por accidente.
             (SELECT valor FROM config_app WHERE clave = 's3_endpoint') AS s3_endpoint,
             (SELECT valor FROM config_app WHERE clave = 's3_region')   AS s3_region,
             (SELECT valor FROM config_app WHERE clave = 's3_bucket')   AS s3_bucket,
             (SELECT valor FROM config_app WHERE clave = 's3_key_id')   AS s3_key_id,
             (SELECT valor FROM config_app WHERE clave = 's3_secret')   AS s3_secret,
             (SELECT valor FROM config_app WHERE clave = 's3_estilo')   AS s3_estilo
        FROM gastos g
       WHERE g.id = $7::bigint AND g.evento_id = $6::bigint AND ${EVENTO_MIO}`;
    params = base.concat([d.evento_id, d.gasto_id]);
    return [{ json: { ok: true, sql: sql, params: params, firmar: subir ? 'PUT' : 'GET',
                      nombre_archivo: String(d.nombre || '') } }];
  }

  /* Borrar un evento es de la tesorera general y nada más. Se lleva sus
     gastos y su recaudación por ON DELETE CASCADE; el presupuesto se
     queda, como dice el aviso de la pantalla. */
  case 'evento_eliminar':
    if (s.rol !== 'admin') return no('SOLO_ADMIN');
    sql = `
      WITH antes AS (SELECT to_jsonb(e.*) AS j FROM eventos e WHERE e.id = $6::bigint)
      , upd AS (
          DELETE FROM eventos e
           USING presupuestos pp
           WHERE e.id = $6::bigint AND pp.id = e.presupuesto_id AND pp.ciclo_id = $5::bigint
          RETURNING e.id, to_jsonb(e.*) AS j
        )${LOG('evento_eliminar', 'eventos')}
      ${CIERRE}`;
    params = base.concat([d.evento_id]);
    break;

  default:
    return no('ACCION_DESCONOCIDA');
}

function num(v) { return v === undefined || v === null || v === '' ? null : Number(v); }

return [{ json: { ok: true, sql: sql, params: params } }];
