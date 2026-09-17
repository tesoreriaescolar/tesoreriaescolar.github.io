-- =====================================================================
--  Tesorería Escolar — semilla
--  Migración 004. Con el rol DUEÑO, después de 003.
--
--  Deja el sistema utilizable: un ciclo activo, sus tres grupos, y UNA
--  persona con la que entrar. Todo lo demás se captura desde la app.
-- =====================================================================

BEGIN;

INSERT INTO ciclos (nombre, grado, activo) VALUES ('2026-2027', 'PS3', true);

INSERT INTO grupos (ciclo_id, letra, nombre, color, orden)
SELECT c.id, v.letra, v.nombre, v.color, v.orden
  FROM ciclos c
  CROSS JOIN (VALUES
      ('A', 'PS3A', '#4C6EF5', 1),   -- el azul  var(--a) del prototipo
      ('B', 'PS3B', '#E09B2D', 2),   -- el ámbar var(--b)
      ('C', 'PS3C', '#CE4C7C', 3)    -- el rosa  var(--c)
  ) AS v(letra, nombre, color, orden)
 WHERE c.nombre = '2026-2027';

-- ---------------------------------------------------------------------
--  La cuenta de la tesorera general.
--
--  ⚠️ El hash de abajo es de la contraseña 'CambiameYa'. Sirve para
--  entrar la primera vez y NADA MÁS: cámbiala desde la app antes de
--  darle acceso a nadie. Está escrito aquí a propósito, a la vista, en
--  vez de esconder una contraseña "secreta" en un repo público — que
--  es lo mismo pero con la mentira encima.
--
--  Para generar otro hash sin que la contraseña toque el chat ni el
--  repo, corre en tu laptop:  node n8n/src/hash-clave.js
-- ---------------------------------------------------------------------
INSERT INTO personas (nombre, usuario, hash) VALUES (
  'Tesorera general',
  'ADMIN',
  'pbkdf2$100000$XeSkpSYDxS3q135-WHKptQ$o7xhEv1fngsoZbgjqFctUwUgWUbZ-OB9Lfy4uUPHo6w'
);

INSERT INTO membresias (persona_id, ciclo_id, grupo_id, rol, permisos, activo)
SELECT p.id, c.id, NULL, 'admin',
       '{"tickets":true,"ver_presupuesto":true,"ver_todos_los_grupos":true}'::jsonb,
       true
  FROM personas p, ciclos c
 WHERE p.usuario = 'ADMIN' AND c.nombre = '2026-2027';

COMMIT;

-- Comprobación:
--   SELECT c.nombre, c.grado, g.letra, g.nombre, g.color FROM ciclos c
--     JOIN grupos g ON g.ciclo_id=c.id WHERE c.activo ORDER BY g.orden;
--   -> tres renglones
--   SELECT p.usuario, m.rol, m.grupo_id, m.permisos FROM personas p
--     JOIN membresias m ON m.persona_id=p.id;
--   -> uno: ADMIN / admin / null / los tres permisos en true
