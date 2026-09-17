# Los workflows de n8n

Ocho: el subflujo de sesión, cinco de API y dos cron.

```
src/        los fuentes. Se editan AQUÍ.
build.py    los ensambla
workflows/  el JSON que se importa a n8n. NO se edita a mano.
```

`python3 n8n/build.py` reconstruye los ocho. Los nodos Code que necesitan
cripto llevan la librería **inyectada**, no copiada: se escribe una vez en
`src/lib-cripto.js` y un carácter distinto entre copias sería un bug que
solo se ve como «la contraseña no coincide».

## Reglas que costaron caro

**1. Todo el cripto es JavaScript puro.**
El sandbox de los nodos Code no expone `require`, ni `node:crypto`, ni
`process`, ni `$env`. No hay librerías. Por eso `lib-cripto.js` trae
SHA-256, HMAC, PBKDF2 y JWT escritos a mano, y está comprobado contra los
vectores oficiales y contra el `crypto` de Node.

**2. Un nodo que puede lanzar NUNCA debe tener un secreto en su entrada.**
Cuando un nodo truena, n8n guarda su **entrada** en el payload de error de
la ejecución. Si ese nodo colgaba de uno que trae el secreto del JWT o las
llaves del bucket, el secreto acaba en el historial, en claro.

Por eso los tres nodos que ven secretos —`Code - Verificar`,
`Code - Resolver` y `Code - Firmar URL`— van **enteros en try/catch** y
devuelven el fallo como dato (`{ok:false, error:'...'}`), nunca lanzando.
Un nodo que no lanza no produce payload de error. Y devuelven un objeto
**nuevo**, para que el secreto no viaje aguas abajo.

⚠️ `onError: continueRegularOutput` **no sirve** para esto: pasa la entrada
del nodo que falló hacia adelante, o sea manda el secreto río abajo.

**3. El `$` es un patrón de reemplazo.**
`lib-cripto.js` contiene la cadena `'pbkdf2$' + it`. En JavaScript,
`String.replace(a, b)` interpreta `$$`, `$&`, `` $` ``, `$'` y `$1` dentro
de `b`. Inyectar la librería con un reemplazo directo la deja mutilada, y
el error que se ve después no habla de eso. Se inyecta con una **función**
de reemplazo. Pasó al escribir esto.

**4. El secreto del JWT lo alcanza UNA credencial, en UN nodo.**
Con ese secreto se *firman* tokens: quien lo lea se fabrica una sesión de
tesorera general. Por eso no lo alcanza `app_rw`, que es la credencial con
la que corren los cinco workflows de API — una inyección en cualquiera de
ellos llega hasta donde llegue `app_rw`, y `app_rw` no llega ahí.

`tes/auth` tampoco lo lee: cuando alguien entra bien, le **pide el token**
al subflujo. Por eso `tes/validar-token` tiene dos modos, `verificar` y
`firmar`.

Del cambio de contraseña **no se verifica la firma del JWT**, a propósito:
se exige la contraseña actual, que es prueba de identidad más fuerte. El
`persona_id` sale del token sin verificar, pero mentir ahí no sirve —
habría que saber la contraseña de esa persona, y con eso se podría entrar
igual. Verificar la firma no agregaría nada y obligaría a que `tes/auth`
alcanzara el secreto.

**5. El permiso va en el WHERE.**
Ningún workflow filtra la respuesta después de consultarla. Si el `WHERE`
no excluye el renglón, el dato ya salió de la base y cualquier filtro
posterior es decoración. Los predicados están escritos una sola vez arriba
de cada catálogo de acciones.

**6. La bitácora va en la MISMA sentencia.**
Cada mutación es UNA sentencia con CTE: el cambio y su renglón de bitácora
entran juntos o no entra ninguno. El `SELECT` final siempre referencia el
CTE `log`, porque un CTE que nadie mira no se ejecuta.
Comprobado: forzar el fallo de la bitácora revierte el `UPDATE`.

**7. El SQL es literal, los valores son parámetros.**
Nada de lo que manda el navegador se concatena dentro del SQL. Las
consultas son cadenas literales de los fuentes; lo del cliente viaja como
`$1`, `$2`…

## Al importar en n8n, a mano

n8n descarta cosas al importar. Hay que rellenarlas:

1. **`settings.timezone`** → `America/Monterrey`. n8n lo **descarta** al
   importar, y sin él los cron corren en el huso de la instancia. El de
   FTS corre en **UTC-4**, así que las 3:00 am serían la 1:00 am.
2. **Credenciales**: `REEMPLAZAR_CRED_APP_RW`, `REEMPLAZAR_CRED_CONFIG_RO`
   y `REEMPLAZAR_CRED_SMTP`. **`config_ro` va en UN SOLO nodo de todo el
   sistema**: `Postgres - Secreto`, dentro de `tes/validar-token`. Si
   aparece en cualquier otro lado, está mal.
3. **`REEMPLAZAR_ID_VALIDAR_TOKEN`**: el id que n8n le dé a
   `tes/validar-token` al importarlo. Va en los cinco de API, en el nodo
   «Validar token». **Importa ése primero.**
4. Los correos de los dos cron **no se ponen aquí**: salen de la tabla
   `config_app` (`correo_destino` y `correo_origen`). El repositorio es
   público y un correo personal es dato personal aunque no sea secreto.
5. Los webhooks nacen con id nuevo: confirma que la ruta sea `tes/<lo que
   sea>` y no otra cosa.

Y después de activar: **vuelve a leer el workflow** y confirma que
`active` quedó en `true`. El éxito del guardado no lo prueba.
