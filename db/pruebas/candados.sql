-- =====================================================================
--  Tesorería Escolar — los 14 candados y los permisos, comprobados
--  CONTRA LA BASE DE VERDAD.
--
--  Se pega entero en la consola de Postgres de Railway y se corre. Hay
--  que correrlo con el rol DUEÑO (es el único que puede hacer SET ROLE
--  a los otros tres).
--
--  ⚠️ NO ESCRIBE NADA. Cada prueba vive en su propia subtransacción y
--  termina siempre en excepción, así que se deshace sola. Se puede
--  correr en producción con datos reales sin miedo.
--
--  Se corre DESPUÉS de las cuatro migraciones. Lee la salida: lo que
--  importa es que la columna 'resultado' diga PASA en los 14.
-- =====================================================================

-- Sin ON COMMIT DROP: la consola de Postgres corre cada sentencia en su
-- propia transacción, así que la tabla se borraría antes de usarse.
DROP TABLE IF EXISTS _r;
CREATE TEMP TABLE _r(n int, caso text, esperado text, resultado text, detalle text);

DO $prueba$
DECLARE
  v_ciclo   bigint;
  v_grupo   bigint;
  v_grupo2  bigint;
  v_persona bigint;
  v_pres    bigint;
  v_evento  bigint;
  v_ciclo2  bigint;
  v_n       int := 0;
BEGIN
  -- Cada caso de abajo DEBE fallar. Si falla -> PASA (el candado sirvió).
  -- Si NO falla -> FALLA, y hay que mirarlo.
  -- Cada uno vive en su propio BEGIN/EXCEPTION, que en plpgsql es una
  -- subtransacción: al salir por la excepción se deshace solo. Por eso
  -- este archivo no escribe nada, ni siquiera cuando un candado falla.
  SELECT id INTO v_ciclo   FROM ciclos WHERE activo LIMIT 1;
  SELECT id INTO v_grupo   FROM grupos WHERE ciclo_id = v_ciclo ORDER BY orden LIMIT 1;
  SELECT id INTO v_grupo2  FROM grupos WHERE ciclo_id = v_ciclo ORDER BY orden DESC LIMIT 1;
  SELECT id INTO v_persona FROM personas ORDER BY id LIMIT 1;

  IF v_ciclo IS NULL OR v_grupo IS NULL OR v_persona IS NULL THEN
    RAISE EXCEPTION 'Falta la semilla: corre db/004_semilla.sql antes que esto';
  END IF;

  ------------------------------------------------------------------ 1
  v_n := 1;
  BEGIN
    INSERT INTO ciclos(nombre, grado, activo) VALUES ('ZZ-PRUEBA','ZZ',true);
    RAISE EXCEPTION 'NO_FALLO';
  EXCEPTION WHEN others THEN
    INSERT INTO _r VALUES (v_n,'dos ciclos activos','ciclos_un_solo_activo',
      CASE WHEN SQLERRM='NO_FALLO' THEN 'FALLA' ELSE 'PASA' END, SQLERRM);
  END;

  ------------------------------------------------------------------ 2
  v_n := 2;
  BEGIN
    INSERT INTO personas(nombre,usuario,hash) VALUES ('ZZ','ZZPRUEBA2','h') RETURNING id INTO v_pres;
    INSERT INTO membresias(persona_id,ciclo_id,grupo_id,rol) VALUES (v_pres,v_ciclo,v_grupo,'admin');
    RAISE EXCEPTION 'NO_FALLO';
  EXCEPTION WHEN others THEN
    INSERT INTO _r VALUES (v_n,'tesorera general CON salón','membresias_grupo_ok',
      CASE WHEN SQLERRM='NO_FALLO' THEN 'FALLA' ELSE 'PASA' END, SQLERRM);
  END;

  ------------------------------------------------------------------ 3
  v_n := 3;
  BEGIN
    INSERT INTO personas(nombre,usuario,hash) VALUES ('ZZ','ZZPRUEBA3','h') RETURNING id INTO v_pres;
    INSERT INTO membresias(persona_id,ciclo_id,rol) VALUES (v_pres,v_ciclo,'rep');
    RAISE EXCEPTION 'NO_FALLO';
  EXCEPTION WHEN others THEN
    INSERT INTO _r VALUES (v_n,'representante SIN salón','membresias_grupo_ok',
      CASE WHEN SQLERRM='NO_FALLO' THEN 'FALLA' ELSE 'PASA' END, SQLERRM);
  END;

  ------------------------------------------------------------------ 4
  -- El que NO servía: jsonb_typeof de una llave ausente da NULL, y un
  -- CHECK que da NULL se considera cumplido. Este es el caso que exige
  -- volver a correrlo en cada versión de Postgres.
  v_n := 4;
  BEGIN
    INSERT INTO personas(nombre,usuario,hash) VALUES ('ZZ','ZZPRUEBA4','h') RETURNING id INTO v_pres;
    INSERT INTO membresias(persona_id,ciclo_id,grupo_id,rol,permisos)
      VALUES (v_pres,v_ciclo,v_grupo,'rep','{"tickets":true,"ver_presupuesto":true}'::jsonb);
    RAISE EXCEPTION 'NO_FALLO';
  EXCEPTION WHEN others THEN
    INSERT INTO _r VALUES (v_n,'permisos sin una de las tres llaves','membresias_permisos_ok',
      CASE WHEN SQLERRM='NO_FALLO' THEN 'FALLA' ELSE 'PASA' END, SQLERRM);
  END;

  ------------------------------------------------------------------ 5
  v_n := 5;
  BEGIN
    INSERT INTO personas(nombre,usuario,hash) VALUES ('ZZ','ZZPRUEBA5','h') RETURNING id INTO v_pres;
    INSERT INTO membresias(persona_id,ciclo_id,grupo_id,rol,permisos)
      VALUES (v_pres,v_ciclo,v_grupo,'rep',
              '{"tickets":"true","ver_presupuesto":true,"ver_todos_los_grupos":true}'::jsonb);
    RAISE EXCEPTION 'NO_FALLO';
  EXCEPTION WHEN others THEN
    INSERT INTO _r VALUES (v_n,'un permiso como texto "true"','membresias_permisos_ok',
      CASE WHEN SQLERRM='NO_FALLO' THEN 'FALLA' ELSE 'PASA' END, SQLERRM);
  END;

  ------------------------------------------------------------------ 6
  v_n := 6;
  BEGIN
    INSERT INTO personas(nombre,usuario,hash)
      SELECT 'ZZ', lower(usuario), 'h' FROM personas WHERE id = v_persona;
    RAISE EXCEPTION 'NO_FALLO';
  EXCEPTION WHEN others THEN
    INSERT INTO _r VALUES (v_n,'usuario duplicado cambiando mayúsculas','personas_usuario_uq',
      CASE WHEN SQLERRM='NO_FALLO' THEN 'FALLA' ELSE 'PASA' END, SQLERRM);
  END;

  ------------------------------------------------------------------ 7
  v_n := 7;
  BEGIN
    INSERT INTO grupos(ciclo_id,letra,nombre,color) VALUES (v_ciclo,'ZZ','ZZ','azul');
    RAISE EXCEPTION 'NO_FALLO';
  EXCEPTION WHEN others THEN
    INSERT INTO _r VALUES (v_n,'color que no es #RRGGBB','grupos_color_ok',
      CASE WHEN SQLERRM='NO_FALLO' THEN 'FALLA' ELSE 'PASA' END, SQLERRM);
  END;

  ------------------------------------------------------------------ 8
  v_n := 8;
  BEGIN
    INSERT INTO presupuestos(ciclo_id,grupo_id,tipo,clabe)
      VALUES (v_ciclo,v_grupo,'salon','012345678901');
    RAISE EXCEPTION 'NO_FALLO';
  EXCEPTION WHEN others THEN
    INSERT INTO _r VALUES (v_n,'CLABE de 12 dígitos','presupuestos_clabe_ok',
      CASE WHEN SQLERRM='NO_FALLO' THEN 'FALLA' ELSE 'PASA' END, SQLERRM);
  END;

  ------------------------------------------------------------------ 9
  v_n := 9;
  BEGIN
    INSERT INTO presupuestos(ciclo_id,grupo_id,tipo,prestado_a_grupo_id)
      VALUES (v_ciclo,v_grupo,'salon',v_grupo2);
    RAISE EXCEPTION 'NO_FALLO';
  EXCEPTION WHEN others THEN
    INSERT INTO _r VALUES (v_n,'préstamo con grupo pero sin fecha','presupuestos_prestamo_ok',
      CASE WHEN SQLERRM='NO_FALLO' THEN 'FALLA' ELSE 'PASA' END, SQLERRM);
  END;

  ----------------------------------------------------------------- 10
  v_n := 10;
  BEGIN
    INSERT INTO presupuestos(ciclo_id,grupo_id,tipo,prestado_a_grupo_id,prestamo_hasta)
      VALUES (v_ciclo,v_grupo,'salon',v_grupo,now()+interval '1 day');
    RAISE EXCEPTION 'NO_FALLO';
  EXCEPTION WHEN others THEN
    INSERT INTO _r VALUES (v_n,'prestarse a sí mismo','presupuestos_prestamo_otro_ok',
      CASE WHEN SQLERRM='NO_FALLO' THEN 'FALLA' ELSE 'PASA' END, SQLERRM);
  END;

  ----------------------------------------------------------------- 11
  v_n := 11;
  BEGIN
    INSERT INTO presupuestos(ciclo_id,grupo_id,tipo) VALUES (v_ciclo,v_grupo,'generacion')
      RETURNING id INTO v_pres;
    INSERT INTO eventos(presupuesto_id,nombre,tipo,grupo_id,total_congelado)
      VALUES (v_pres,'ZZ','generacion',v_grupo,0);
    RAISE EXCEPTION 'NO_FALLO';
  EXCEPTION WHEN others THEN
    INSERT INTO _r VALUES (v_n,'evento de generación CON dueño','eventos_grupo_ok',
      CASE WHEN SQLERRM='NO_FALLO' THEN 'FALLA' ELSE 'PASA' END, SQLERRM);
  END;

  ----------------------------------------------------------------- 12
  v_n := 12;
  BEGIN
    INSERT INTO presupuestos(ciclo_id,grupo_id,tipo) VALUES (v_ciclo,v_grupo,'generacion')
      RETURNING id INTO v_pres;
    INSERT INTO eventos(presupuesto_id,nombre,tipo,total_congelado)
      VALUES (v_pres,'ZZ','generacion',0) RETURNING id INTO v_evento;
    INSERT INTO gastos(evento_id,fecha_pago,descripcion,monto)
      VALUES (v_evento,current_date,'ZZ',0);
    RAISE EXCEPTION 'NO_FALLO';
  EXCEPTION WHEN others THEN
    INSERT INTO _r VALUES (v_n,'gasto de cero pesos','gastos_monto_ok',
      CASE WHEN SQLERRM='NO_FALLO' THEN 'FALLA' ELSE 'PASA' END, SQLERRM);
  END;

  ----------------------------------------------------------------- 13
  v_n := 13;
  BEGIN
    INSERT INTO presupuestos(ciclo_id,grupo_id,tipo) VALUES (v_ciclo,v_grupo,'generacion')
      RETURNING id INTO v_pres;
    INSERT INTO eventos(presupuesto_id,nombre,tipo,total_congelado)
      VALUES (v_pres,'ZZ','generacion',0) RETURNING id INTO v_evento;
    INSERT INTO gastos(evento_id,fecha_pago,descripcion,monto,ticket_key)
      VALUES (v_evento,current_date,'ZZ',1,'llave-sin-metadatos');
    RAISE EXCEPTION 'NO_FALLO';
  EXCEPTION WHEN others THEN
    INSERT INTO _r VALUES (v_n,'ticket con llave pero sin metadatos','gastos_ticket_ok',
      CASE WHEN SQLERRM='NO_FALLO' THEN 'FALLA' ELSE 'PASA' END, SQLERRM);
  END;

  ----------------------------------------------------------------- 14
  v_n := 14;
  BEGIN
    INSERT INTO ciclos(nombre,grado,activo) VALUES ('ZZ-PRUEBA-14','ZZ',false)
      RETURNING id INTO v_ciclo2;
    INSERT INTO grupos(ciclo_id,letra,nombre,color) VALUES (v_ciclo2,'Z','ZZ','#111111')
      RETURNING id INTO v_grupo2;
    INSERT INTO personas(nombre,usuario,hash) VALUES ('ZZ','ZZPRUEBA14','h')
      RETURNING id INTO v_pres;
    -- membresía del ciclo ACTIVO apuntando a un grupo del ciclo NUEVO
    INSERT INTO membresias(persona_id,ciclo_id,grupo_id,rol)
      VALUES (v_pres,v_ciclo,v_grupo2,'rep');
    RAISE EXCEPTION 'NO_FALLO';
  EXCEPTION WHEN others THEN
    INSERT INTO _r VALUES (v_n,'membresía con grupo de OTRO ciclo','trigger membresias_grupo_del_ciclo',
      CASE WHEN SQLERRM='NO_FALLO' THEN 'FALLA' ELSE 'PASA' END, SQLERRM);
  END;

  -------------------------------------------------- 15..19: permisos
  -- Aquí PASA significa "denegado", que es lo que se busca.
  v_n := 15;
  BEGIN
    SET LOCAL ROLE app_rw;
    PERFORM valor FROM config WHERE clave='jwt_secret';
    RESET ROLE;
    INSERT INTO _r VALUES (v_n,'app_rw lee el secreto del JWT','denegado','FALLA','¡LO LEYÓ!');
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    INSERT INTO _r VALUES (v_n,'app_rw lee el secreto del JWT','denegado','PASA',SQLERRM);
  END;

  v_n := 16;
  BEGIN
    SET LOCAL ROLE app_rw;
    PERFORM valor FROM config_app WHERE clave='s3_bucket';
    RESET ROLE;
    INSERT INTO _r VALUES (v_n,'app_rw lee las llaves del bucket','PERMITIDO','PASA','sí puede, como debe');
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    INSERT INTO _r VALUES (v_n,'app_rw lee las llaves del bucket','PERMITIDO','FALLA','no pudo: tes/tesoreria se romperá');
  END;

  v_n := 17;
  BEGIN
    SET LOCAL ROLE config_ro;
    PERFORM valor FROM config WHERE clave='jwt_secret';
    RESET ROLE;
    INSERT INTO _r VALUES (v_n,'config_ro lee el secreto del JWT','PERMITIDO','PASA','sí puede, como debe');
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    INSERT INTO _r VALUES (v_n,'config_ro lee el secreto del JWT','PERMITIDO','FALLA','no pudo: nadie podrá entrar');
  END;

  v_n := 18;
  BEGIN
    SET LOCAL ROLE config_ro;
    PERFORM count(*) FROM personas;
    RESET ROLE;
    INSERT INTO _r VALUES (v_n,'config_ro lee las personas','denegado','FALLA','¡LAS LEYÓ!');
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    INSERT INTO _r VALUES (v_n,'config_ro lee las personas','denegado','PASA',SQLERRM);
  END;

  v_n := 19;
  BEGIN
    SET LOCAL ROLE app_rw;
    PERFORM count(*) FROM bitacora;
    RESET ROLE;
    INSERT INTO _r VALUES (v_n,'app_rw lee la bitácora','denegado','FALLA','¡LA LEYÓ!');
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    INSERT INTO _r VALUES (v_n,'app_rw lee la bitácora','denegado','PASA',SQLERRM);
  END;

  RESET ROLE;
END
$prueba$;

SELECT n, caso, esperado, resultado,
       left(regexp_replace(detalle, E'\n.*', ''), 60) AS detalle
  FROM _r ORDER BY n;

SELECT CASE WHEN count(*) FILTER (WHERE resultado <> 'PASA') = 0
            THEN '✅ LOS ' || count(*) || ' PASAN'
            ELSE '❌ ' || count(*) FILTER (WHERE resultado <> 'PASA') || ' FALLARON — míralos arriba'
       END AS veredicto,
       'Postgres ' || current_setting('server_version') AS version
  FROM _r;

DROP TABLE _r;
