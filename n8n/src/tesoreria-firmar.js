/* Nodo: "Code - Firmar URL y responder"  (workflow tes/tesoreria)

   Hace las dos cosas porque es el ÚLTIMO nodo antes de responder: para
   las acciones normales responde como los otros workflows, y para las
   dos de ticket calcula además la URL firmada.

   Calcula la URL firmada del bucket. Firmar es puro HMAC: no hay red de
   por medio, así que cabe en un nodo Code aunque el sandbox no tenga
   internet. La FOTO nunca pasa por n8n ni por la base — n8n entrega la
   URL y el celular sube (o baja) directo contra el bucket.

   ⚠️ try/catch total: la entrada trae las llaves del bucket. Si el nodo
   lanzara, n8n las guardaría en el payload de error. Y la salida es un
   objeto NUEVO: las llaves no viajan aguas abajo. */

// <<<LIB_CRIPTO>>>
// <<<LIB_S3>>>

const MIN_SUBIR = 10 * 60;   // 10 min para subir desde el celular
const MIN_VER   = 5 * 60;    // 5 min para ver, como se pidió

let salida;
try {
  const arm = $('Code - Armar consulta').first().json || {};

  if (!arm.ok) {
    salida = { ok: false, error: arm.error || 'NO_AUTORIZADO' };
  } else if (!arm.firmar) {
    // Esta acción no pedía firma: es una mutación normal y se responde
    // igual que en los otros workflows. Cero renglones tocados con
    // sesión válida = el WHERE excluyó el renglón.
    const fila = $input.first().json || {};
    const n = Number(fila.afectadas || 0);
    salida = n > 0
      ? { ok: true, afectadas: n, id: fila.id === undefined ? null : String(fila.id) }
      : { ok: false, error: 'NO_PERMITIDO_O_NO_EXISTE' };
  } else {
    const fila = $input.first().json;

    if (!fila || !fila.gasto_id) {
      // Cero renglones = el WHERE excluyó el gasto. Ni existe para esta
      // sesión, ni se le dice cuál de las dos cosas es.
      salida = { ok: false, error: 'NO_PERMITIDO_O_NO_EXISTE' };
    } else if (!fila.s3_endpoint || !fila.s3_key_id || !fila.s3_secret) {
      salida = { ok: false, error: 'CONFIG_SIN_BUCKET' };
    } else {
      const cfg = {
        endpoint: fila.s3_endpoint, region: fila.s3_region || 'us-east-1',
        bucket: fila.s3_bucket, keyId: fila.s3_key_id, secret: fila.s3_secret,
        estilo: fila.s3_estilo || 'virtual'
      };

      if (arm.firmar === 'PUT') {
        // La ruta la arma el SERVIDOR. Si la propusiera el cliente,
        // podría pedir una URL firmada apuntando al ticket de otro
        // evento y sobrescribirlo.
        const llave = llaveTicket(fila.gasto_id, arm.nombre_archivo);
        salida = { ok: true, modo: 'subir', ticket_key: llave,
                   url: urlFirmada(cfg, 'PUT', llave, MIN_SUBIR), vence_en: MIN_SUBIR };
      } else if (!fila.ticket_key) {
        salida = { ok: false, error: 'SIN_TICKET' };
      } else {
        salida = { ok: true, modo: 'ver', ticket_key: fila.ticket_key,
                   url: urlFirmada(cfg, 'GET', fila.ticket_key, MIN_VER), vence_en: MIN_VER };
      }
    }
  }
} catch (e) {
  salida = { ok: false, error: 'FIRMA_FALLO' };
}

return [{ json: salida }];
