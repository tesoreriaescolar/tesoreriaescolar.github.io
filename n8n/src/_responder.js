/* Nodo: "Code - Responder"  (los cinco workflows de API)

   Convierte el resultado de Postgres en la respuesta del webhook.

   Regla: los errores que salen hacia afuera son ETIQUETAS, no el texto
   del error de Postgres. Un mensaje de la base cuenta nombres de tablas,
   de columnas y de restricciones a quien no tiene por qué saberlos. El
   detalle se queda en el historial de ejecuciones de n8n. */

let salida;
try {
  const arm = $('Code - Armar consulta').first().json || {};

  if (!arm.ok) {
    salida = { ok: false, error: arm.error || 'NO_AUTORIZADO' };
  } else {
    const fila = $input.first().json || {};

    // 'afectadas' la devuelven las mutaciones; 'datos' las lecturas.
    if (Object.prototype.hasOwnProperty.call(fila, 'afectadas')) {
      const n = Number(fila.afectadas || 0);
      salida = n > 0
        ? { ok: true, afectadas: n, id: fila.id === undefined ? null : String(fila.id),
            // true cuando la ventana anti-repetido encontro un gemelo y
            // NO se inserto nada. La pantalla lo dice en vez de fingir.
            repetido: fila.repetido === true }
        // Cero renglones tocados con sesión válida significa que el
        // WHERE excluyó el renglón: o no existe, o no es suyo. A quien
        // pregunta se le dice lo mismo en los dos casos, a propósito:
        // distinguirlos le confirmaría que el renglón existe.
        : { ok: false, error: 'NO_PERMITIDO_O_NO_EXISTE' };
    } else {
      salida = { ok: true, datos: fila.datos === undefined ? null : fila.datos };
    }
  }
} catch (e) {
  salida = { ok: false, error: 'RESPUESTA_FALLO' };
}
return [{ json: salida }];
