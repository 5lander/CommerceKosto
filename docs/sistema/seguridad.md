# Seguridad del sistema — cómo está implementada

> El **estándar** está en `docs/SEGURIDAD.md`. Este archivo documenta cómo se implementó realmente, y se actualiza en cada paquete que toque auth, datos o permisos.

## Las tres barreras de aislamiento

1. **La base de datos.** RLS deny-by-default + `FORCE ROW LEVEL SECURITY` + **rol de aplicación no-superusuario y no dueño de las tablas**. Es la única barrera que no depende de disciplina de desarrollo: un superusuario ignora RLS por diseño, así que si la app se conectara como tal toda la defensa sería decorativa
2. **La capa de transacción-con-tenant.** Envoltorio único que abre transacción interactiva y fija el tenant dentro de ella. Prohibido el cliente crudo fuera. Un `SET` fuera de transacción no persiste de forma fiable entre conexiones del pool
3. **El origen del tenant.** Sale de la sesión autenticada, nunca de la petición

Las tres son independientes: si una falla, las otras dos siguen de pie.

### Roles de base de datos

| Rol | Uso | Privilegios |
|---|---|---|
| `costeo_migrator` | Migraciones | Dueño de las tablas |
| `costeo_app` | Aplicación cliente | **No superusuario, no dueño.** Sujeto a RLS |
| `costeo_backoffice` | Back office | Puentea RLS. Pool separado, proceso separado |

### Nota sobre connection pooling

Con **PgBouncer en modo transacción**, Prisma requiere `?pgbouncer=true` por los prepared statements. El escenario se prueba explícitamente en P1: si el `SET LOCAL` no queda atado a la conexión que ejecuta la consulta, hay fuga entre tenants.

## Matriz de roles y datos

| Dato | OWNER | ADMIN | GERENTE_LOCAL | BODEGA | LECTURA |
|---|---|---|---|---|---|
| Recetas y cantidades | ✅ | ✅ | ✅ su ubicación | ❌ | configurable |
| Consumo teórico | ✅ | ✅ | ✅ su ubicación | ❌ | configurable |
| Stock teórico y diferencias | ✅ | ✅ | ✅ su ubicación | ❌ | configurable |
| Punto de reorden (cantidad) | ✅ | ✅ | ✅ su ubicación | ❌ | configurable |
| Semáforo de reposición | ✅ | ✅ | ✅ | ✅ | ✅ |
| Costos y márgenes | ✅ | ✅ | ✅ su ubicación | ❌ | configurable |
| Compras y recepción | ✅ | ✅ | ✅ su ubicación | ✅ su ubicación | ❌ |
| Conteo físico | ✅ | ✅ | ✅ su ubicación | ✅ **a ciegas** | ❌ |
| Propagar recetas | ✅ | ✅ | ❌ | ❌ | ❌ |
| Suscripción y eliminar company | ✅ | ❌ | ❌ | ❌ | ❌ |

**El filtrado se implementa como proyecciones distintas por rol en la API**, no como filtro sobre una respuesta completa.

## Back office

Conexión privilegiada que puentea RLS, con pool separado, aislada en su proceso, inalcanzable desde la app cliente. Todo acceso cross-tenant registrado con motivo obligatorio en log append-only.

**Riesgo asumido y documentado:** un fallo de autorización en el back office expone a todos los tenants a la vez.
