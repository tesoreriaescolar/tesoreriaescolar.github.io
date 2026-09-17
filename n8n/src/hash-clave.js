/* Genera el hash de una contraseña SIN que la contraseña salga de tu
   máquina. Úsalo para sembrar personas o para restablecer una clave
   a mano.

     node n8n/src/hash-clave.js
     node n8n/src/hash-clave.js "la contraseña"

   Imprime SOLO el hash. Pégalo en personas.hash. La contraseña en claro
   no se guarda en ningún lado: ni aquí, ni en la base, ni en el chat. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const src = fs.readFileSync(path.join(__dirname, 'lib-cripto.js'), 'utf8');
const L = new Function(src + '\nreturn {hashClave, b64u};')();

const clave = process.argv[2];
if (!clave) {
  console.error('Uso: node hash-clave.js "la contraseña"');
  console.error('(ponla entre comillas; si trae $ o espacios, sin comillas se rompe)');
  process.exit(1);
}
const sal = L.b64u(new Uint8Array(crypto.randomBytes(16)));
console.log(L.hashClave(clave, sal));
