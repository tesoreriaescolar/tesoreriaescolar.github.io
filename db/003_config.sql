-- =====================================================================
--  Tesorería Escolar — tabla de configuración (la DÉCIMA tabla)
--  Migración 003. Con el rol DUEÑO, después de 002.
--
--  ⚠️ ESTA TABLA NO ES UNA DE LAS NUEVE Y NO VA EN EL RESPALDO.
--  Guarda el secreto del JWT y las llaves del bucket.
--
--  Por qué existe, en una línea: los workflows corren en el n8n de FTS
--  (decisión A), y meter estos secretos como variables de entorno de
--  ESE servicio significa reiniciar el n8n de FTS. Guardarlos aquí los
--  deja al alcance del único workflow que los necesita sin tocar nada
--  de FTS. La credencial de Postgres de n8n es entonces el único
--  secreto que vive fuera de la base.
-- =====================================================================

BEGIN;

CREATE TABLE config (
  clave       text        PRIMARY KEY,
  valor       text        NOT NULL,
  actualizado timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE config IS
  'Secretos de operación. NO va en el respaldo de las 3 am. NO es una de las nueve.';

-- app_rw la LEE. No la escribe: rotar un secreto es un acto deliberado
-- que se hace a mano con el rol dueño, no algo que pueda pasar por un
-- endpoint. Si un día app_rw pudiera escribir aquí, un error en un
-- workflow de admin podría dejar el sistema sin llaves.
GRANT SELECT ON config TO app_rw;

-- Los renglones. Cámbialos por los de verdad ANTES de correr esto, o
-- córrelo así y luego haz UPDATE. Los valores no se pegan en el chat.
INSERT INTO config (clave, valor) VALUES
  ('jwt_secret',  'CAMBIAME_cadena_larga_al_azar_de_64_caracteres_o_mas'),
  ('s3_endpoint', 'CAMBIAME_https://...railway.app'),
  ('s3_region',   'us-east-1'),
  ('s3_bucket',   'tesoreria-tickets'),
  ('s3_key_id',   'CAMBIAME'),
  ('s3_secret',   'CAMBIAME');

COMMIT;

-- Comprobación de que app_rw NO puede escribirla:
--   SET ROLE app_rw;  UPDATE config SET valor='x' WHERE clave='jwt_secret';
--   -> tiene que decir: permission denied for table config
--   RESET ROLE;
