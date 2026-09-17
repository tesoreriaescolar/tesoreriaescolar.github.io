#!/usr/bin/env python3
"""
Ensambla los ocho workflows de n8n a partir de los fuentes de src/.

  python3 n8n/build.py        -> escribe n8n/workflows/*.json

Por qué existe en vez de editar el JSON a mano: los nodos Code llevan
adentro la librería de cripto, que es la misma en varios workflows. Un
carácter distinto entre copias es un bug que solo aparece como "la
contraseña no coincide". Aquí se escribe UNA vez y se inyecta.

⚠️ La inyección usa  s.replace(marca, lambda _: lib)  y NO  s.replace(marca, lib).
   La librería contiene la cadena  'pbkdf2$' + it  y en JavaScript —y en
   Python con re.sub— el  $'  es un patrón de reemplazo. Con la forma
   directa, el texto inyectado sale mutilado y el error que se ve después
   no habla de eso. Aquí se usa str.replace de Python, que NO interpreta
   patrones, pero se deja escrito porque el mismo archivo se inyecta
   también desde JavaScript en las pruebas.
"""
import json, os, re, uuid, hashlib

AQUI = os.path.dirname(os.path.abspath(__file__))
SRC  = os.path.join(AQUI, 'src')
OUT  = os.path.join(AQUI, 'workflows')

# Marcadores que se reemplazan a mano al importar en n8n.
CRED_APP = {"id": "REEMPLAZAR_CRED_APP_RW",  "name": "tesoreria-escolar-db · app_rw"}
# Solo la usa tes/validar-token. Ver db/003_config.sql.
CRED_CFG = {"id": "REEMPLAZAR_CRED_CONFIG_RO", "name": "tesoreria-escolar-db · config_ro"}
# No hay credencial SMTP en esta instancia: el correo de FTS sale por
# Microsoft Graph con una credencial OAuth2 de aplicacion. Se copia el
# patron de comercial/cotizacion, que ya lo usa en produccion.
CRED_GRAPH = {"id": "REEMPLAZAR_CRED_GRAPH", "name": "Microsoft Graph - sales"}
ID_VALIDAR = "REEMPLAZAR_ID_VALIDAR_TOKEN"

# El navegador solo puede llamar a estos webhooks desde el dominio de la
# aplicación. No es lo que impide entrar —eso lo hace el token, que va en
# el cuerpo— pero recorta a quién le contesta el navegador y no cuesta.
ORIGEN_PAGES = "https://tesoreriaescolar.github.io"

# ---------------------------------------------------------------------
#  Workflows que NO pueden guardar sus ejecuciones.
#
#  n8n guarda la SALIDA DE CADA NODO de las ejecuciones que conserva. Da
#  igual que el nodo no lance: en el camino feliz, lo que el nodo
#  devuelve se escribe tal cual en la base de n8n. O sea que un nodo que
#  devuelve un secreto lo escribe EN CLARO, en cada petición.
#
#  Los cinco, y qué se guardaba de cada uno:
#    tes/validar-token  el secreto del JWT, en CADA petición del sistema
#    tes/tesoreria      s3_key_id y s3_secret, en cada acción de ticket
#    tes/auth           el hash de la persona, en cada intento de login
#    tes/respaldo       la base ENTERA: CLABEs SIN enmascarar y todos los
#                       hashes. El enmascarado ocurre en el nodo
#                       SIGUIENTE, así que lo que se guardaba era el
#                       volcado crudo, cada noche
#    tes/vigia          un correo personal
#
#  ⚠️ saveManualExecutions TAMBIÉN va en false, y no es un detalle: se
#  rige por su propia bandera. Una corrida a mano desde la UI —que es
#  justo lo que se hace al importar y probar— guardaría todo aunque las
#  otras dos digan "none". Cerrar solo las dos primeras deja abierta la
#  puerta por la que más fácil se entra.
#
#  Lo que cuesta: en estos cinco no hay datos de ejecución que mirar
#  cuando algo falle. Si hace falta depurar uno, se pone su
#  saveDataErrorExecution en "all" un rato Y SE VUELVE A DEJAR EN "none".
#  Que un fallo del respaldo no se note lo cubre el vigía de las 9 am.
#
#  ⚠️ Esto es un AJUSTE, no una propiedad del diseño: quien lo cambie en
#  la UI reabre el hoyo sin que nada avise. El arreglo estructural es que
#  el secreto no sea nunca la salida de un nodo — ver la propuesta de
#  pgcrypto en el issue #1.
# ---------------------------------------------------------------------
SIN_GUARDAR = {"tes/validar-token", "tes/tesoreria", "tes/auth",
               "tes/respaldo", "tes/vigia"}
# Los correos NO viven aquí: salen de la tabla config_app. Este
# repositorio es público, y un correo personal es dato personal aunque no
# sea un secreto — y borrarlo de un archivo no lo borra del historial.

def leer(nombre):
    with open(os.path.join(SRC, nombre), encoding='utf8') as f:
        return f.read()

LIB_CRIPTO = leer('lib-cripto.js')
LIB_S3     = leer('lib-s3.js')

def js(nombre):
    """Lee un nodo Code e inyecta las librerías que pida."""
    s = leer(nombre)
    for marca, lib in (('// <<<LIB_CRIPTO>>>', LIB_CRIPTO), ('// <<<LIB_S3>>>', LIB_S3)):
        if marca in s:
            n = s.count(marca)
            if n != 1:
                raise SystemExit('%s: la marca %s aparece %d veces, esperaba 1' % (nombre, marca, n))
            s = s.replace(marca, lib)
    # Ninguna marca puede quedar viva.
    if '<<<' in s:
        raise SystemExit('%s: quedo una marca sin resolver' % nombre)
    return s

def nid(wf, nombre):
    """Id estable y reproducible: mismo fuente, mismo id. Un uuid al azar
    haria que cada build pareciera un cambio."""
    h = hashlib.sha1(('tes/' + wf + '/' + nombre).encode('utf8')).hexdigest()
    return '%s-%s-4%s-8%s-%s' % (h[0:8], h[8:12], h[13:16], h[17:20], h[20:32])

def n_code(wf, nombre, archivo, pos):
    return {"parameters": {"mode": "runOnceForAllItems", "language": "javaScript", "jsCode": js(archivo)},
            "id": nid(wf, nombre), "name": nombre, "type": "n8n-nodes-base.code",
            "typeVersion": 2, "position": pos}

def n_webhook(wf, ruta, pos):
    return {"parameters": {"httpMethod": "POST", "path": ruta, "responseMode": "responseNode",
                           "options": {"allowedOrigins": ORIGEN_PAGES}},
            "id": nid(wf, 'Webhook'), "name": "Webhook", "type": "n8n-nodes-base.webhook",
            "typeVersion": 2.1, "position": pos, "webhookId": nid(wf, 'hook')}

def n_pg(wf, nombre, pos, query="={{ $json.sql }}", params="={{ $json.params }}", cred=None):
    """Nodo Postgres.

    ⚠️ alwaysOutputData NO es opcional aquí, y cuesta explicarlo una vez:

    Cuando una consulta devuelve CERO FILAS, el nodo de Postgres emite CERO
    ITEMS, y en n8n cero items significa que TODO lo que sigue se salta.
    Incluido el "Respond to Webhook". El webhook entonces cierra con 200 y
    el cuerpo VACIO: sin error, sin nada que mirar.

    Y aqui eso no es un caso raro, es el caso NORMAL: los cinco workflows
    de API usan una consulta centinela —SELECT 0 AS afectadas WHERE false—
    para los rechazos, y tes/auth la usa tambien en el login BUENO, porque
    entrar no escribe nada. O sea que el camino feliz del login devolvia
    cero filas y la respuesta nunca se armaba.

    Con alwaysOutputData el nodo emite un item vacio, la cadena sigue, y el
    Code de respuesta arma el JSON que toca — que YA sabe manejar el caso
    vacio, porque lee el veredicto de los nodos de arriba, no de $json.

    Medido el 17-sep-2026: ejecucion 101777 (login, se corta en
    "Postgres - Aplicar" con main:[[]]) y 101780 (el mismo login con la
    bandera puesta, responde ok:true con su token).

    Es el mismo guardia que lleva comercial/cotizacion en su nodo
    "Postgres - Machote del actor", y por la misma razon.
    """
    return {"parameters": {"operation": "executeQuery", "query": query,
                           "options": {"queryReplacement": params, "queryBatching": "single",
                                       "largeNumbersOutput": "numbers"}},
            "id": nid(wf, nombre), "name": nombre, "type": "n8n-nodes-base.postgres",
            "typeVersion": 2.7, "position": pos,
            "alwaysOutputData": True,
            "credentials": {"postgres": dict(cred or CRED_APP)}}

def n_graph(wf, nombre, pos):
    """POST a Graph sendMail. El sobre completo lo arma el nodo Code de
    antes y viaja en $json.graph; aqui solo se serializa.

    El REMITENTE va en la URL y sale de config_app.correo_origen: el
    correo no se escribe en el repo, que es publico. La politica de
    acceso de Azure acota la aplicacion a una sola casilla, asi que si
    correo_origen fuera otra, Graph contesta 403 y el vigia lo grita.

    fullResponse + neverError: se quiere LEER el codigo, no que el nodo
    lance. Quien decide si hubo envio es el nodo siguiente, mirando el
    202. Exito para Graph = 202 con cuerpo vacio."""
    return {"parameters": {
                "method": "POST",
                "url": "=https://graph.microsoft.com/v1.0/users/{{ $json.correo_origen }}/sendMail",
                "authentication": "genericCredentialType",
                "genericAuthType": "oAuth2Api",
                "sendBody": True, "contentType": "raw",
                "rawContentType": "application/json",
                "body": "={{ JSON.stringify($json.graph) }}",
                "options": {"response": {"response": {"fullResponse": True,
                                                      "neverError": True}}}},
            "id": nid(wf, nombre), "name": nombre,
            "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": pos,
            "alwaysOutputData": True,
            "credentials": {"oAuth2Api": dict(CRED_GRAPH)}}

def n_respond(wf, pos):
    return {"parameters": {"respondWith": "json", "responseBody": "={{ JSON.stringify($json) }}",
                           "options": {"responseHeaders": {"entries": [
                               {"name": "Access-Control-Allow-Origin", "value": ORIGEN_PAGES},
                               {"name": "Cache-Control", "value": "no-store"}]}}},
            "id": nid(wf, 'Responder'), "name": "Respond to Webhook",
            "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1.5, "position": pos}

ESQUEMA_VALIDAR = [
    {"id": "modo",       "displayName": "modo",       "type": "string"},
    {"id": "token",      "displayName": "token",      "type": "string"},
    {"id": "persona_id", "displayName": "persona_id", "type": "number"},
]
def _esq():
    return [dict(c, required=False, defaultMatch=False, display=True, canBeUsedToMatch=True)
            for c in ESQUEMA_VALIDAR]

def n_validar(wf, pos, nombre="Validar token", valores=None):
    v = valores or {"modo": "verificar", "token": "={{ $json.token }}", "persona_id": 0}
    return {"parameters": {"workflowId": {"__rl": True, "mode": "id", "value": ID_VALIDAR},
                           "workflowInputs": {"mappingMode": "defineBelow",
                                              "value": v,
                                              "matchingColumns": [],
                                              "schema": _esq(),
                                              "attemptToConvertTypes": False,
                                              "convertFieldsToString": True},
                           "mode": "once", "options": {"waitForSubWorkflow": True}},
            "id": nid(wf, nombre), "name": nombre,
            "type": "n8n-nodes-base.executeWorkflow", "typeVersion": 1.3, "position": pos}

def conectar(nombres):
    c = {}
    for a, b in zip(nombres, nombres[1:]):
        c[a] = {"main": [[{"node": b, "type": "main", "index": 0}]]}
    return c

def wf(nombre, descripcion, nodos, activo=False):
    return {
        "name": nombre,
        "nodes": nodos,
        "connections": conectar([n["name"] for n in nodos]),
        "active": activo,
        # ⚠️ n8n DESCARTA settings.timezone al importar. Queda escrito
        # aquí para que se vea cuál debe ser, pero hay que ponerlo a mano
        # en la UI (Settings -> Timezone). Si no, los cron corren en el
        # huso de la instancia, que NO es el de Monterrey.
        "settings": dict(
            {"executionOrder": "v1", "timezone": "America/Monterrey",
             "saveDataErrorExecution": "all", "saveDataSuccessExecution": "all",
             "saveManualExecutions": True},
            **({"saveDataErrorExecution": "none", "saveDataSuccessExecution": "none",
                "saveManualExecutions": False} if nombre in SIN_GUARDAR else {})),
        "meta": {"descripcion": descripcion},
        "pinData": {}
    }

def api(nombre, ruta, armar, extra_final=None, descripcion=''):
    """Los cinco de API comparten forma: leer, validar, armar, consultar,
    responder. Lo único que cambia es el catálogo de acciones."""
    n = [n_webhook(nombre, ruta, [0, 0]),
         n_code(nombre, 'Code - Leer petición', '_leer-peticion.js', [200, 0]),
         n_validar(nombre, [400, 0]),
         n_code(nombre, 'Code - Armar consulta', armar, [600, 0]),
         n_pg(nombre, 'Postgres - Ejecutar', [800, 0])]
    if extra_final:
        n.append(n_code(nombre, extra_final[0], extra_final[1], [1000, 0]))
        n.append(n_respond(nombre, [1200, 0]))
    else:
        n.append(n_code(nombre, 'Code - Responder', '_responder.js', [1000, 0]))
        n.append(n_respond(nombre, [1200, 0]))
    return wf(nombre, descripcion, n)

# ---------------------------------------------------------------- 0
# La sesión la lee app_rw. El secreto NO viene aquí: va en su propio
# nodo, con la credencial config_ro, y DESPUÉS de éste — así el nodo que
# puede tronar por un problema de datos nunca tiene el secreto en su
# entrada (n8n mete la entrada del nodo que falla en el payload de error).
SQL_SESION = """
SELECT now() AS ahora,
       p.id AS persona_id, p.nombre, p.usuario,
       m.rol, m.grupo_id, m.permisos, m.activo AS membresia_activa,
       c.id AS ciclo_id, c.nombre AS ciclo_nombre, c.grado
  FROM (SELECT $1::bigint AS pid) q
  LEFT JOIN personas   p ON p.id = q.pid
  LEFT JOIN ciclos     c ON c.activo
  LEFT JOIN membresias m ON m.persona_id = p.id AND m.ciclo_id = c.id
""".strip()

SQL_SECRETO = "SELECT valor AS jwt_secret FROM config WHERE clave = 'jwt_secret'"

validar = wf('tes/validar-token',
  'Subflujo. EL UNICO LUGAR DEL SISTEMA DONDE SE MATERIALIZA EL SECRETO DEL JWT. '
  'Dos modos: verificar (token -> quien es y que puede) y firmar (persona -> token). '
  'Los cinco workflows de API lo llaman al entrar; tes/auth lo llama para firmar. '
  'Es el unico que usa la credencial config_ro. NO se activa: se llama como sub-workflow.',
  [{"parameters": {"inputSource": "workflowInputs",
                   "workflowInputs": {"values": [{"name": "modo", "type": "string"},
                                                 {"name": "token", "type": "string"},
                                                 {"name": "persona_id", "type": "number"}]}},
    "id": nid('validar-token', 'Entrada'), "name": "Entrada",
    "type": "n8n-nodes-base.executeWorkflowTrigger", "typeVersion": 1.2, "position": [0, 0]},
   n_code('validar-token', 'Code - Leer entrada', 'validar-token-leer.js', [200, 0]),
   n_pg('validar-token', 'Postgres - Sesión', [400, 0],
        query=SQL_SESION, params="={{ [$json.persona_id] }}"),
   # Con config_ro, y DESPUES del de sesion: su entrada no trae el secreto.
   n_pg('validar-token', 'Postgres - Secreto', [600, 0],
        query=SQL_SECRETO, params="={{ [] }}", cred=CRED_CFG),
   n_code('validar-token', 'Code - Resolver', 'validar-token-resolver.js', [800, 0])])

# ---------------------------------------------------------------- 1
# tes/auth NO lee el secreto. Solo el hash de la persona, que compara.
SQL_AUTH = """
SELECT p.id, p.usuario, p.nombre, p.hash,
       m.rol, m.grupo_id, m.permisos, m.activo,
       c.id AS ciclo_id, c.nombre AS ciclo_nombre, c.grado
  FROM (SELECT 1) q
  LEFT JOIN personas p
         ON (btrim($1::text) <> '' AND lower(p.usuario) = lower(btrim($1::text)))
         OR ($2::bigint > 0 AND p.id = $2::bigint)
  LEFT JOIN ciclos     c ON c.activo
  LEFT JOIN membresias m ON m.persona_id = p.id AND m.ciclo_id = c.id
 LIMIT 1
""".strip()

auth = wf('tes/auth',
  'Login y cambio de contrasena. PBKDF2-SHA256 100k en JS puro (el sandbox de n8n no '
  'expone crypto). Tope de 3 intentos por minuto y por usuario en staticData. '
  'NO ALCANZA EL SECRETO DEL JWT: cuando el login es bueno le pide el token al '
  'subflujo tes/validar-token, que es el unico que lo materializa.',
  [n_webhook('auth', 'tes/auth', [0, 0]),
   n_code('auth', 'Code - Leer petición', '_leer-peticion.js', [200, 0]),
   n_code('auth', 'Code - Persona a buscar', '_auth-buscar.js', [400, 0]),
   n_pg('auth', 'Postgres - Persona', [600, 0], query=SQL_AUTH,
        params="={{ [$json.usuario, $json.persona_id] }}"),
   n_code('auth', 'Code - Verificar clave', 'auth-clave.js', [800, 0]),
   # La escritura va ANTES de que exista el token, para que su entrada
   # no lo lleve. persona_id 0 = no hay nada que firmar.
   n_pg('auth', 'Postgres - Aplicar', [1000, 0]),
   n_validar('auth', [1200, 0], nombre='Firmar token',
             valores={"modo": "firmar", "token": "",
                      "persona_id": "={{ $('Code - Verificar clave').first().json.firmar_persona_id }}"}),
   n_code('auth', 'Code - Responder auth', 'auth-responder.js', [1400, 0]),
   n_respond('auth', [1600, 0])])

# ---------------------------------------------------------------- 2..5
lectura = api('tes/lectura', 'tes/lectura', 'lectura-armar.js',
  descripcion='Devuelve SOLO lo que ese token puede ver. El filtrado por grupo va en el '
              'WHERE del SQL, no recortando la respuesta. Una sola consulta, un solo renglon.')
presupuestos = api('tes/presupuestos', 'tes/presupuestos', 'presupuestos-armar.js',
  descripcion='Crear, editar, confirmar, devolver, prestar y eliminar. Confirmar congela el '
              'total en eventos.total_congelado. El vencimiento del prestamo se mide contra '
              'now() del servidor.')
tesoreria = api('tes/tesoreria', 'tes/tesoreria', 'tesoreria-armar.js',
  extra_final=('Code - Firmar URL y responder', 'tesoreria-firmar.js'),
  descripcion='Recaudacion, personas, gastos y URLs firmadas de tickets. Las fotos nunca pasan '
              'por n8n ni por la base: se firma la URL y el celular sube directo al bucket.')
admin = api('tes/admin', 'tes/admin', 'admin-armar.js',
  descripcion='Personas, membresias, permisos, ciclos, grupos y el pasar de ano. Solo rol admin. '
              'Pasar de ano crea el ciclo nuevo y copia las personas SIN activarlo ni tocar el viejo.')

# ---------------------------------------------------------------- 6
SQL_RESPALDO = """
SELECT json_build_object(
  'ciclos',       (SELECT COALESCE(json_agg(to_jsonb(t)), '[]'::json) FROM ciclos t),
  'grupos',       (SELECT COALESCE(json_agg(to_jsonb(t)), '[]'::json) FROM grupos t),
  'personas',     (SELECT COALESCE(json_agg(to_jsonb(t)), '[]'::json) FROM personas t),
  'membresias',   (SELECT COALESCE(json_agg(to_jsonb(t)), '[]'::json) FROM membresias t),
  'presupuestos', (SELECT COALESCE(json_agg(to_jsonb(t)), '[]'::json) FROM presupuestos t),
  'eventos',      (SELECT COALESCE(json_agg(to_jsonb(t)), '[]'::json) FROM eventos t),
  'evento_grupo', (SELECT COALESCE(json_agg(to_jsonb(t)), '[]'::json) FROM evento_grupo t),
  'gastos',       (SELECT COALESCE(json_agg(to_jsonb(t)), '[]'::json) FROM gastos t),
  -- La bitacora NO se puede leer con app_rw a proposito (ver 002). Del
  -- respaldo va el CONTEO, que es lo que permite notar si alguien la
  -- truncara por fuera, y los movimientos del dia van por la funcion.
  'bitacora',     '[]'::json,
  'movimientos',  '[]'::json
) AS datos,
(SELECT valor FROM config_app WHERE clave = 'correo_destino') AS correo_destino,
(SELECT valor FROM config_app WHERE clave = 'correo_origen')  AS correo_origen
""".strip()

respaldo = wf('tes/respaldo',
  'Cron 3:00 am. Vuelca las nueve tablas a JSON y lo manda por correo con los movimientos '
  'del dia. La CLABE va enmascarada (ultimos 4) y los hashes no se incluyen. Las fotos NO '
  'van: solo sus llaves. Escribe su propio renglon de bitacora, que es lo que mira el vigia.',
  [{"parameters": {"rule": {"interval": [{"field": "days", "triggerAtHour": 3, "triggerAtMinute": 0}]}},
    "id": nid('respaldo', 'Cron'), "name": "Cron 3:00 am",
    "type": "n8n-nodes-base.scheduleTrigger", "typeVersion": 1.4, "position": [0, 0]},
   n_pg('respaldo', 'Postgres - Volcar tablas', [200, 0], query=SQL_RESPALDO, params="={{ [] }}"),
   n_code('respaldo', 'Code - Armar respaldo', 'respaldo-correo.js', [400, 0]),
   n_graph('respaldo', 'Enviar respaldo (Graph)', [600, 0]),
   n_code('respaldo', 'Code - ¿Confirmado?', 'respaldo-confirmar.js', [800, 0]),
   n_pg('respaldo', 'Postgres - Marcar respaldo', [1000, 0],
        query=("SELECT bitacora_escribir(NULL, 'respaldo', 'sistema', NULL, NULL,"
               " $1::jsonb, NULL) AS bid"),
        params="={{ [JSON.stringify({conteos: $json.conteos || {}})] }}")])

# ---------------------------------------------------------------- 7
SQL_VIGIA = """
SELECT ultimo_respaldo() AS ultimo,
       now() AS ahora,
       (ultimo_respaldo() IS NULL OR ultimo_respaldo() < now() - INTERVAL '24 hours') AS hay_problema,
       (SELECT valor FROM config_app WHERE clave = 'correo_destino') AS correo_destino,
       (SELECT valor FROM config_app WHERE clave = 'correo_origen')  AS correo_origen
""".strip()

vigia = wf('tes/vigia',
  'Cron 9:00 am. Si no hubo respaldo en las ultimas 24 horas, avisa por correo. Lee la fecha '
  'con ultimo_respaldo(), la unica ventana de lectura a la bitacora que tiene app_rw.',
  [{"parameters": {"rule": {"interval": [{"field": "days", "triggerAtHour": 9, "triggerAtMinute": 0}]}},
    "id": nid('vigia', 'Cron'), "name": "Cron 9:00 am",
    "type": "n8n-nodes-base.scheduleTrigger", "typeVersion": 1.4, "position": [0, 0]},
   n_pg('vigia', 'Postgres - Último respaldo', [200, 0], query=SQL_VIGIA, params="={{ [] }}"),
   {"parameters": {"conditions": {"options": {"caseSensitive": True, "leftValue": "",
                                              "typeValidation": "loose", "version": 2},
                                  "conditions": [{"id": "hay", "operator": {"type": "boolean", "operation": "true", "singleValue": True},
                                                  "leftValue": "={{ $json.hay_problema }}", "rightValue": ""}],
                                  "combinator": "and"},
                   "looseTypeValidation": True, "options": {}},
    "id": nid('vigia', 'IF'), "name": "¿Falta respaldo?", "type": "n8n-nodes-base.if",
    "typeVersion": 2.2, "position": [400, 0]},
   n_code('vigia', 'Code - Armar aviso', 'vigia-correo.js', [600, 0]),
   n_graph('vigia', 'Avisar (Graph)', [800, 0])])

# El IF solo sigue por su salida verdadera.
vigia["connections"]["¿Falta respaldo?"] = {"main": [[{"node": "Code - Armar aviso", "type": "main", "index": 0}], []]}

TODOS = [validar, auth, lectura, presupuestos, tesoreria, admin, respaldo, vigia]

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for w in TODOS:
        nombre = w["name"].replace('tes/', '').replace('/', '-')
        ruta = os.path.join(OUT, nombre + '.json')
        with open(ruta, 'w', encoding='utf8') as f:
            json.dump(w, f, ensure_ascii=False, indent=2)
        print('%-26s %2d nodos  %7d bytes' % (w["name"], len(w["nodes"]), os.path.getsize(ruta)))
