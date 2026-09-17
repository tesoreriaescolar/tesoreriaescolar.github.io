/* =====================================================================
   lib-s3 — URLs firmadas (AWS Signature V4, presigned query string).

   Firmar es puro HMAC: NO hay red de por medio, así que cabe en un nodo
   Code aunque el sandbox no tenga acceso a internet. n8n entrega la URL
   firmada y es el CELULAR quien sube el archivo directo al bucket.
   La foto nunca pasa por n8n ni por la base.

   Depende de lib-cripto (hmacSha256, sha256, utf8Bytes, hex).
   ===================================================================== */

function amzFechas(d) {
  const p = (n, a) => String(n).padStart(a || 2, '0');
  const ymd = d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate());
  return { ymd: ymd, iso: ymd + 'T' + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + 'Z' };
}

/* Codificación de URI de AWS: como encodeURIComponent, pero AWS exige
   que ! * ' ( ) también vayan escapados, y que ~ NO lo vaya. Si esto se
   equivoca, la firma no cuadra y el error que devuelve S3 habla de
   credenciales, no de codificación. */
function uriEnc(str, dejarDiagonal) {
  let s = encodeURIComponent(String(str))
    .replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  if (dejarDiagonal) s = s.replace(/%2F/g, '/');
  return s;
}

function llaveDeFirma(secreto, ymd, region, servicio) {
  let k = hmacSha256(utf8Bytes('AWS4' + secreto), utf8Bytes(ymd));
  k = hmacSha256(k, utf8Bytes(region));
  k = hmacSha256(k, utf8Bytes(servicio));
  return hmacSha256(k, utf8Bytes('aws4_request'));
}

/*
  cfg = { endpoint, region, bucket, keyId, secret }
    endpoint: 'https://algo.railway.app' (sin diagonal final)
  metodo: 'PUT' para subir, 'GET' para ver
  llave:  la ruta dentro del bucket (gastos/12/1789…-ticket.jpg)
  segundos: vigencia
*/
function urlFirmada(cfg, metodo, llave, segundos) {
  const servicio = 's3';
  const ahora = new Date();
  const f = amzFechas(ahora);
  const alcance = f.ymd + '/' + cfg.region + '/' + servicio + '/aws4_request';

  const base = String(cfg.endpoint).replace(/\/+$/, '');
  const host = base.replace(/^https?:\/\//, '').split('/')[0];
  // Path-style: /<bucket>/<llave>. Railway lo sirve así, y además evita
  // el lío de los certificados comodín del virtual-host style.
  const ruta = '/' + uriEnc(cfg.bucket) + '/' + uriEnc(llave, true);

  const q = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', cfg.keyId + '/' + alcance],
    ['X-Amz-Date', f.iso],
    ['X-Amz-Expires', String(segundos)],
    ['X-Amz-SignedHeaders', 'host']
  ];
  // AWS exige los parámetros ordenados por nombre codificado.
  const consulta = q.map((kv) => [uriEnc(kv[0]), uriEnc(kv[1])])
                    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
                    .map((kv) => kv[0] + '=' + kv[1])
                    .join('&');

  const pedidoCanonico = [
    metodo, ruta, consulta,
    'host:' + host, '',      // cabeceras canónicas + línea en blanco
    'host',                  // cabeceras firmadas
    'UNSIGNED-PAYLOAD'
  ].join('\n');

  const porFirmar = [
    'AWS4-HMAC-SHA256', f.iso, alcance,
    hex(sha256(utf8Bytes(pedidoCanonico)))
  ].join('\n');

  const firma = hex(hmacSha256(llaveDeFirma(cfg.secret, f.ymd, cfg.region, servicio), utf8Bytes(porFirmar)));
  return base + ruta + '?' + consulta + '&X-Amz-Signature=' + firma;
}

/* La llave del ticket la arma el SERVIDOR, nunca el navegador: si el
   cliente propusiera la ruta, podría pedir una URL firmada para
   sobrescribir el ticket de otro evento. Va con marca de tiempo para
   que cambiar la foto no pise la anterior. */
function llaveTicket(gastoId, nombreArchivo) {
  const ext = (String(nombreArchivo || '').match(/\.([A-Za-z0-9]{1,5})$/) || [, 'jpg'])[1].toLowerCase();
  const limpio = ext.replace(/[^a-z0-9]/g, '') || 'jpg';
  return 'gastos/' + gastoId + '/' + Date.now() + '.' + limpio;
}
