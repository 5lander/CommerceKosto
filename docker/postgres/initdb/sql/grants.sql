-- Privilegios — se aplica a CADA base (costeo, costeo_shadow, y las de CI).
--
-- Es idempotente a proposito: `migrate-verify` crea bases limpias y vuelve a
-- ejecutarlo sobre cada una, de modo que las pruebas corren contra exactamente
-- los mismos privilegios que produccion. Un test de aislamiento sobre una base
-- con privilegios distintos no prueba nada.

\set ON_ERROR_STOP on

-- 1) La base: nadie por defecto ------------------------------------------------

DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO costeo_migrator, costeo_app', current_database());
  -- TEMPORARY no se concede: la aplicacion no crea tablas temporales, y una
  -- tabla temporal es una via para materializar datos fuera del alcance de RLS.

  -- EL BACK OFFICE Y EL DESPACHADOR TAMBIEN NECESITAN CONNECT, y faltaba.
  --
  -- `roles.sql` los CREA y la migracion de P11 les concede sus privilegios de
  -- tabla, pero entre las dos cosas nadie les daba entrada a la base: con el
  -- REVOKE de arriba, un cluster recien inicializado los dejaba sin poder
  -- conectarse. En la maquina de desarrollo no se notaba porque
  -- `npm run rol:backoffice` y `npm run rol:despachador` -que se ejecutan a
  -- mano sobre un cluster YA existente- si conceden CONNECT; el camino
  -- automatico no. Ver docs/incidencias/INC-033.
  --
  -- NO sobre la base sombra: es de `prisma migrate diff` y solo la toca el
  -- migrator. Minimo privilegio (CLAUDE.md 4).
  IF current_database() NOT LIKE '%shadow%' THEN
    EXECUTE format(
      'GRANT CONNECT ON DATABASE %I TO costeo_backoffice, costeo_despachador',
      current_database()
    );
  END IF;
END $$;

-- 2) El esquema public deja de ser tierra de nadie -----------------------------
--
-- PostgreSQL 15+ ya retira CREATE a PUBLIC, pero se hace explicito: la base
-- puede venir de un template alterado, y esto es documentacion ejecutable.

ALTER SCHEMA public OWNER TO costeo_migrator;
REVOKE ALL    ON SCHEMA public FROM PUBLIC;
GRANT  USAGE  ON SCHEMA public TO   costeo_app;
REVOKE CREATE ON SCHEMA public FROM costeo_app;

-- 3) Privilegios por defecto sobre lo que el migrator cree en el futuro --------
--
-- SUBCONJUNTO SEGURO A PROPOSITO: SELECT + INSERT, nunca UPDATE ni DELETE.
-- Esos dos se conceden tabla por tabla, en la migracion que la crea.
--
-- La alternativa (conceder los cuatro y revocar en las tablas append-only)
-- tiene el fallo INVERTIDO: si alguien olvida el REVOKE, el libro de inventario
-- deja de ser append-only y NADA se rompe visiblemente — R3 se viola en
-- silencio durante meses. Con este orden, si alguien olvida el GRANT UPDATE,
-- la funcionalidad falla de inmediato en los tests con un 42501.
--
-- Fallo ruidoso antes que fallo silencioso.

ALTER DEFAULT PRIVILEGES FOR ROLE costeo_migrator IN SCHEMA public
  GRANT SELECT, INSERT ON TABLES TO costeo_app;

ALTER DEFAULT PRIVILEGES FOR ROLE costeo_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO costeo_app;

ALTER DEFAULT PRIVILEGES FOR ROLE costeo_migrator IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO costeo_app;

ALTER DEFAULT PRIVILEGES FOR ROLE costeo_migrator IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- 4) Extensiones ---------------------------------------------------------------
-- pg_stat_statements se precarga por `shared_preload_libraries` en el compose;
-- aqui solo se registra la extension (CLAUDE.md §5, observabilidad).
-- pg_trgm lo necesita la deduplicacion por similitud de P2/P10.

CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Las extensiones las instala el superusuario, no el migrator: sus funciones
-- quedan disponibles para todos via el GRANT EXECUTE de arriba.
