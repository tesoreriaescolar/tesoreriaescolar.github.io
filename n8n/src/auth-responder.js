/* Nodo: "Code - Responder auth"  (workflow tes/auth) */
let salida;
try {
  const r = ($('Code - Resolver').first().json || {})._respuesta || { ok: false, error: 'SIN_RESPUESTA' };
  const pg = $input.first().json || {};

  // Si hubo escritura, la respuesta solo es buena si de verdad tocó un
  // renglón. Un 200 del nodo de Postgres no prueba que algo cambió.
  if (r.ok && pg && Object.prototype.hasOwnProperty.call(pg, 'afectadas') && Number(pg.afectadas) === 0) {
    salida = { ok: false, error: 'NO_SE_GUARDO' };
  } else {
    salida = r;
  }
} catch (e) {
  salida = { ok: false, error: 'RESPUESTA_FALLO' };
}
return [{ json: salida }];
