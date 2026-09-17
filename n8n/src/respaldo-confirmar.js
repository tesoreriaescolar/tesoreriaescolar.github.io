/* Nodo: "Code - ¿Confirmado?"  (workflow tes/respaldo, 3:00 am)

   Decide si el renglón de bitácora se escribe o no.

   EL RENGLÓN DE BITÁCORA ES LA PRUEBA DE QUE EL RESPALDO LLEGÓ, y es lo
   único que mira el vigía de las 9 am. Escribirlo cuando el correo no
   salió convertiría al vigía en un testigo falso: diría "todo bien" la
   mañana en que no hubo respaldo. Es el mismo error que pintar el ✓ del
   kiosko antes de que el servidor confirme.

   Graph contesta 202 con el cuerpo vacío cuando aceptó el mensaje. Ese
   202 es lo único que cuenta. Cualquier otro código, o un fallo de red,
   es NO ENVIADO.

   Cuando no procede se devuelve la lista VACÍA. En n8n eso salta el nodo
   siguiente sin ramas ni banderas: no hay un camino alterno que pueda
   desincronizarse con éste. Y el silencio no se queda callado —el vigía
   lo grita a las 9. */

const r = $input.first().json || {};
const code = (r.statusCode !== undefined) ? r.statusCode
           : (r.error && r.error.statusCode) ? r.error.statusCode : null;

const armado = $('Code - Armar respaldo').first().json || {};

/* Dos condiciones, y las dos tienen que valer:
     · Graph aceptó el mensaje (202)
     · el respaldo se armó completo (si el volcado no cupo en el adjunto,
       el correo salió avisando, pero NO hubo respaldo) */
const entregado = (code === 202);
const completo = (armado.ok === true);

if (!entregado || !completo) return [];

return [{ json: {
  conteos: armado.conteos || {},
  adjunto: armado.adjunto || null,
  http: code
} }];
