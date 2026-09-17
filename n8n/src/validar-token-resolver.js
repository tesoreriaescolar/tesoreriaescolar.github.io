/* Nodo: "Code - Resolver"  (workflow tes/validar-token)

   Aquí vive TODA la seguridad del sistema, y es el ÚNICO lugar donde el
   secreto del JWT se materializa. Los cinco workflows de API llaman a
   este subflujo al entrar; tes/auth lo llama para firmar. Si algo se
   rompe aquí, se rompe parejo — que es justamente el punto.

   ⚠️ TODO el cuerpo va en try/catch, sin excepción, y no es manía: la
   entrada de este nodo trae el secreto. Si el nodo lanzara, n8n mete la
   ENTRADA del nodo que falló en el payload de error, y el secreto
   acabaría en el historial de ejecuciones en claro. Un nodo que no lanza
   no produce payload de error. Ver n8n/README.md regla 2.

   Y devuelve un objeto NUEVO: el secreto no viaja aguas abajo. */

// <<<LIB_CRIPTO>>>

const HORAS_TOKEN = 8;

let salida;
try {
  const secretoFila = $input.first().json || {};
  const sesion = $('Postgres - Sesión').first().json || {};
  const entrada = $('Code - Leer entrada').first().json || {};

  const secreto = secretoFila.jwt_secret;

  // Las comprobaciones que valen para los dos modos. El orden importa
  // menos que el hecho de que ninguna se salte.
  const problema =
    !secreto                         ? 'CONFIG_SIN_SECRETO'
    : !sesion.persona_id             ? 'PERSONA_NO_EXISTE'
    : !sesion.ciclo_id               ? 'SIN_CICLO_ACTIVO'
    // Existe la persona y hay ciclo, pero no tiene membresía en ESTE
    // ciclo: el caso de quien pasó de año y no fue reasignado.
    : !sesion.rol                    ? 'SIN_MEMBRESIA_EN_CICLO'
    : sesion.membresia_activa !== true ? 'CUENTA_DESACTIVADA'
    : null;

  if (problema) {
    salida = { ok: false, error: problema };
  } else {
    const perm = sesion.permisos || {};
    const claims = {
      ok: true,
      error: null,
      persona_id: Number(sesion.persona_id),
      nombre: sesion.nombre,
      usuario: sesion.usuario,
      rol: sesion.rol,
      // null para admin; es el grupo de rep y mama. De aquí sale el
      // filtro del WHERE en los otros workflows.
      grupo_id: sesion.grupo_id === null || sesion.grupo_id === undefined ? null : Number(sesion.grupo_id),
      permisos: {
        tickets: perm.tickets === true,
        ver_presupuesto: perm.ver_presupuesto === true,
        ver_todos_los_grupos: perm.ver_todos_los_grupos === true
      },
      ciclo_id: Number(sesion.ciclo_id),
      ciclo_nombre: sesion.ciclo_nombre,
      grado: sesion.grado,
      // La hora del SERVIDOR. El vencimiento del préstamo se mide contra
      // esto, nunca contra el reloj del celular.
      ahora: sesion.ahora
    };

    if (entrada.modo === 'firmar') {
      salida = {
        ok: true,
        token: firmaJwt({ persona_id: claims.persona_id }, secreto, HORAS_TOKEN * 3600),
        sesion: {
          u: claims.usuario, nom: claims.nombre, rol: claims.rol,
          salon: claims.grupo_id === null ? null : String(claims.grupo_id),
          tickets: claims.permisos.tickets,
          verPres: claims.permisos.ver_presupuesto,
          verTodos: claims.permisos.ver_todos_los_grupos
        }
      };
    } else {
      const v = verificaJwt(entrada.token, secreto);
      if (!v.ok) {
        salida = { ok: false, error: v.error };
      } else if (Number(v.payload.persona_id) !== claims.persona_id) {
        // La firma cuadra pero el token habla de otra persona que la
        // consulta. No debería pasar nunca; si pasa, se rechaza.
        salida = { ok: false, error: 'TOKEN_NO_CORRESPONDE' };
      } else {
        salida = claims;
      }
    }
  }
} catch (e) {
  // Ni el mensaje del error se deja pasar: podría traer un pedazo del
  // renglón que lo causó, y ese renglón traía el secreto.
  salida = { ok: false, error: 'VALIDACION_FALLO' };
}

return [{ json: salida }];
