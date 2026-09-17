/* Nodo: "Code - Armar respaldo"  (workflow tes/respaldo, 3:00 am)

   Toma el volcado de las nueve tablas y arma:
     - el archivo JSON adjunto
     - el cuerpo del correo con el resumen y los movimientos del día

   Dos reglas del encargo se cumplen aquí y se ven en el código:
     1. La CLABE va ENMASCARADA: solo los últimos 4.
     2. Las FOTOS no van. Solo sus llaves. */

let salida;
try {
  const fila = $input.first().json || {};
  const d = fila.datos || {};
  // Los correos salen de config_app, no del repo. Se propagan porque el
  // nodo de correo lee de la salida de ESTE nodo.
  const correoDestino = fila.correo_destino || '';
  const correoOrigen = fila.correo_origen || '';

  // --- 1. Enmascarar la CLABE antes de que toque el archivo ---------
  const ultimos4 = (c) => {
    const s = String(c || '');
    return s.length >= 4 ? '•'.repeat(Math.max(0, s.length - 4)) + s.slice(-4) : (s ? '••••' : '');
  };
  (d.presupuestos || []).forEach((p) => { p.clabe = ultimos4(p.clabe); });

  // --- 2. Los hashes tampoco van --------------------------------------
  // No se pidió, pero un respaldo por correo con los hashes adentro es
  // un respaldo que hay que cuidar como si fuera la base. Así no.
  (d.personas || []).forEach((p) => { delete p.hash; });

  const hoy = new Date().toISOString().slice(0, 10);
  const conteos = {};
  const NUEVE = ['ciclos','grupos','personas','membresias','presupuestos',
                 'eventos','evento_grupo','gastos','bitacora'];
  NUEVE.forEach((t) => { conteos[t] = (d[t] || []).length; });

  const archivo = JSON.stringify({
    _meta: {
      generado: new Date().toISOString(),
      fecha: hoy,
      tablas: NUEVE,
      conteos: conteos,
      nota: 'La CLABE va enmascarada (ultimos 4). Los hashes de contrasena no se incluyen. Las fotos de tickets NO estan aqui: solo su ticket_key en el bucket.'
    },
    datos: d
  }, null, 1);

  const movs = d.movimientos || [];
  const fila = (m) => `<tr><td style="padding:4px 10px;border-bottom:1px solid #e5e5e5">${
      String(m.cuando || '').slice(11, 16)}</td><td style="padding:4px 10px;border-bottom:1px solid #e5e5e5">${
      esc(m.quien || 'sistema')}</td><td style="padding:4px 10px;border-bottom:1px solid #e5e5e5">${
      esc(m.accion)}</td><td style="padding:4px 10px;border-bottom:1px solid #e5e5e5">${esc(m.tabla)}</td></tr>`;

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;color:#13202B">
      <h2 style="margin:0 0 4px">Respaldo de Tesorería Escolar</h2>
      <p style="color:#5C6B78;margin:0 0 16px">${hoy} · ciclo ${esc((d.ciclos || []).filter((c) => c.activo).map((c) => c.nombre)[0] || '—')}</p>
      <table style="border-collapse:collapse;margin-bottom:18px">
        ${NUEVE.map((t) => `<tr><td style="padding:2px 14px 2px 0">${t}</td><td style="text-align:right">${conteos[t]}</td></tr>`).join('')}
      </table>
      <h3 style="margin:0 0 6px">Movimientos de las últimas 24 horas (${movs.length})</h3>
      ${movs.length
        ? `<table style="border-collapse:collapse;font-size:13px"><tr style="text-align:left;color:#5C6B78">
             <th style="padding:4px 10px">Hora</th><th style="padding:4px 10px">Quién</th>
             <th style="padding:4px 10px">Acción</th><th style="padding:4px 10px">Tabla</th></tr>
           ${movs.map(fila).join('')}</table>`
        : '<p style="color:#5C6B78">Sin movimientos.</p>'}
      <p style="color:#5C6B78;font-size:12px;margin-top:20px">
        El archivo adjunto trae las nueve tablas. La CLABE va enmascarada (solo los últimos 4) y
        los hashes de contraseña no se incluyen. Las fotos de los tickets no viajan aquí: en su
        lugar va la llave de cada una en el bucket.</p>
    </div>`;

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  salida = {
    json: {
      ok: true,
      correo_destino: correoDestino,
      correo_origen: correoOrigen,
      asunto: `Respaldo Tesorería Escolar · ${hoy} · ${movs.length} movimiento(s)`,
      html: html,
      conteos: conteos,
      movimientos: movs.length
    },
    binary: {
      respaldo: {
        data: Buffer.from(archivo, 'utf8').toString('base64'),
        mimeType: 'application/json',
        fileName: `tesoreria-${hoy}.json`
      }
    }
  };
} catch (e) {
  // Que el respaldo truene NO puede quedarse callado: el vigía de las
  // 9 am se entera porque no hay renglón de bitácora, pero además el
  // correo sale igual diciendo que falló.
  // Aun fallando hay que poder mandar el aviso, así que los correos se
  // vuelven a leer de la entrada en vez de darlos por perdidos.
  const f = $input.first().json || {};
  salida = { json: { ok: false,
                     correo_destino: f.correo_destino || '',
                     correo_origen: f.correo_origen || '',
                     error: 'RESPALDO_FALLO',
                     asunto: 'FALLÓ el respaldo de Tesorería Escolar',
                     html: '<p>El respaldo de las 3:00 am no se pudo armar. Revisa la ejecución en n8n.</p>' } };
}

return [salida];
