-- =====================================================================
--  Tesorería Escolar — esquema inicial
--  Migración 001. Se corre UNA vez, con el rol DUEÑO de la base.
--
--  Nueve tablas: cuatro de estructura escolar (lo que permite pasar de
--  año sin perder historial) y cinco de operación.
--
--  Dos roles de aplicación al final. El dueño NO se usa en n8n.
-- =====================================================================

BEGIN;

-- Nadie crea objetos en public salvo el dueño.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- ---------------------------------------------------------------------
-- 1. ciclos — el año escolar. Solo uno activo a la vez.
-- ---------------------------------------------------------------------
CREATE TABLE ciclos (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre      text        NOT NULL,              -- '2026-2027'
  grado       text        NOT NULL,              -- 'PS3'
  activo      boolean     NOT NULL DEFAULT false,
  creado_en   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ciclos_nombre_uq UNIQUE (nombre),
  CONSTRAINT ciclos_nombre_ok CHECK (btrim(nombre) <> ''),
  CONSTRAINT ciclos_grado_ok  CHECK (btrim(grado)  <> '')
);

-- El candado que hace que "el ciclo activo" sea una frase con sentido.
CREATE UNIQUE INDEX ciclos_un_solo_activo ON ciclos (activo) WHERE activo;

-- ---------------------------------------------------------------------
-- 2. grupos — los salones. Pueden ser 3, 4 o los que haya.
--    El frontend los pinta desde aquí, nunca desde código.
-- ---------------------------------------------------------------------
CREATE TABLE grupos (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ciclo_id    bigint      NOT NULL REFERENCES ciclos(id) ON DELETE RESTRICT,
  letra       text        NOT NULL,              -- 'A'
  nombre      text        NOT NULL,              -- 'PS3A'  (el visible)
  color       text        NOT NULL,              -- '#4C6EF5'
  orden       smallint    NOT NULL DEFAULT 0,    -- cómo se acomodan en pantalla
  creado_en   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT grupos_letra_uq  UNIQUE (ciclo_id, letra),
  CONSTRAINT grupos_nombre_ok CHECK (btrim(nombre) <> ''),
  CONSTRAINT grupos_letra_ok  CHECK (btrim(letra)  <> ''),
  -- Color en hex de 6 dígitos. El frontend lo mete tal cual en el CSS,
  -- así que aquí se valida la forma: es la frontera, no el navegador.
  CONSTRAINT grupos_color_ok  CHECK (color ~ '^#[0-9A-Fa-f]{6}$')
);
CREATE INDEX grupos_ciclo_ix ON grupos (ciclo_id, orden, letra);

-- ---------------------------------------------------------------------
-- 3. personas — quién es. SIN grupo ni rol pegados: eso es de la
--    membresía, y por eso la persona sobrevive el cambio de año.
-- ---------------------------------------------------------------------
CREATE TABLE personas (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre      text        NOT NULL,
  usuario     text        NOT NULL,
  hash        text        NOT NULL,              -- bcrypt. Nunca sale de la base.
  creado_en   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT personas_nombre_ok CHECK (btrim(nombre) <> '')
);

-- Usuario único sin distinguir mayúsculas: 'p3b' y 'P3B' son la misma.
CREATE UNIQUE INDEX personas_usuario_uq ON personas (lower(usuario));

-- ---------------------------------------------------------------------
-- 4. membresias — qué es esa persona EN UN CICLO.
--    Aquí viven el rol, el grupo y los permisos.
-- ---------------------------------------------------------------------
CREATE TABLE membresias (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  persona_id  bigint      NOT NULL REFERENCES personas(id) ON DELETE RESTRICT,
  ciclo_id    bigint      NOT NULL REFERENCES ciclos(id)   ON DELETE RESTRICT,
  grupo_id    bigint          NULL REFERENCES grupos(id)   ON DELETE RESTRICT,
  rol         text        NOT NULL,
  permisos    jsonb       NOT NULL DEFAULT
                '{"tickets":false,"ver_presupuesto":true,"ver_todos_los_grupos":false}'::jsonb,
  activo      boolean     NOT NULL DEFAULT true,
  creado_en   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT membresias_uq  UNIQUE (persona_id, ciclo_id),
  CONSTRAINT membresias_rol_ok CHECK (rol IN ('admin','rep','mama')),
  -- La tesorera general no es de ningún salón; representante y mamá sí.
  CONSTRAINT membresias_grupo_ok CHECK (
    (rol = 'admin' AND grupo_id IS NULL) OR
    (rol <> 'admin' AND grupo_id IS NOT NULL)
  ),
  -- Las tres llaves de permisos existen siempre y son booleanas.
  --
  -- El coalesce NO sobra. Si la llave falta, `permisos -> 'x'` da NULL,
  -- `jsonb_typeof(NULL)` da NULL, y un CHECK que se evalua a NULL
  -- SE CONSIDERA CUMPLIDO: la restriccion dejaria pasar justo el caso
  -- que existe para atrapar. Con el coalesce compara contra '' y falla.
  CONSTRAINT membresias_permisos_ok CHECK (
    coalesce(jsonb_typeof(permisos -> 'tickets'), '')              = 'boolean' AND
    coalesce(jsonb_typeof(permisos -> 'ver_presupuesto'), '')      = 'boolean' AND
    coalesce(jsonb_typeof(permisos -> 'ver_todos_los_grupos'), '') = 'boolean'
  )
);
CREATE INDEX membresias_ciclo_ix  ON membresias (ciclo_id, activo);
CREATE INDEX membresias_grupo_ix  ON membresias (grupo_id);

-- El grupo de una membresía tiene que ser del MISMO ciclo que la membresía.
-- Sin esto, una representante de PS3A queda "representante" de un grupo
-- del año pasado y el filtrado por grupo deja de significar algo.
CREATE OR REPLACE FUNCTION membresias_grupo_del_ciclo() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.grupo_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM grupos g
                     WHERE g.id = NEW.grupo_id AND g.ciclo_id = NEW.ciclo_id) THEN
    RAISE EXCEPTION 'El grupo % no pertenece al ciclo %', NEW.grupo_id, NEW.ciclo_id;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER membresias_grupo_del_ciclo_tg
  BEFORE INSERT OR UPDATE ON membresias
  FOR EACH ROW EXECUTE FUNCTION membresias_grupo_del_ciclo();

-- ---------------------------------------------------------------------
-- 5. presupuestos — lo que se planea gastar.
-- ---------------------------------------------------------------------
CREATE TABLE presupuestos (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ciclo_id            bigint      NOT NULL REFERENCES ciclos(id) ON DELETE RESTRICT,
  grupo_id            bigint      NOT NULL REFERENCES grupos(id) ON DELETE RESTRICT, -- quién lo prepara
  nombre              text        NOT NULL DEFAULT '',
  fecha               date            NULL,
  tipo                text        NOT NULL,
  estado              text        NOT NULL DEFAULT 'creacion',
  responsable         text        NOT NULL DEFAULT '',
  ninos               integer     NOT NULL DEFAULT 0,
  ninas               integer     NOT NULL DEFAULT 0,
  adultos             integer     NOT NULL DEFAULT 0,
  conceptos           jsonb       NOT NULL DEFAULT '[]'::jsonb,
  banco               text        NOT NULL DEFAULT '',
  clabe               text        NOT NULL DEFAULT '',
  titular             text        NOT NULL DEFAULT '',
  prestado_a_grupo_id bigint          NULL REFERENCES grupos(id) ON DELETE RESTRICT,
  prestamo_hasta      timestamptz     NULL,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  actualizado_en      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT presupuestos_tipo_ok   CHECK (tipo   IN ('generacion','salon')),
  CONSTRAINT presupuestos_estado_ok CHECK (estado IN ('creacion','confirmado')),
  CONSTRAINT presupuestos_conteos_ok CHECK (ninos >= 0 AND ninas >= 0 AND adultos >= 0),
  -- CLABE: vacía, o 18 dígitos. Nada a medias.
  CONSTRAINT presupuestos_clabe_ok  CHECK (clabe = '' OR clabe ~ '^[0-9]{18}$'),
  CONSTRAINT presupuestos_conceptos_ok CHECK (jsonb_typeof(conceptos) = 'array'),
  -- El préstamo es las dos columnas o ninguna. Media pareja es un estado
  -- que nadie sabe leer: con fecha y sin grupo, ¿prestado a quién?
  CONSTRAINT presupuestos_prestamo_ok CHECK (
    (prestado_a_grupo_id IS     NULL AND prestamo_hasta IS     NULL) OR
    (prestado_a_grupo_id IS NOT NULL AND prestamo_hasta IS NOT NULL)
  ),
  -- Nadie se presta a sí mismo.
  CONSTRAINT presupuestos_prestamo_otro_ok CHECK (
    prestado_a_grupo_id IS NULL OR prestado_a_grupo_id <> grupo_id
  )
);
CREATE INDEX presupuestos_ciclo_ix ON presupuestos (ciclo_id, tipo, grupo_id);

-- ---------------------------------------------------------------------
-- 6. eventos — el presupuesto confirmado, ya en el tablero.
--    total_congelado se fija AL CONFIRMAR y no se vuelve a calcular.
-- ---------------------------------------------------------------------
CREATE TABLE eventos (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  presupuesto_id   bigint        NOT NULL REFERENCES presupuestos(id) ON DELETE RESTRICT,
  nombre           text          NOT NULL,
  fecha            date              NULL,
  tipo             text          NOT NULL,
  grupo_id         bigint            NULL REFERENCES grupos(id) ON DELETE RESTRICT,
  total_congelado  numeric(12,2) NOT NULL,
  creado_en        timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT eventos_presupuesto_uq UNIQUE (presupuesto_id),
  CONSTRAINT eventos_tipo_ok CHECK (tipo IN ('generacion','salon')),
  -- Uno de generación no es de nadie; uno de salón siempre tiene dueño.
  CONSTRAINT eventos_grupo_ok CHECK (
    (tipo = 'generacion' AND grupo_id IS     NULL) OR
    (tipo = 'salon'      AND grupo_id IS NOT NULL)
  ),
  CONSTRAINT eventos_total_ok CHECK (total_congelado >= 0)
);
CREATE INDEX eventos_grupo_ix ON eventos (tipo, grupo_id);

-- ---------------------------------------------------------------------
-- 7. evento_grupo — los números REALES. Se mueven después del
--    presupuesto y son independientes de él.
-- ---------------------------------------------------------------------
CREATE TABLE evento_grupo (
  evento_id       bigint        NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
  grupo_id        bigint        NOT NULL REFERENCES grupos(id)  ON DELETE RESTRICT,
  recaudado       numeric(12,2) NOT NULL DEFAULT 0,
  adultos         integer       NOT NULL DEFAULT 0,
  ninos           integer       NOT NULL DEFAULT 0,
  ninas           integer       NOT NULL DEFAULT 0,
  actualizado_en  timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (evento_id, grupo_id),
  CONSTRAINT evento_grupo_recaudado_ok CHECK (recaudado >= 0),
  CONSTRAINT evento_grupo_conteos_ok   CHECK (adultos >= 0 AND ninos >= 0 AND ninas >= 0)
);

-- ---------------------------------------------------------------------
-- 8. gastos — lo que de verdad se pagó. ticket_key es la LLAVE en el
--    bucket, nunca la foto: las fotos no entran a la base.
-- ---------------------------------------------------------------------
CREATE TABLE gastos (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  evento_id      bigint        NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
  fecha_pago     date          NOT NULL,
  descripcion    text          NOT NULL,
  proveedor      text          NOT NULL DEFAULT '',
  monto          numeric(12,2) NOT NULL,
  ticket_key     text              NULL,
  ticket_nombre  text              NULL,   -- el nombre del archivo, para enseñarlo
  ticket_por     text              NULL,   -- quién lo subió
  ticket_en      timestamptz       NULL,   -- cuándo
  creado_en      timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT gastos_monto_ok       CHECK (monto > 0),
  CONSTRAINT gastos_descripcion_ok CHECK (btrim(descripcion) <> ''),
  -- Si hay llave hay metadatos, y al revés. Un ticket a medias se ve
  -- en pantalla como un ticket que existe y no se puede abrir.
  CONSTRAINT gastos_ticket_ok CHECK (
    (ticket_key IS     NULL AND ticket_nombre IS     NULL AND ticket_por IS     NULL AND ticket_en IS     NULL) OR
    (ticket_key IS NOT NULL AND ticket_nombre IS NOT NULL AND ticket_por IS NOT NULL AND ticket_en IS NOT NULL)
  )
);
CREATE INDEX gastos_evento_ix ON gastos (evento_id, fecha_pago DESC);

-- ---------------------------------------------------------------------
-- 9. bitacora — quién hizo qué. Solo crece.
-- ---------------------------------------------------------------------
CREATE TABLE bitacora (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  persona_id   bigint          NULL REFERENCES personas(id) ON DELETE RESTRICT,
  accion       text        NOT NULL,
  tabla        text        NOT NULL,
  registro_id  bigint          NULL,
  antes        jsonb           NULL,
  despues      jsonb           NULL,
  ip           inet            NULL,
  creado_en    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bitacora_fecha_ix   ON bitacora (creado_en DESC);
CREATE INDEX bitacora_persona_ix ON bitacora (persona_id, creado_en DESC);
CREATE INDEX bitacora_registro_ix ON bitacora (tabla, registro_id, creado_en DESC);

COMMIT;
