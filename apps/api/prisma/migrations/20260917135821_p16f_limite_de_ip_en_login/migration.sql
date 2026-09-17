-- Un tipo de evento nuevo: la IP limitada por rociado de contrasenas.
--
-- D-16.196, ADR-028. NO es `auth.login.blocked`, y la diferencia no es de
-- matiz: «bloqueado» dice que una CUENTA esta cerrada por sus propios fallos;
-- esto dice que una DIRECCION esta tanteando muchas cuentas y tiene que
-- esperar. Detras de una IP compartida puede no haber nadie culpable, y quien
-- lea el log tiene que poder distinguirlo sin adivinar por el `detail`.
--
-- `requires_company` es false, como el resto de los eventos de autenticacion:
-- cuando esto salta todavia no se sabe de quien es el intento — ni hace falta.

-- ===== MANUAL: BEGIN =====
INSERT INTO "audit_event_type" ("code", "domain", "requires_company") VALUES
  ('auth.login.ip_limited', 'auth', false);
-- ===== MANUAL: END =====
