/* Nodo: "Code - Armar consulta"  (workflow tes/lectura)

   Devuelve TODO lo que esa sesión puede ver, en una sola consulta y en
   un solo renglón de JSON. El frontend lo usa para llenar su caché.

   ⚠️ El filtrado por grupo va en el WHERE, no filtrando la respuesta.
   Si el WHERE no lo excluye, el dato ya salió de la base y cualquier
   filtro posterior es decoración: quien mire la respuesta cruda en el
   navegador lo ve igual. Por eso el predicado de visibilidad está
   escrito UNA vez, abajo, y se pega a las dos consultas que lo
   necesitan. */

const s = $input.first().json || {};

if (!s.ok) {
  // Sin sesión no se consulta nada. La consulta tiene que ser válida
  // igual (el nodo de Postgres corre siempre), así que devuelve vacío.
  return [{ json: {
    ok: false, error: s.error || 'NO_AUTORIZADO',
    sql: "SELECT NULL::json AS datos WHERE false", params: []
  } }];
}

/* $1 ciclo_id · $2 rol · $3 grupo_id · $4 ve_todos_los_grupos
   Una mamá ve los eventos de generación MÁS los de su propio grupo.
   Nunca los de otro grupo. Eso es exactamente lo que dice esta línea. */
// Un solo sitio donde se normalizan los permisos. Antes se leían de
// `s.permisos` directo en cuatro líneas, y bastaba que faltara el objeto
// para que la consulta lanzara en vez de devolver una sesión sin nada.
const perm = s.permisos || {};

const VISIBLE = (t) =>
  `($2::text = 'admin' OR $4::boolean OR ${t}.tipo = 'generacion' OR ${t}.grupo_id = $3::bigint)`;

const sql = `
SELECT json_build_object(

  -- Quién es quien pregunta, tal como lo resolvió tes/validar-token.
  -- Va aquí para que recargar la página no obligue a volver a entrar:
  -- con el token guardado basta una lectura para reconstruir la sesión.
  -- Viaja como PARÁMETRO ($5), no pegado dentro del SQL.
  'sesion', $5::json,

  'ciclo', (SELECT json_build_object('id', c.id::text, 'nombre', c.nombre, 'grado', c.grado)
              FROM ciclos c WHERE c.id = $1::bigint),

  -- Los grupos. De aquí se llena SALONES en el navegador: número,
  -- nombre y color salen de la base, nunca del código.
  'grupos', (SELECT COALESCE(json_agg(json_build_object(
                      'id', g.id::text, 'letra', g.letra,
                      'nom', g.nombre, 'color', g.color
                    ) ORDER BY g.orden, g.letra), '[]'::json)
               FROM grupos g WHERE g.ciclo_id = $1::bigint),

  -- La lista de TODOS los ciclos, para la pantalla de Configuración.
  -- Solo admin, y vacía desde la base para los demás.
  'ciclos', (SELECT COALESCE(json_agg(json_build_object(
                     'id', c.id::text, 'nombre', c.nombre, 'grado', c.grado,
                     'activo', c.activo,
                     'grupos', (SELECT count(*) FROM grupos g WHERE g.ciclo_id = c.id),
                     'personas', (SELECT count(*) FROM membresias m WHERE m.ciclo_id = c.id)
                   ) ORDER BY c.creado_en DESC), '[]'::json)
              FROM ciclos c WHERE $2::text = 'admin'),

  -- El padrón solo lo ve la tesorera general. Para los demás va vacío,
  -- y va vacío DESDE LA BASE, no recortado después.
  'usuarios', (SELECT COALESCE(json_agg(json_build_object(
                        'id', p.id::text, 'u', p.usuario, 'nom', p.nombre,
                        'rol', m.rol, 'salon', m.grupo_id::text,
                        'tickets', (m.permisos->>'tickets')::boolean,
                        'verPres', (m.permisos->>'ver_presupuesto')::boolean,
                        'verTodos', (m.permisos->>'ver_todos_los_grupos')::boolean,
                        'activo', m.activo
                      ) ORDER BY m.rol, p.usuario), '[]'::json)
                 FROM personas p
                 JOIN membresias m ON m.persona_id = p.id AND m.ciclo_id = $1::bigint
                WHERE $2::text = 'admin'),

  'presupuestos', (SELECT COALESCE(json_agg(json_build_object(
                     'id', p.id::text, 'nom', p.nombre,
                     'fecha', to_char(p.fecha, 'YYYY-MM-DD'),
                     'tipo', p.tipo, 'salon', p.grupo_id::text, 'estado', p.estado,
                     'rep', p.responsable, 'ninos', p.ninos, 'ninas', p.ninas,
                     'adultos', p.adultos, 'c', p.conceptos,
                     'banco', p.banco, 'clabe', p.clabe, 'titular', p.titular,
                     -- El préstamo se entrega YA RESUELTO contra now() del
                     -- SERVIDOR. El navegador no vuelve a comparar fechas:
                     -- si lo hiciera, atrasar el reloj del celular
                     -- revivirá un préstamo vencido.
                     'prestamo', CASE
                        WHEN p.prestado_a_grupo_id IS NOT NULL AND p.prestamo_hasta > now()
                        THEN json_build_object('a', p.prestado_a_grupo_id::text,
                                               'hasta', p.prestamo_hasta)
                        ELSE NULL END
                   ) ORDER BY p.fecha NULLS LAST, p.id), '[]'::json)
                     FROM presupuestos p
                    WHERE p.ciclo_id = $1::bigint AND ${VISIBLE('p')}),

  'eventos', (SELECT COALESCE(json_agg(json_build_object(
                'id', e.id::text, 'presId', e.presupuesto_id::text, 'nom', e.nombre,
                'fecha', to_char(e.fecha, 'YYYY-MM-DD'),
                'tipo', e.tipo, 'salon', e.grupo_id::text,
                'total_congelado', e.total_congelado,

                -- rec y pers se arman desde GRUPOS con LEFT JOIN, no
                -- desde evento_grupo: así TODO grupo del ciclo tiene su
                -- llave aunque nunca se le haya capturado nada. Un
                -- grupo faltante aquí es un NaN en el tablero.
                'rec', (SELECT COALESCE(json_object_agg(g.id::text, COALESCE(eg.recaudado, 0)), '{}'::json)
                          FROM grupos g
                          LEFT JOIN evento_grupo eg ON eg.evento_id = e.id AND eg.grupo_id = g.id
                         WHERE g.ciclo_id = $1::bigint),

                'pers', (SELECT COALESCE(json_object_agg(g.id::text, json_build_object(
                           'ad', COALESCE(eg.adultos, 0),
                           'ni', COALESCE(eg.ninos, 0),
                           'na', COALESCE(eg.ninas, 0))), '{}'::json)
                           FROM grupos g
                           LEFT JOIN evento_grupo eg ON eg.evento_id = e.id AND eg.grupo_id = g.id
                          WHERE g.ciclo_id = $1::bigint),

                'gastos', (SELECT COALESCE(json_agg(json_build_object(
                             'id', x.id::text, 'f', to_char(x.fecha_pago, 'YYYY-MM-DD'),
                             'd', x.descripcion, 'p', x.proveedor, 'm', x.monto,
                             -- La FOTO no viaja aquí: solo que existe y
                             -- quién la subió. La imagen se pide aparte,
                             -- con URL firmada de 5 minutos.
                             'ticket', CASE WHEN x.ticket_key IS NULL THEN NULL
                                       ELSE json_build_object(
                                         'src', NULL,
                                         'nombre', x.ticket_nombre,
                                         'por', x.ticket_por,
                                         'cuando', x.ticket_en) END
                           ) ORDER BY x.fecha_pago DESC, x.id DESC), '[]'::json)
                           FROM gastos x WHERE x.evento_id = e.id)
              ) ORDER BY e.fecha NULLS LAST, e.id), '[]'::json)
                FROM eventos e
                JOIN presupuestos pp ON pp.id = e.presupuesto_id
               WHERE pp.ciclo_id = $1::bigint AND ${VISIBLE('e')})

) AS datos`;

return [{ json: {
  ok: true,
  sql: sql,
  params: [
    s.ciclo_id, s.rol, s.grupo_id, perm.ver_todos_los_grupos === true,
    JSON.stringify({
      u: s.usuario, nom: s.nombre, rol: s.rol,
      salon: s.grupo_id === null ? null : String(s.grupo_id),
      // Los tres con `=== true`: lo que no venga explícito va apagado.
      tickets: perm.tickets === true,
      verPres: perm.ver_presupuesto === true,
      verTodos: perm.ver_todos_los_grupos === true
    })
  ]
} }];
