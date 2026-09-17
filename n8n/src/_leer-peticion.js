/* Nodo: "Code - Leer petición"  (los cinco workflows de API)

   Saca del cuerpo lo mínimo y nada más. No decide nada: quién es y qué
   puede hacer lo resuelve tes/validar-token en el nodo siguiente.

   La IP se toma de las cabeceras para la bitácora. Es informativa: la
   manda el cliente y se puede mentir, por eso NO se usa para ninguna
   decisión, solo se guarda. */

let salida;
try {
  const w = $input.first().json || {};
  const b = w.body || {};
  const h = w.headers || {};
  const ip = String(h['x-forwarded-for'] || h['x-real-ip'] || '').split(',')[0].trim();

  salida = {
    token: String(b.token || ''),
    accion: String(b.accion || ''),
    datos: (b.datos && typeof b.datos === 'object') ? b.datos : {},
    ip: ip
  };
} catch (e) {
  salida = { token: '', accion: '', datos: {}, ip: '' };
}
return [{ json: salida }];
