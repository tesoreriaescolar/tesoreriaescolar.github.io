/* Nodo: "Code - Responder auth"  (workflow tes/auth)

   Último nodo antes de responder, y el único después de que el token
   existe. Va en try/catch por la misma razón de siempre: su entrada es
   la salida del subflujo, que trae el token recién firmado. */

let salida;
try {
  const dec = $('Code - Verificar clave').first().json || {};
  const firma = $input.first().json || {};
  const pg = $('Postgres - Aplicar').first().json || {};

  if (dec._respuesta) {
    // Caso que no necesitaba token: un rechazo, o el cambio de
    // contraseña. Si hubo escritura, solo vale si tocó un renglón — un
    // 200 del nodo de Postgres no prueba que algo cambió.
    const huboEscritura = Object.prototype.hasOwnProperty.call(pg, 'afectadas');
    salida = (dec._respuesta.ok && huboEscritura && Number(pg.afectadas) === 0)
      ? { ok: false, error: 'NO_SE_GUARDO' }
      : dec._respuesta;

  } else if (firma && firma.ok && firma.token) {
    salida = { ok: true, token: firma.token, sesion: firma.sesion };

  } else {
    // La contraseña era correcta pero el subflujo no firmó: sin ciclo
    // activo, sin membresía, o cuenta desactivada. Se pasa su error tal
    // cual, que es más útil que un "no se pudo".
    salida = { ok: false, error: (firma && firma.error) || 'NO_SE_PUDO_FIRMAR' };
  }
} catch (e) {
  salida = { ok: false, error: 'RESPUESTA_FALLO' };
}
return [{ json: salida }];
