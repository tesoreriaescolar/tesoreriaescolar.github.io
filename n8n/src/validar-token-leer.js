/* Nodo: "Code - Leer token"  (workflow tes/validar-token)

   Saca del JWT el persona_id SIN verificar la firma todavía, nada más
   para saber a quién ir a buscar a la base.

   Que quede claro por qué eso no es un hoyo: con este id NO se decide
   nada. Se usa como parámetro de una consulta ($1), y la firma se
   comprueba en el nodo SIGUIENTE contra el secreto que trae esa misma
   consulta. Si la firma no cuadra, la respuesta es un rechazo aunque la
   persona exista. Lo único que un atacante consigue mintiendo aquí es
   que la base lea un renglón que después se tira.

   No lanza nunca: un token ilegible es un dato de entrada, no una falla
   del programa. */

// <<<LIB_CRIPTO>>>

let personaId = 0;
let token = '';
let scope = '';

try {
  const entrada = $input.first().json || {};
  token = String(entrada.token || '');
  scope = String(entrada.scope || '');

  const p = token.split('.');
  if (p.length === 3) {
    const cuerpo = JSON.parse(utf8Str(unb64u(p[1])));
    const n = parseInt(cuerpo.persona_id, 10);
    if (Number.isSafeInteger(n) && n > 0) personaId = n;
  }
} catch (e) {
  personaId = 0;
}

return [{ json: { persona_id: personaId, token: token, scope: scope } }];
