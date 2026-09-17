/* Nodo: "Code - Persona a buscar"  (workflow tes/auth)

   Decide a quién va a buscar la consulta: por usuario si es un login,
   o por el persona_id del token si es un cambio de contraseña.

   El persona_id sale del token SIN verificar la firma todavía — igual
   que en tes/validar-token, y por la misma razón: solo sirve para saber
   qué renglón leer. La firma se comprueba en "Code - Resolver", contra
   el secreto que trae esa misma consulta, antes de cambiar nada. */

// <<<LIB_CRIPTO>>>

let usuario = '';
let personaId = 0;

try {
  const pet = $input.first().json || {};
  const d = pet.datos || {};

  if (pet.accion === 'login') {
    usuario = String(d.usuario || '').trim();
  } else {
    const p = String(pet.token || '').split('.');
    if (p.length === 3) {
      const cuerpo = JSON.parse(utf8Str(unb64u(p[1])));
      const n = parseInt(cuerpo.persona_id, 10);
      if (Number.isSafeInteger(n) && n > 0) personaId = n;
    }
  }
} catch (e) {
  usuario = ''; personaId = 0;
}

return [{ json: { usuario: usuario, persona_id: personaId } }];
