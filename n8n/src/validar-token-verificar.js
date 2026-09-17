/* Nodo: "Code - Verificar"  (workflow tes/validar-token)

   Aquí es donde vive TODA la seguridad del sistema. Los cinco workflows
   de API llaman a este subflujo al entrar y actúan según lo que
   devuelve. Si algo se rompe aquí, se rompe parejo en los cinco — que
   es justamente el punto de tenerlo en un solo lugar.

   ⚠️ TODO el cuerpo va en try/catch, sin excepción, y NO es manía:
   la entrada de este nodo trae el secreto del JWT. Si el nodo lanzara,
   n8n mete la ENTRADA del nodo que falló en el payload de error, y el
   secreto acabaría en el historial de ejecuciones en claro. Un nodo que
   no lanza no produce payload de error. Ver n8n/README.md regla 2.

   Y devuelve un objeto NUEVO: el secreto no viaja aguas abajo. */

// <<<LIB_CRIPTO>>>

let salida;
try {
  const fila = $input.first().json || {};
  const previo = $('Code - Leer token').first().json || {};

  const secreto = fila.jwt_secret;
  const token = previo.token;

  if (!secreto) {
    salida = { ok: false, error: 'CONFIG_SIN_SECRETO' };
  } else {
    const v = verificaJwt(token, secreto);
    if (!v.ok) {
      salida = { ok: false, error: v.error };
    } else if (!fila.persona_id) {
      // La firma cuadra pero la persona ya no existe: token de alguien
      // que fue dado de baja borrando el renglón.
      salida = { ok: false, error: 'PERSONA_NO_EXISTE' };
    } else if (Number(v.payload.persona_id) !== Number(fila.persona_id)) {
      salida = { ok: false, error: 'TOKEN_NO_CORRESPONDE' };
    } else if (!fila.ciclo_id) {
      salida = { ok: false, error: 'SIN_CICLO_ACTIVO' };
    } else if (!fila.rol) {
      // Existe la persona, hay ciclo, pero no tiene membresía en ESTE
      // ciclo. Es el caso de quien pasó de año y no fue reasignado.
      salida = { ok: false, error: 'SIN_MEMBRESIA_EN_CICLO' };
    } else if (fila.membresia_activa !== true) {
      salida = { ok: false, error: 'CUENTA_DESACTIVADA' };
    } else {
      const perm = fila.permisos || {};
      salida = {
        ok: true,
        error: null,
        persona_id: Number(fila.persona_id),
        nombre: fila.nombre,
        usuario: fila.usuario,
        rol: fila.rol,
        // null para admin; es el grupo de rep y mama. De aquí sale el
        // filtro del WHERE en los otros workflows.
        grupo_id: fila.grupo_id === null || fila.grupo_id === undefined ? null : Number(fila.grupo_id),
        permisos: {
          tickets: perm.tickets === true,
          ver_presupuesto: perm.ver_presupuesto === true,
          ver_todos_los_grupos: perm.ver_todos_los_grupos === true
        },
        ciclo_id: Number(fila.ciclo_id),
        ciclo_nombre: fila.ciclo_nombre,
        grado: fila.grado,
        // La hora del SERVIDOR. El vencimiento del préstamo se mide
        // contra esto, nunca contra el reloj del celular.
        ahora: fila.ahora
      };
    }
  }
} catch (e) {
  // Ni el mensaje del error se deja pasar: podría traer un pedazo del
  // renglón que lo causó, y ese renglón traía el secreto.
  salida = { ok: false, error: 'VALIDACION_FALLO' };
}

return [{ json: salida }];
