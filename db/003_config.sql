-- =====================================================================
--  Tesorería Escolar — secretos de operación
--  Migración 003. Con el rol DUEÑO, después de 002.
--
--  ⚠️ ESTAS DOS TABLAS NO SON DE LAS NUEVE Y NO VAN EN EL RESPALDO.
--
--  Son DOS y no una porque los dos secretos no valen lo mismo:
--
--    config          el secreto del JWT. Con él se FIRMAN tokens: quien
--                    lo alcance se fabrica una sesión de tesorera
--                    general. Es el secreto que lo abre todo.
--                    -> solo lo lee config_ro, y config_ro solo la usa
--                       el subflujo tes/validar-token.
--
--    config_app      las llaves del bucket y los correos de los cron.
--                    Quien alcance las llaves puede leer
--                    y escribir fotos de tickets. Malo, pero acotado: no
--                    se convierte en permisos de nadie.
--                    -> las lee app_rw, porque tes/tesoreria tiene que
--                       firmar las URLs.
--
--  Meterlas en la misma tabla haría que el segundo riesgo arrastrara al
--  primero: cualquier cosa que pudiera leer las llaves del bucket
--  leería también el secreto del JWT.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
--  config — el secreto del JWT. Nada más.
-- ---------------------------------------------------------------------
CREATE TABLE config (
  clave       text        PRIMARY KEY,
  valor       text        NOT NULL,
  actualizado timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE config IS
  'Secreto del JWT. Solo lo lee config_ro. app_rw NO lo alcanza. No va en el respaldo.';

-- Se revoca a PUBLIC explícitamente. En Postgres una tabla nueva no le
-- da permisos a PUBLIC por omisión, así que esto no cambia nada hoy —
-- está para que la consulta de auditoría del final tenga algo que decir
-- y para que nadie lo dé por hecho leyendo.
REVOKE ALL ON config FROM PUBLIC;
REVOKE ALL ON config FROM app_rw;
REVOKE ALL ON config FROM log_ins;

-- El único que la lee. Y solo lee: rotar el secreto es un acto
-- deliberado que se hace a mano con el rol dueño.
GRANT SELECT ON config TO config_ro;

-- ---------------------------------------------------------------------
--  config_app — las llaves del bucket de tickets.
-- ---------------------------------------------------------------------
CREATE TABLE config_app (
  clave       text        PRIMARY KEY,
  valor       text        NOT NULL,
  actualizado timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE config_app IS
  'Llaves del bucket y correos de los cron. Las lee app_rw. No va en el respaldo.';

REVOKE ALL ON config_app FROM PUBLIC;
REVOKE ALL ON config_app FROM config_ro;
REVOKE ALL ON config_app FROM log_ins;

GRANT SELECT ON config_app TO app_rw;

-- ---------------------------------------------------------------------
--  Los valores. Cámbialos ANTES de correr esto, o córrelo así y luego
--  haz UPDATE. No se pegan en el chat ni en el repo.
-- ---------------------------------------------------------------------
INSERT INTO config (clave, valor) VALUES
  ('jwt_secret', 'CAMBIAME_cadena_larga_al_azar_de_64_caracteres_o_mas');

INSERT INTO config_app (clave, valor) VALUES
  ('s3_endpoint',     'CAMBIAME_https://...railway.app'),
  -- La REGION y el BUCKET salen de la pestaña Credentials del bucket.
  -- Ojo con las dos: el bucket real lleva un hash detrás del nombre
  -- que ves en el lienzo, y la region de Railway suele ser 'auto',
  -- no una de AWS. Si cualquiera de las dos esta mal, la firma no
  -- cuadra y el error que devuelve S3 no habla de esto.
  ('s3_region',       'CAMBIAME_la_REGION_de_la_pestana_Credentials'),
  -- 'virtual' (lo normal en Railway) o 'path' (buckets viejos).
  -- La pestana Credentials dice cual.
  ('s3_estilo',       'virtual'),
  ('s3_bucket',       'CAMBIAME_el_BUCKET_con_su_hash'),
  ('s3_key_id',       'CAMBIAME'),
  ('s3_secret',       'CAMBIAME'),
  -- Los correos de los dos cron viven aquí y NO en el repo: este
  -- repositorio es público, y un correo personal es dato personal
  -- aunque no sea un secreto. Borrarlo de un archivo tampoco lo borra
  -- del historial de git, así que mejor que nunca entre.
  ('correo_destino',  'CAMBIAME_a-quien-le-llega-el-respaldo'),
  ('correo_origen',   'CAMBIAME_desde-que-cuenta-se-manda');

COMMIT;

-- =====================================================================
--  COMPROBACIÓN. Córrela y LEE LA SALIDA.
-- =====================================================================
--
--  1) Los permisos sobre las dos tablas de secretos:
--
--     SELECT grantee, table_name, privilege_type
--       FROM information_schema.role_table_grants
--      WHERE table_name IN ('config','config_app')
--      ORDER BY table_name, grantee;
--
--     Tiene que salir EXACTAMENTE esto (más los renglones del dueño):
--       config         config_ro  SELECT
--       config_app  app_rw     SELECT
--     Si aparece app_rw sobre 'config', PARA. Ese es el hoyo que esta
--     migración existe para cerrar.
--
--  2) Y la prueba de verdad, que es tocar:
--
--     SET ROLE app_rw;    SELECT * FROM config;         -- permission denied
--     SET ROLE app_rw;    SELECT * FROM config_app;  -- 8 renglones
--     SET ROLE config_ro; SELECT * FROM config;         -- 1 renglón
--     SET ROLE config_ro; SELECT * FROM config_app;  -- permission denied
--     SET ROLE config_ro; SELECT * FROM personas;       -- permission denied
--     RESET ROLE;
--
--     El punto 1 dice lo que está escrito; el 2 dice lo que pasa.
-- =====================================================================
