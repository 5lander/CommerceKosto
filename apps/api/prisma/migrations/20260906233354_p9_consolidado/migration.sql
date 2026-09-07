-- P9 — Consolidado de company y comparativa entre ubicaciones.
--
-- NO HAY CAMBIO DE ESQUEMA, y eso es lo que dice que P8 dejo el terreno hecho:
-- el consolidado es la suma de lo que cada ubicacion ya publica, no una tabla
-- nueva. Lo unico que P9 anade a la base es un PERMISO.

-- ===== MANUAL: BEGIN =====

-- UN PERMISO DE NIVEL COMPANY, Y `GERENTE_LOCAL` NO LO RECIBE.
--
-- Es la misma linea que P4 trazo con la propagacion de recetas y que E18
-- verifica: un gerente manda en su local, no en la cadena. El consolidado le
-- ensenaria las ventas, los margenes y el food cost de los locales de sus
-- companeros, sumados y comparados uno al lado del otro — que es exactamente la
-- escalada horizontal de CLAUDE.md §4.4 con otro disfraz.
--
-- `LECTURA` SI lo recibe: es un rol de solo lectura de nivel company, pensado
-- para el contador o el socio que mira numeros y no toca nada.
INSERT INTO "permission" ("code", "domain") VALUES
  ('analytics.consolidated.read', 'analytics');

INSERT INTO "role_permission" ("role_code", "permission_code")
  SELECT r, 'analytics.consolidated.read'
  FROM unnest(ARRAY['OWNER', 'ADMIN', 'LECTURA']) AS r;

-- ===== MANUAL: END =====
