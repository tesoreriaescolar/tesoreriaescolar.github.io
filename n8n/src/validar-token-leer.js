/* Nodo: "Code - Leer entrada"  (workflow tes/validar-token)

   El subflujo tiene DOS modos, y los dos existen para que el secreto
   del JWT se materialice en UN SOLO workflow:

     verificar  (por omisión)  token   -> quién es y qué puede
     firmar                    persona -> token nuevo

   tes/auth NO lee el secreto: cuando alguien entra bien, le pide a este
   subflujo que firme. Así la credencial config_ro aparece en un solo
   lugar de todo el sistema.

   En modo 'verificar' se saca el persona_id del token SIN comprobar la
   firma todavía, nada más para saber a quién ir a buscar. Con ese id no
   se decide nada: es el parámetro $1 de una consulta, y la firma se
   comprueba después contra el secreto. Si no cuadra, la respuesta es un
   rechazo aunque la persona exista.

   No lanza nunca: una entrada ilegible es un dato, no una falla. */

// <<<LIB_CRIPTO>>>

let modo = 'verificar';
let personaId = 0;
let token = '';

try {
  const e = $input.first().json || {};
  modo = e.modo === 'firmar' ? 'firmar' : 'verificar';
  token = String(e.token || '');

  if (modo === 'firmar') {
    const n = parseInt(e.persona_id, 10);
    if (Number.isSafeInteger(n) && n > 0) personaId = n;
  } else {
    const p = token.split('.');
    if (p.length === 3) {
      const cuerpo = JSON.parse(utf8Str(unb64u(p[1])));
      const n = parseInt(cuerpo.persona_id, 10);
      if (Number.isSafeInteger(n) && n > 0) personaId = n;
    }
  }
} catch (err) {
  personaId = 0;
}

return [{ json: { modo: modo, persona_id: personaId, token: token } }];
