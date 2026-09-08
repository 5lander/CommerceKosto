# P11 — Back office

**Fecha:** 2026-09-08 · **Paquete:** P11 — Back office
**Cierra:** el pendiente estructural de `audit_log` · el nombre reservado `costeo_backoffice` · D5 (planes y límites)

---

## 1. Qué se entregó

| Entregable del plan | Dónde |
|---|---|
| Gestión de companies, planes y límites | `modules/backoffice/application/casos-de-uso/companies.ts` + tabla `plan` |
| Alta de tenant con semilla de parámetros (D3) | `CrearCompany` — la semilla la sigue poniendo el trigger de P3 |
| Conexión privilegiada con pool separado, en su propio proceso | `src/backoffice.ts` + `infrastructure/backoffice-connection.ts` |
| Log append-only de todo acceso cross-tenant, con motivo obligatorio | `backoffice_access_log` |
| Carga de datos dentro de un tenant desde el back office | Ver §5: la cubre el CLI de P10, y **a propósito** |

Y el criterio de aceptación, entero: existe la prueba de que ningún módulo de la
app cliente alcanza la conexión privilegiada, toda operación cross-tenant deja
registro con motivo, y el registro no se puede editar ni borrar.

---

## 2. La decisión de fondo: dos procesos, no un guard

Está razonada entera en **ADR-017**. En una frase: montar el back office dentro
de `AppModule` con un guard delante pondría la conexión que puentea RLS en el
mismo contenedor de inyección que todos los controladores del cliente, y el
guard sería lo único entre eso y una fuga total.

Lo verifican cuatro cosas, y la que más vale es la última:

1. `audit:forbidden`, tres reglas nuevas — falla al escribir el import.
2. `audit:arch`, dos reglas nuevas — falla si aparece la arista.
3. **Una prueba que le pregunta al contenedor de `AppModule` ya construido si
   tiene `BackofficeConnection`.** Las dos anteriores miden la causa; esta mide
   la consecuencia.
4. `BackofficeConnection` **aborta el arranque** si `BACKOFFICE_DATABASE_URL` no
   trae el rol `costeo_backoffice`. Es el espejo de lo que `environment.ts` hace
   con `costeo_app` desde P0.

**Y la pareja que hace que la prueba 3 mida algo:** hay una segunda que
comprueba que el proceso del back office **sí** la tiene. Sin ella, la primera
pasaría igual si `BackofficeConnection` no existiera en ningún sitio — que es
INC-007 con otro disfraz.

---

## 3. El motivo obligatorio

Es la tercera condición de SPEC §1 y lo que convierte el riesgo asumido en
riesgo gestionado. Tres decisiones:

**Viaja como cabecera `X-Motivo`, no como campo del cuerpo.** Acompaña a `GET`
tanto como a `POST`, es transversal a todas las operaciones, y sale en el log de
acceso del proxy sin tocar nada más — cuando algo va mal, el registro de la
aplicación y el del servidor cuentan lo mismo.

**Veinte caracteres, en el dominio y otra vez en la base.** El dominio contesta
«faltan 13 caracteres, escribe para qué necesitas ver estos datos: queda
registrado y lo va a leer alguien». El `CHECK` es la red por debajo, para el día
que alguien añada un caso de uso y se olvide (INC-012).

**La cabecera ausente NO pasa por un esquema Zod.** Un `min(1)` contestaba
«(cuerpo): Too small», mencionando un cuerpo que no existe y sin decir qué poner.
Un control que se explica mal se rodea; uno que dice qué hacer, se cumple. Se
cambió al ver la respuesta real contra el proceso levantado.

**Y se escribe ANTES de leer, en la misma transacción.** Si el `INSERT` falla, la
lectura se revierte. El puerto no tiene un `registrarAcceso()` suelto a
propósito: si lo tuviera, sería una llamada que se puede olvidar.

---

## 4. D5: los planes, con sus tres límites **verificados**

`company.max_locations` desaparece; el límite vive en `plan`, que declara los
tres que D5 nombra: `max_locations`, `max_items`, `max_products`.

**Los tres se hacen cumplir, y esa es la parte que importa.** Una columna de
límite que nadie comprueba es peor que no tenerla: aparenta una garantía que no
existe y ningún check la delata. Es exactamente lo que le pasó a
`combo_component`, que estuvo seis paquetes con lectura y sin escritura sin que
nada protestara (P10).

El patrón es el que P1 estrenó para las ubicaciones y `shared/infrastructure/persistence/limites-del-plan.ts`
generaliza: **candado sobre la fila de `company` dentro de la misma transacción
que inserta**. Contar fuera y decidir después es un TOCTOU de manual — dos
peticiones cuentan 499, las dos deciden que caben, y quedan 501.

El candado va sobre `company` y **no sobre `plan`**: `plan` es un catálogo
compartido, y bloquear su fila serializaría la creación de ítems de todos los
clientes del mismo plan entre sí. `FOR UPDATE OF c` se lo dice a PostgreSQL.

**Y bajar de plan por debajo de lo que la company ya tiene se rechaza.** No rompe
nada hoy: rompe el día que el cliente intente crear la siguiente ubicación y
nadie recuerde por qué no puede.

---

## 5. Lo que NO se construyó, y por qué

**«Carga de datos dentro de un tenant desde el back office» ya existe** —
`npm run importar` con `--operacion-supervisada`, de P10— y construir una segunda
vía habría sido **peor**, no más completo:

- El CLI escribe **como un usuario del tenant**, con su permiso `import.write`,
  sujeto a RLS, y deja su `import_job` y sus eventos de auditoría.
- Una vía por el back office escribiría **con el rol que puentea RLS**. Datos de
  negocio entrando por la conexión sin filtro es exactamente el escenario que
  SPEC §1 pide evitar.

Queda anotado en el runbook de despliegue con el comando exacto.

**Tampoco hay niveles de operador.** Un operador de back office puede lo que
puede el back office; inventar roles sin nadie a quien aplicárselos es la
abstracción especulativa que OPTIMIZACION.md §1 prohíbe. El día que haya dos
clases, se añade con su tabla y su prueba.

**Ni segundo factor.** Con un operador y acceso por túnel SSH —que ya exige una
clave— sería proteger la segunda cerradura antes que la primera. Queda en
`ESTADO.md`: **en cuanto haya un segundo operador, se reevalúa.**

---

## 6. Lo que la migración enseñó

**Prisma emitía el `DROP COLUMN "max_locations"` en la primera línea**, antes de
que existiera un solo plan al que mover ese límite. El dato se habría perdido, y
la pérdida habría sido **silenciosa** porque el valor por defecto coincide. La
migración está reordenada a mano: crear el plan, sembrarlo, mover cada company al
plan que de verdad cubre su límite —y **fallar en alto** si ninguno lo cubre— y
solo entonces soltar la columna. El `down` hace el camino inverso, no restaura un
`DEFAULT`.

**Los privilegios por defecto abren las tablas nuevas.** `grants.sql` declara
`ALTER DEFAULT PRIVILEGES ... GRANT SELECT, INSERT ON TABLES TO costeo_app`, así
que las tres tablas del back office **nacen legibles e insertables por la
aplicación cliente**. El `REVOKE` va antes que cualquier otra cosa en el bloque
de privilegios.

**Faltó `USAGE ON SCHEMA public` y el error no lo decía.** Todos los `GRANT` de
tabla estaban bien y el back office fallaba con «permission denied for schema
public», que no menciona ni tabla ni privilegio. Apareció al correr la suite, no
al leer el SQL.

---

## 7. Ficheros

| Fichero | Qué |
|---|---|
| `prisma/migrations/20260908171210_p11_backoffice/` | `plan` + las tres tablas, RLS, privilegios, traslado del límite |
| `docker/postgres/initdb/sql/roles.sql` | `costeo_backoffice`, con `BYPASSRLS` y sus timeouts |
| `scripts/rol-backoffice.mjs` | El rol en un cluster que ya estaba en pie |
| `scripts/operador-backoffice.mjs` | Alta de operador. Sin endpoint, a propósito |
| `scripts/backoffice.mjs` | El lanzador del segundo binario |
| `src/backoffice.ts` | El proceso: loopback, sin CORS, sin limitador |
| `modules/backoffice/domain/motivo.ts` (+ spec) | El motivo, con sus 7 unitarias |
| `modules/backoffice/infrastructure/backoffice-connection.ts` | La conexión privilegiada |
| `shared/infrastructure/persistence/limites-del-plan.ts` | El candado de los tres límites |
| `test/integracion/backoffice.spec.ts` | Las 10 del criterio de aceptación |
| `tools/audit/rules/backoffice.rules.mjs` | Las 3 reglas nuevas |
| `docs/decisiones/ADR-017-...` | El riesgo asumido, sus condiciones y las alternativas |
