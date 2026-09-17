/* Nodo: "Code - Armar aviso"  (workflow tes/vigia, 9:00 am)

   Arma el sobre de Microsoft Graph para el aviso de "no hubo respaldo".

   Por qué existe este nodo y antes no: el aviso se armaba con expresiones
   dentro del nodo de correo SMTP. No hay credencial SMTP —el correo de FTS
   sale por Graph— y el cuerpo de Graph es un JSON con estructura, no dos
   campos sueltos. Armarlo con expresiones dentro del nodo HTTP sería una
   sola línea ilegible; aquí se ve.

   Este nodo NO ve secretos: su entrada es el resultado de una consulta de
   solo lectura (fechas y dos correos). Aun así va en try/catch, porque si
   lanzara no habría aviso — y el aviso es justamente lo único que queda
   cuando el respaldo falló. */

let salida;
try {
  const f = $input.first().json || {};
  const correoDestino = f.correo_destino || '';
  const correoOrigen = f.correo_origen || '';

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* Las dos fechas se muestran tal como las devuelve Postgres, en UTC y
     dichas con todas sus letras. Un "ayer a las 3" sin huso es justo la
     forma de leer mal un incidente: seis horas de diferencia bastan para
     creer que el respaldo corrió cuando no. */
  const ultimo = f.ultimo ? String(f.ultimo) : null;
  const asunto = 'Tesorería Escolar: no hubo respaldo';
  const html =
    '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;color:#13202B">' +
    '<h2 style="margin:0 0 4px">No hubo respaldo</h2>' +
    '<p>El respaldo de las 3:00 am no dejó rastro en las últimas 24 horas.</p>' +
    '<table style="border-collapse:collapse;margin:12px 0">' +
    '<tr><td style="padding:2px 14px 2px 0;color:#5C6B78">Último respaldo</td><td><b>' +
    (ultimo ? esc(ultimo) : 'ninguno') + '</b></td></tr>' +
    '<tr><td style="padding:2px 14px 2px 0;color:#5C6B78">Revisado</td><td>' +
    esc(f.ahora || '') + '</td></tr>' +
    '</table>' +
    '<p>Revisa la ejecución del workflow <code>tes/respaldo</code> en n8n.</p>' +
    '<p style="color:#5C6B78;font-size:12px">Las fechas van en UTC, que es como las guarda ' +
    'Postgres. Monterrey va seis horas atrás.</p>' +
    '</div>';

  salida = {
    json: {
      ok: true,
      correo_destino: correoDestino,
      correo_origen: correoOrigen,
      asunto: asunto,
      ultimo: ultimo,
      ahora: f.ahora || null,
      /* El remitente va en la URL del nodo siguiente y sale de
         `correo_origen`. La política de acceso de Azure acota la
         aplicación a sales@fts.mx: otra casilla daría 403. */
      graph: {
        message: {
          subject: asunto,
          body: { contentType: 'HTML', content: html },
          toRecipients: [{ emailAddress: { address: correoDestino } }]
        },
        saveToSentItems: true
      }
    }
  };
} catch (e) {
  /* Si hasta el aviso se cae, que salga uno mínimo: quedarse callado aquí
     es quedarse sin el único testigo de que el respaldo no corrió. */
  const f = $input.first().json || {};
  const asunto = 'Tesorería Escolar: no hubo respaldo (y el aviso falló)';
  const html = '<p>No hubo respaldo en 24 horas, y este aviso no se pudo armar bien.</p>' +
               '<p style="color:#5C6B78;font-size:12px">' +
               String((e && e.message) || '').slice(0, 200) + '</p>';
  salida = {
    json: {
      ok: false,
      error: 'AVISO_FALLO',
      correo_destino: f.correo_destino || '',
      correo_origen: f.correo_origen || '',
      asunto: asunto,
      graph: {
        message: {
          subject: asunto,
          body: { contentType: 'HTML', content: html },
          toRecipients: [{ emailAddress: { address: f.correo_destino || '' } }]
        },
        saveToSentItems: true
      }
    }
  };
}

return [salida];
