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

**4-bis. El correo sale por Microsoft Graph, no por SMTP.**
No hay credencial SMTP en esta instancia de n8n. El correo de FTS sale por
una credencial OAuth2 de aplicación (`Microsoft Graph - sales`) contra
`POST https://graph.microsoft.com/v1.0/users/<remitente>/sendMail`.

El patrón no se inventó: está copiado de `comercial/cotizacion`, que ya
manda por ahí el PDF de las cotizaciones. Lo que hay que saber:

- **Éxito es 202 con el cuerpo VACÍO.** No 200. El nodo HTTP va con
  `fullResponse` + `neverError` para poder *leer* el código en vez de
  lanzar, y quien decide si hubo envío es el nodo siguiente.
- **El adjunto va en base64 dentro del JSON**, como
  `#microsoft.graph.fileAttachment` con `contentBytes` — no como binario
  de n8n. Tope **3 MB**: el envío en una sola llamada topa cerca de 4 MB
  con el sobrecosto de base64.
- **El remitente va en la URL** y sale de `config_app.correo_origen`. La
  política de acceso de Azure acota la aplicación a una sola casilla; otra
  daría 403.
- **El renglón de bitácora del respaldo se escribe SOLO si hubo 202.** Ese
  renglón es lo único que mira el vigía: escribirlo sin envío lo
  convertiría en un testigo falso. `Code - ¿Confirmado?` devuelve la lista
  vacía cuando no procede, y n8n salta el nodo siguiente sin necesidad de
  una rama que pueda desincronizarse.

**5. El bucket de Railway es virtual-hosted, y elegir mal no lo dice.**
La URL firmada se arma `https://<bucket>.<endpoint>/<llave>`, no
`https://<endpoint>/<bucket>/<llave>`. El host y la ruta entran en el texto
que se firma, así que equivocarse **no da un error que hable de esto**: da
un fallo de firma. Va como ajuste (`config_app.s3_estilo`) porque los
buckets creados antes del cambio usan `path`, y la pestaña Credentials del
bucket dice cuál toca.

Y dos valores que se leen de esa misma pestaña y **no se adivinan**:
`BUCKET` lleva un hash detrás del nombre que se ve en el lienzo
(`tesoreria-tickets-jdhhd8oe18xi`), y `REGION` en Railway suele ser `auto`,
no una región de AWS.

**6. n8n guarda la SALIDA de cada nodo — un secreto ahí se escribe en claro.**
No basta con que el nodo no lance. En el camino feliz, lo que un nodo
devuelve se escribe tal cual en la base de n8n para cada ejecución que se
conserve. Un nodo que devuelve un secreto lo guarda **en cada petición**.

Por eso **los ocho** llevan `saveDataSuccessExecution`,
`saveDataErrorExecution` **y `saveManualExecutions`** cerrados. Los ocho,
sin excepciones y a propósito.

🔴 **Aquí decía «cinco», y esa lista estuvo mal en producción.** El
criterio con el que se armó era «¿por aquí pasa un secreto de
infraestructura?» — el secreto del JWT, las llaves del bucket, un hash, el
volcado de la base, un correo. Con esa vara, `tes/lectura`,
`tes/presupuestos` y `tes/admin` salieron limpios y se quedaron
**guardando** desde el 17-sep 05:40 hasta las 07:17 del mismo día.

**La pregunta correcta es otra: «¿por aquí pasa algo de una persona?».**
Y la respuesta es que sí, en los cinco de API sin excepción, porque **el
token de sesión viaja en el cuerpo de cada petición**: el nodo `Webhook`
lo devuelve como salida, y con el guardado encendido queda escrito en
claro, con ocho horas de vida por delante. `tes/admin` además lleva el
revuelto de las contraseñas en `persona_crear` y `persona_clave` — que la
lista vieja le atribuía solo a `tes/auth`, olvidando que admin también
**escribe** hashes.

De ahí la regla: **ninguno guarda**. No hay que decidir cuál sí; decidir
caso por caso es exactamente lo que falló.

⚠️ `saveManualExecutions` va por su cuenta: una corrida a mano desde la UI
guarda todo aunque las otras dos digan `none`. Y es justo lo que se hace
al importar y probar.

⚠️ Y esto es un **ajuste**, no una propiedad del diseño: quien lo cambie
en la UI reabre el hoyo sin que nada avise. El arreglo estructural es que
el secreto no sea nunca la salida de un nodo.

**Cómo comprobarlo sin abrir la configuración de nada.** Si un workflow
guarda, sus ejecuciones **aparecen en la lista**; si no guarda, **no
aparece ninguna**, ni siquiera el renglón. Medido el 17-sep: `tes/auth`
(apagado) → **0 ejecuciones** aunque se había entrado a la aplicación
muchas veces; `tes/presupuestos` (encendido) → **36**. Así que entrar a
**Overview → Executions** y filtrar por workflow mide el efecto, no el
ajuste: **cualquier ejecución de un `tes/*` significa que su guardado
está encendido.**

**6-bis. 🔴 Cero filas = cero items = el webhook cierra VACÍO.**
Cuando una consulta devuelve **cero filas**, el nodo de Postgres emite
**cero items**, y en n8n cero items significa que **todo lo que sigue se
salta** — incluido el `Respond to Webhook`. El webhook entonces cierra con
**200 y el cuerpo vacío**: sin error, sin nada que mirar, sin nada en el
historial si el guardado está apagado.

Y aquí eso no es un caso raro, **es el caso normal**: los cinco workflows
de API usan una consulta centinela —`SELECT 0 AS afectadas WHERE false`—
para los rechazos, y `tes/auth` la usa también en el **login bueno**,
porque entrar no escribe nada. O sea que el camino feliz del login
devolvía cero filas y la respuesta nunca se armaba.

Por eso **todos** los nodos de Postgres llevan `alwaysOutputData: true`,
puesto en `n_pg()` de `build.py` para que no dependa de acordarse. El nodo
emite entonces un item vacío, la cadena sigue, y el Code de respuesta arma
el JSON que toca — que ya sabe manejar el caso vacío, porque lee el
veredicto de los nodos de arriba, no de `$json`.

Es el mismo guardia que lleva `comercial/cotizacion` en su nodo
`Postgres - Machote del actor`, y por la misma razón.

Medido el 17-sep-2026: ejecución `101777` (login, se corta en
`Postgres - Aplicar` con `main: [[]]`) y `101780` (el mismo login con la
bandera puesta, responde `ok:true` con su token).

⚠️ **Cómo se ve desde el navegador**, que es lo que confunde: `200 OK`,
las cabeceras de CORS correctas, y la respuesta vacía. Parece un problema
de CORS o de red, y no es ninguno de los dos: el workflow corrió y se
quedó a medias.

**7. Los permisos se EXIGEN, nunca se descartan.**
`if (x && x.y !== true) rechaza` **no corre cuando `x` falta**. Se escribe
al revés: sigue solo si el permiso vale exactamente `true`. Lo mismo con
los roles: lista de quién pasa, no lista de quién no — así un rol nuevo
queda fuera por omisión. Es la misma forma del `CHECK` que devolvía `NULL`
y dejaba pasar justo el caso que existía para atrapar.

**8. El permiso va en el WHERE.**
Ningún workflow filtra la respuesta después de consultarla. Si el `WHERE`
no excluye el renglón, el dato ya salió de la base y cualquier filtro
posterior es decoración. Los predicados están escritos una sola vez arriba
de cada catálogo de acciones.

**9. La bitácora va en la MISMA sentencia.**
Cada mutación es UNA sentencia con CTE: el cambio y su renglón de bitácora
entran juntos o no entra ninguno. El `SELECT` final siempre referencia el
CTE `log`, porque un CTE que nadie mira no se ejecuta.
Comprobado: forzar el fallo de la bitácora revierte el `UPDATE`.

**10. El SQL es literal, los valores son parámetros.**
Nada de lo que manda el navegador se concatena dentro del SQL. Las
consultas son cadenas literales de los fuentes; lo del cliente viaja como
`$1`, `$2`…

## Al importar en n8n, a mano

n8n descarta cosas al importar. Hay que rellenarlas:

1. **`settings.timezone`** → `America/Monterrey`. n8n lo **descarta** al
   importar, y sin él los cron corren en el huso de la instancia. El de
   FTS corre en **UTC-4**, así que las 3:00 am serían la 1:00 am.
2. **Credenciales.** Los marcadores del JSON y el nombre que tiene que
   llevar cada credencial en n8n:

   | Marcador en el JSON | Credencial en n8n | Tipo | Dónde va |
   |---|---|---|---|
   | `REEMPLAZAR_CRED_APP_RW` | `tesoreria-escolar-db · app_rw` | Postgres | los 10 nodos de Postgres menos uno |
   | `REEMPLAZAR_CRED_CONFIG_RO` | `tesoreria-escolar-db · config_ro` | Postgres | **un solo nodo**: `Postgres - Secreto`, en `tes/validar-token` |
   | `REEMPLAZAR_CRED_GRAPH` | `Microsoft Graph - sales` | OAuth2 (genérica) | `Enviar respaldo (Graph)` y `Avisar (Graph)` |

   Si `config_ro` aparece en cualquier otro nodo, está mal.

   ℹ️ **El rol `log_ins` NO tiene credencial en n8n**, y no es un olvido:
   ningún workflow lo usa. Existe en la base como la puerta más angosta
   posible —solo `INSERT` sobre `bitacora`— para cualquier cosa futura que
   solo tenga que dejar rastro. Los workflows escriben la bitácora con
   `app_rw` a través de `bitacora_escribir()`, que es lo que permite que
   entre en la MISMA transacción que el cambio.
3. **`REEMPLAZAR_ID_VALIDAR_TOKEN`**: el id que n8n le dé a
   `tes/validar-token` al importarlo. Va en los cinco de API, en el nodo
   «Validar token». **Importa ése primero.**
4. Los correos de los dos cron **no se ponen aquí**: salen de la tabla
   `config_app` (`correo_destino` y `correo_origen`). El repositorio es
   público y un correo personal es dato personal aunque no sea secreto.
5. Los webhooks nacen con id nuevo: confirma que la ruta sea `tes/<lo que
   sea>` y no otra cosa.
6. 🔴 **El `=` del campo `query` de los nodos Postgres.** Al importar, n8n
   convirtió `"={{ $json.sql }}"` en `"{{ $json.sql }}"` —**sin el `=`**—
   en los CINCO workflows de API. Sin ese `=` el valor deja de ser una
   expresión: el nodo le manda a Postgres la cadena literal
   `{{ $json.sql }}` y la consulta nunca corre.

   Pasó el 17-sep-2026 al importar los ocho a mano. El repo los trae
   bien; lo perdió la importación. Los nodos afectados son
   `Postgres - Ejecutar` (lectura, presupuestos, tesorería, admin) y
   `Postgres - Aplicar` (auth).

   **Cómo se ve si vuelve a pasar:** el validador de n8n lo dice
   (`MISSING_EXPRESSION_PREFIX`), y en la UI el campo aparece como texto
   plano en vez de expresión. **Cómo se comprueba:** leer el workflow de
   vuelta y confirmar que `query` empieza con `=`. No basta con mirar el
   JSON del repo — el repo estaba bien.

Y después de activar: **vuelve a leer el workflow** y confirma que
`active` quedó en `true`. El éxito del guardado no lo prueba.
