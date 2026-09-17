/* Nodo: "Code - Armar consulta"  (workflow tes/presupuestos)

   Un catálogo cerrado de acciones. El SQL de cada una es una CADENA
   LITERAL de este archivo: lo único que viene del cliente son VALORES,
   y viajan como $1, $2… Nada de lo que manda el navegador se concatena
   nunca dentro del SQL.

   Los tres invariantes que se cumplen aquí y no en el navegador:

   1. El permiso va en el WHERE. Si el WHERE no deja pasar el renglón,
      la consulta toca cero renglones y la respuesta es un rechazo.
   2. El vencimiento del préstamo se mide contra now() del SERVIDOR.
   3. Cada cambio escribe su bitácora en la MISMA sentencia. Una sola
      sentencia es una sola transacción: si bitacora_escribir truena,
      el UPDATE se va con ella. Por eso el SELECT final siempre
      referencia el CTE 'log' — un CTE que nadie mira no se ejecuta. */

const s = $input.first().json || {};
const pet = $('Code - Leer petición').first().json || {};
const d = pet.datos || {};

const no = (err) => [{ json: { ok: false, error: err, sql: 'SELECT 0 AS afectadas WHERE false', params: [] } }];
if (!s.ok) return no(s.error || 'NO_AUTORIZADO');
// Sigue solo quien está en la lista. Escrito así y no como
// `if (s.rol === 'mama') rechaza` para que un rol nuevo —o un rol
// ausente— quede FUERA por omisión, no dentro.
if (!(s.rol === 'admin' || s.rol === 'rep')) return no('ROL_SIN_PERMISO');

/* Quién puede EDITAR un presupuesto. Copia fiel de puedeEditarPres()
   del navegador, pero aquí es la que manda:
     - la tesorera general, siempre
     - la representante de ese grupo, si no está confirmado
     - la representante a la que se lo prestaron, mientras el préstamo
       siga vivo CONTRA now() DEL SERVIDOR                              */
const PUEDE_EDITAR = `(
  $2::text = 'admin' OR (
    $2::text = 'rep' AND p.estado = 'creacion' AND (
      p.grupo_id = $3::bigint OR
      (p.prestado_a_grupo_id = $3::bigint AND p.prestamo_hasta > now())
    )
  )
)`;

/* Quién puede CONFIRMAR o DEVOLVER.
   Uno de generación solo lo confirma admin. Uno de salón lo confirma la
   representante de ESE grupo, y por eso queda como tesorera del evento. */
const PUEDE_CONFIRMAR = `(
  $2::text = 'admin' OR
  (p.tipo = 'salon' AND $2::text = 'rep' AND p.grupo_id = $3::bigint)
)`;

/* Dueño del presupuesto: prestar y quitar préstamo. */
const ES_DUENO = `($2::text = 'admin' OR ($2::text = 'rep' AND p.grupo_id = $3::bigint))`;

/* El total que se congela. Se calcula EN LA BASE a partir de los
   conceptos guardados, no de un número que mande el navegador: si
   viniera del cliente, el total congelado sería lo que el cliente
   quiera que sea. */
const TOTAL = `(SELECT COALESCE(SUM((c->>'q')::numeric * (c->>'u')::numeric), 0)
                  FROM jsonb_array_elements(p.conceptos) c)`;

const LOG = (accion, tabla) => `
  , log AS (
      SELECT bitacora_escribir($1::bigint, '${accion}', '${tabla}', u.id,
                               (SELECT j FROM antes), u.j, $4::text) AS bid
        FROM upd u
    )`;

const CIERRE = `SELECT (SELECT count(*) FROM upd) AS afectadas,
                       (SELECT max(id) FROM upd)   AS id,
                       (SELECT count(*) FROM log)  AS logs`;

// $1 persona_id · $2 rol · $3 grupo_id · $4 ip · $5 ciclo_id · $6+ datos
const base = [s.persona_id, s.rol, s.grupo_id, pet.ip || null, s.ciclo_id];
let sql, params;

switch (pet.accion) {

  case 'crear': {
    const tipo = d.tipo === 'salon' ? 'salon' : 'generacion';
    const grupo = d.grupo_id;
    if (!grupo) return no('FALTA_GRUPO');
    sql = `
      WITH antes AS (SELECT NULL::jsonb AS j)
      , upd AS (
          INSERT INTO presupuestos (ciclo_id, grupo_id, nombre, fecha, tipo, estado)
          SELECT $5::bigint, $7::bigint, $6::text, $8::date, $9::text, 'creacion'
           WHERE ($2::text = 'admin' OR ($2::text = 'rep' AND $7::bigint = $3::bigint))
             AND EXISTS (SELECT 1 FROM grupos g WHERE g.id = $7::bigint AND g.ciclo_id = $5::bigint)
          RETURNING id, to_jsonb(presupuestos.*) AS j
        )${LOG('crear', 'presupuestos')}
      ${CIERRE}`;
    params = base.concat([String(d.nombre || ''), grupo, d.fecha || null, tipo]);
    break;
  }

  case 'editar': {
    // Un solo UPDATE con COALESCE: lo que no venga en el parche se
    // queda como está. Así el mismo SQL sirve para el nombre, para los
    // conteos y para los conceptos, sin armar SET dinámicos.
    sql = `
      WITH antes AS (SELECT to_jsonb(p.*) AS j FROM presupuestos p WHERE p.id = $6::bigint)
      , upd AS (
          UPDATE presupuestos p SET
            nombre      = COALESCE($7::text,    p.nombre),
            fecha       = COALESCE($8::date,    p.fecha),
            responsable = COALESCE($9::text,    p.responsable),
            ninos       = COALESCE($10::int,    p.ninos),
            ninas       = COALESCE($11::int,    p.ninas),
            adultos     = COALESCE($12::int,    p.adultos),
            banco       = COALESCE($13::text,   p.banco),
            clabe       = COALESCE($14::text,   p.clabe),
            titular     = COALESCE($15::text,   p.titular),
            conceptos   = COALESCE($16::jsonb,  p.conceptos),
            actualizado_en = now()
          WHERE p.id = $6::bigint AND p.ciclo_id = $5::bigint AND ${PUEDE_EDITAR}
          RETURNING p.id, to_jsonb(p.*) AS j
        )${LOG('editar', 'presupuestos')}
      ${CIERRE}`;
    params = base.concat([
      d.id, nul(d.nombre), nul(d.fecha), nul(d.responsable),
      nulNum(d.ninos), nulNum(d.ninas), nulNum(d.adultos),
      nul(d.banco), nul(d.clabe), nul(d.titular),
      d.conceptos === undefined ? null : JSON.stringify(d.conceptos)
    ]);
    break;
  }

  case 'eliminar':
    sql = `
      WITH antes AS (SELECT to_jsonb(p.*) AS j FROM presupuestos p WHERE p.id = $6::bigint)
      , upd AS (
          DELETE FROM presupuestos p
           WHERE p.id = $6::bigint AND p.ciclo_id = $5::bigint AND ${PUEDE_EDITAR}
             -- Un presupuesto con evento no se borra: se borraría el
             -- historial de gastos junto con él.
             AND NOT EXISTS (SELECT 1 FROM eventos e WHERE e.presupuesto_id = p.id)
          RETURNING p.id, to_jsonb(p.*) AS j
        )${LOG('eliminar', 'presupuestos')}
      ${CIERRE}`;
    params = base.concat([d.id]);
    break;

  case 'confirmar':
    // Confirmar hace DOS cosas en una sola sentencia: marca el
    // presupuesto y crea el evento con su total CONGELADO. Si algo de
    // eso falla, no queda ni lo uno ni lo otro.
    sql = `
      WITH antes AS (SELECT to_jsonb(p.*) AS j FROM presupuestos p WHERE p.id = $6::bigint)
      , upd AS (
          UPDATE presupuestos p
             SET estado = 'confirmado',
                 prestado_a_grupo_id = NULL, prestamo_hasta = NULL,
                 actualizado_en = now()
           WHERE p.id = $6::bigint AND p.ciclo_id = $5::bigint
             AND p.estado = 'creacion' AND ${PUEDE_CONFIRMAR}
          RETURNING p.id, to_jsonb(p.*) AS j, p.nombre, p.fecha, p.tipo, p.grupo_id, ${TOTAL} AS total
        )
      , ev AS (
          INSERT INTO eventos (presupuesto_id, nombre, fecha, tipo, grupo_id, total_congelado)
          SELECT u.id, u.nombre, u.fecha, u.tipo,
                 CASE WHEN u.tipo = 'salon' THEN u.grupo_id END,
                 u.total
            FROM upd u
          -- Si ya había evento (doble clic en Confirmar), no se crea otro.
          ON CONFLICT (presupuesto_id) DO NOTHING
          RETURNING id
        )${LOG('confirmar', 'presupuestos')}
      SELECT (SELECT count(*) FROM upd) AS afectadas,
             (SELECT max(id) FROM ev)   AS id,
             (SELECT count(*) FROM log) AS logs`;
    params = base.concat([d.id]);
    break;

  case 'devolver':
    sql = `
      WITH antes AS (SELECT to_jsonb(p.*) AS j FROM presupuestos p WHERE p.id = $6::bigint)
      , upd AS (
          UPDATE presupuestos p SET estado = 'creacion', actualizado_en = now()
           WHERE p.id = $6::bigint AND p.ciclo_id = $5::bigint
             AND p.estado = 'confirmado' AND ${PUEDE_CONFIRMAR}
          RETURNING p.id, to_jsonb(p.*) AS j
        )${LOG('devolver', 'presupuestos')}
      ${CIERRE}`;
    params = base.concat([d.id]);
    break;

  case 'prestar':
    // Los días los pone el SERVIDOR sobre su propio reloj. Si la fecha
    // de vencimiento viniera del cliente, prestar por un día y por un
    // año serían la misma petición con otro número.
    sql = `
      WITH antes AS (SELECT to_jsonb(p.*) AS j FROM presupuestos p WHERE p.id = $6::bigint)
      , upd AS (
          UPDATE presupuestos p
             SET prestado_a_grupo_id = $7::bigint,
                 prestamo_hasta = now() + ($8::int * INTERVAL '1 day'),
                 actualizado_en = now()
           WHERE p.id = $6::bigint AND p.ciclo_id = $5::bigint
             AND p.estado = 'creacion' AND ${ES_DUENO}
             AND $8::int BETWEEN 1 AND 90
             AND EXISTS (SELECT 1 FROM grupos g WHERE g.id = $7::bigint AND g.ciclo_id = $5::bigint)
          RETURNING p.id, to_jsonb(p.*) AS j
        )${LOG('prestar', 'presupuestos')}
      ${CIERRE}`;
    params = base.concat([d.id, d.grupo_id, Math.round(Number(d.dias) || 0)]);
    break;

  case 'quitar_prestamo':
    sql = `
      WITH antes AS (SELECT to_jsonb(p.*) AS j FROM presupuestos p WHERE p.id = $6::bigint)
      , upd AS (
          UPDATE presupuestos p
             SET prestado_a_grupo_id = NULL, prestamo_hasta = NULL, actualizado_en = now()
           WHERE p.id = $6::bigint AND p.ciclo_id = $5::bigint AND ${ES_DUENO}
          RETURNING p.id, to_jsonb(p.*) AS j
        )${LOG('quitar_prestamo', 'presupuestos')}
      ${CIERRE}`;
    params = base.concat([d.id]);
    break;

  default:
    return no('ACCION_DESCONOCIDA');
}

function nul(v) { return v === undefined || v === null ? null : String(v); }
function nulNum(v) { return v === undefined || v === null ? null : Math.round(Number(v) || 0); }

return [{ json: { ok: true, sql: sql, params: params } }];
