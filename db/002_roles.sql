-- =====================================================================
--  Tesorería Escolar — roles y permisos
--  Migración 002. Se corre con el rol DUEÑO, después de 001.
--
--  Antes de correrla, cambia las dos contraseñas de abajo. Y no las
--  pegues en el chat ni las guardes en el repo: van directo a la
--  credencial de n8n.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
--  Los dos roles
-- ---------------------------------------------------------------------
CREATE ROLE app_rw    LOGIN PASSWORD 'CAMBIAME_app_rw';
CREATE ROLE log_ins   LOGIN PASSWORD 'CAMBIAME_log_ins';

-- config_ro existe para UNA cosa: leer el secreto del JWT, y solo la usa
-- el subflujo tes/validar-token. Con el secreto se FIRMAN tokens, o sea
-- que quien lo alcance puede fabricarse una sesion de tesorera general.
-- Por eso no lo alcanza la credencial con la que corren los cinco
-- workflows de API: una inyeccion en cualquiera de ellos llegaria hasta
-- donde llegue app_rw, y app_rw no llega aqui.
CREATE ROLE config_ro LOGIN PASSWORD 'CAMBIAME_config_ro';

-- El nombre de la base cambia segun donde se restaure, asi que se
-- resuelve en tiempo de ejecucion. La etiqueta del bloque va CON NOMBRE
-- ($grant$ y no $$): un $$ suelto se descompone si este archivo viaja
-- por una expresion de n8n, y depurarlo desde el error de Postgres es
-- una tarde perdida.
DO $grant$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_rw, log_ins, config_ro', current_database());
END
$grant$;
GRANT USAGE   ON SCHEMA   public          TO app_rw, log_ins, config_ro;

-- ---------------------------------------------------------------------
--  app_rw — lee y escribe las OCHO tablas de operación.
--  Sobre bitacora no tiene NADA: ni SELECT, ni INSERT, ni nada.
-- ---------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON
  ciclos, grupos, personas, membresias,
  presupuestos, eventos, evento_grupo, gastos
TO app_rw;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_rw;

-- ---------------------------------------------------------------------
--  log_ins — SOLO INSERT en bitacora. Sin SELECT, sin UPDATE,
--  sin DELETE. Ni siquiera puede leer lo que él mismo escribió.
-- ---------------------------------------------------------------------
GRANT INSERT ON bitacora TO log_ins;
GRANT USAGE, SELECT ON SEQUENCE bitacora_id_seq TO log_ins;

-- ---------------------------------------------------------------------
--  ⚠️ La puerta de la bitácora — lee esto antes de cambiarlo
--
--  El requisito dice dos cosas que, tomadas al pie de la letra, no
--  caben juntas:
--
--    (a) "app_rw lee y escribe las OCHO tablas de operación"
--        -> o sea, sobre bitacora no tiene permiso
--    (b) "cada cambio escribe su bitácora en la MISMA transacción;
--         si falla la bitácora, se revierte el cambio"
--
--  Dos credenciales son dos conexiones, y dos conexiones son dos
--  transacciones: si log_ins escribiera el renglón, un fallo suyo NO
--  podría revertir el cambio que hizo app_rw. La bitácora quedaría
--  como una foto que a veces sale movida, justo en los casos que
--  importan.
--
--  La salida no es aflojar (a) ni renunciar a (b): es una función
--  SECURITY DEFINER. Corre con los permisos del DUEÑO, así que mete
--  el renglón aunque app_rw no tenga permiso sobre la tabla, y corre
--  DENTRO de la transacción de quien la llama, así que si truena,
--  se cae todo junto — que es exactamente lo que se pidió.
--
--  Lo que app_rw gana es una sola puerta: puede AGREGAR un renglón
--  de bitácora y nada más. No puede leerla, ni editarla, ni borrarla.
--  Sigue siendo "solo escribe las ocho tablas", con una rendija del
--  ancho de un INSERT.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION bitacora_escribir(
  p_persona_id  bigint,
  p_accion      text,
  p_tabla       text,
  p_registro_id bigint,
  p_antes       jsonb,
  p_despues     jsonb,
  p_ip          text
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_id bigint;
  v_ip inet;
BEGIN
  IF p_accion IS NULL OR btrim(p_accion) = '' THEN
    RAISE EXCEPTION 'bitacora: la acción no puede ir vacía';
  END IF;
  IF p_tabla IS NULL OR btrim(p_tabla) = '' THEN
    RAISE EXCEPTION 'bitacora: la tabla no puede ir vacía';
  END IF;

  -- Una IP mal formada NO tumba la operación: se guarda en nulo. El
  -- renglón de bitácora vale por el quién y el qué, no por el desde
  -- dónde, y no vamos a revertir un gasto legítimo porque un
  -- proxy mandó una cabecera rara.
  BEGIN
    v_ip := nullif(btrim(p_ip), '')::inet;
  EXCEPTION WHEN others THEN
    v_ip := NULL;
  END;

  INSERT INTO bitacora (persona_id, accion, tabla, registro_id, antes, despues, ip)
  VALUES (p_persona_id, btrim(p_accion), btrim(p_tabla), p_registro_id, p_antes, p_despues, v_ip)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

-- Que no quede abierta a todo el mundo por el default de Postgres.
REVOKE ALL ON FUNCTION bitacora_escribir(bigint,text,text,bigint,jsonb,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bitacora_escribir(bigint,text,text,bigint,jsonb,jsonb,text) TO app_rw;

-- ---------------------------------------------------------------------
--  Nada de permisos por omisión para tablas futuras. Si mañana se
--  agrega una tabla, se le dan permisos a mano y a propósito.
-- ---------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC;

COMMIT;

-- =====================================================================
--  Comprobación. Córrela después y lee la salida: el GRANT que se
--  aplicó sin error igual puede no ser el que creías.
--
--    SELECT grantee, table_name, string_agg(privilege_type, ', ' ORDER BY privilege_type)
--      FROM information_schema.role_table_grants
--     WHERE grantee IN ('app_rw','log_ins')
--     GROUP BY grantee, table_name
--     ORDER BY grantee, table_name;
--
--  Lo que tiene que salir:
--    app_rw  -> ocho renglones con DELETE, INSERT, SELECT, UPDATE
--               y NINGUNO que diga bitacora
--    log_ins -> un solo renglón: bitacora, INSERT
-- =====================================================================

-- =====================================================================
--  ultimo_respaldo() — la única ventana de LECTURA a la bitácora
--
--  El vigía de las 9 am necesita saber si el respaldo de las 3 am
--  corrió. Ese dato vive en la bitácora, y app_rw no la puede leer
--  (ni debe). En vez de aflojar el GRANT, esta función devuelve UN
--  timestamp y nada más: ni el quién, ni el qué, ni el antes y después.
--
--  Es el mismo criterio que bitacora_escribir: la puerta más angosta
--  que resuelve el problema, en vez de la llave maestra.
-- =====================================================================
CREATE OR REPLACE FUNCTION ultimo_respaldo() RETURNS timestamptz
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $fn$
  SELECT max(creado_en) FROM bitacora WHERE accion = 'respaldo';
$fn$;

REVOKE ALL ON FUNCTION ultimo_respaldo() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ultimo_respaldo() TO app_rw;
