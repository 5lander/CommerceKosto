# ADR-017 — `costeo_backoffice`: el rol que puentea RLS

**Fecha:** 2026-09-08 · **Paquete:** P11 · **Estado:** aceptada
**Cierra:** el nombre reservado en `roles.sql` desde P0 y el pendiente estructural de `audit_log`

---

## Contexto

El back office tiene que poder mirar los datos de cualquier cliente para dar
soporte. RLS lo impide por diseño: `costeo_app` solo ve lo que
`current_company()` deja pasar, y el tenant sale de la sesión del usuario.

SPEC §1 ya había tomado la decisión y había registrado el riesgo:

> **Acceso del back office:** conexión privilegiada que puentea RLS.
> **Riesgo asumido.** Se eligió la ruta privilegiada por encima de la
> recomendación (cuenta de usuario dentro del tenant). (…) Un fallo de
> autorización en el back office expone a todos los tenants a la vez.

Lo que P11 decide no es *si*, sino *cómo* — y sobre todo *qué hace falta para
que ese riesgo sea gestionable en vez de solo asumido*.

---

## La alternativa que se descartó, y por qué

**Una cuenta de usuario dentro de cada tenant** es lo que recomienda la
literatura, y tiene una virtud real: el back office no necesitaría ningún
privilegio especial, así que un fallo de autorización expondría *un* tenant y no
todos.

Se descartó por dos razones concretas:

1. **Crea una puerta permanente dentro de cada cliente.** Un `app_user` de
   soporte en la company del cliente es una credencial más que rota, que caduca,
   que alguien puede olvidar revocar al cerrar un tenant — y que aparece en la
   lista de usuarios del cliente, que tiene derecho a preguntar quién es.
2. **No resuelve lo que de verdad hace falta.** Las preguntas del soporte son
   transversales: «¿cuántas companies están en plan BÁSICO?», «¿cuál creció más
   este mes?». Con una cuenta por tenant, eso son N sesiones y una agregación en
   memoria; el aislamiento seguiría intacto y la operación sería impracticable.

---

## Decisión

Un rol dedicado, `costeo_backoffice`, con `BYPASSRLS`, y **cuatro condiciones
que no son recomendaciones**. Las tres primeras vienen de SPEC §1; la cuarta la
añade este ADR.

### 1. Vive solo en el proceso del back office

`apps/api/src/backoffice.ts` es un **segundo binario**. `AppModule` no importa
`BackofficeModule` y nunca debe.

Montarlo dentro de la API con un guard delante pondría la conexión que lo ve
todo en el **mismo contenedor de inyección** que todos los controladores del
cliente. Bastaría un `@Inject` mal puesto para que un endpoint tuviera en la mano
un cliente sin filtro, y el guard sería lo único entre eso y una fuga total. Un
guard es código que alguien puede olvidar; un proceso distinto, no.

Lo verifican **cuatro cosas**, y ninguna sobra:

| Qué | Cuándo falla |
|---|---|
| `audit:forbidden` · 3 reglas | Al escribir el import, en el editor |
| `audit:arch` · 2 reglas | Si aparece la arista, aunque sea indirecta |
| Prueba de integración | Pregunta al contenedor de `AppModule` construido de verdad si tiene `BackofficeConnection`. Es la única que mide la consecuencia y no la causa |
| La variable de entorno | El proceso de la API no lee `BACKOFFICE_DATABASE_URL`, y `BackofficeConnection` **aborta el arranque** si la cadena no trae el rol `costeo_backoffice` |

### 2. Pool separado

Otro proceso, otro `PrismaClient`, otra cadena, y `CONNECTION LIMIT 4` fijado en
el propio rol. **No pasa por PgBouncer**: mezclar la conexión privilegiada con el
pooler de la aplicación es exactamente el cruce que la separación quiere impedir,
y además el back office lo usa una persona a mano, no una pantalla con miles de
peticiones.

### 3. Registro append-only con motivo obligatorio

`backoffice_access_log`, y tres detalles que son la decisión entera:

- **El motivo es `NOT NULL` con `CHECK (length(btrim(reason)) >= 20)`.** No
  impide escribir veinte letras sin sentido; impide el `-`, el `.` y el
  `soporte`, que es lo que se teclea cuando el campo admite cualquier cosa.
- **Se escribe ANTES de leer y en la MISMA transacción.** Si el `INSERT` falla,
  la lectura se revierte y quien preguntó no ve nada. Escribir después dejaría
  una ventana con los datos fuera y el rastro todavía no escrito.
- **El rol no tiene `UPDATE` ni `DELETE` sobre esa tabla.** Append-only por
  privilegio, no por costumbre — la misma decisión que sostiene R3 en el libro
  de inventario.

Y el puerto **no tiene un método `registrarAcceso()` suelto**: si lo tuviera,
sería una llamada que se puede olvidar. Leer y dejar rastro es una sola
operación porque no existe la otra.

### 4. Los privilegios se conceden tabla por tabla, y son los mínimos

`BYPASSRLS` quita el filtro por tenant, pero **no da acceso a nada**: eso lo dan
los `GRANT`, y este ADR los quiere estrechos. Lo que P11 concede:

| Tabla | Privilegio | Por qué |
|---|---|---|
| `company` | SELECT, INSERT, UPDATE | Alta, plan y estado |
| `plan`, `company_settings`, los catálogos | SELECT | Leer límites y estados |
| `location`, `app_user`, `user_role` | SELECT, INSERT | El alta de un tenant con su dueño |
| `item`, `product` | **SELECT solo para contar** | La ficha enseña *cuántos* hay, que es lo que decide un plan |
| `backoffice_access_log` | SELECT, INSERT | Nunca UPDATE ni DELETE |
| `audit_log` | SELECT | Ver abajo |

**Lo que NO se concede, y es lo importante:** `recipe`, `recipe_line`,
`reference_price`, `inventory_movement`. Un operador que pudiera leer las recetas
de un cliente vería su secreto de negocio, que es lo que CLAUDE.md §4.3 protege
frente a `BODEGA` — y la razón no cambia porque quien mire trabaje aquí. Contar
no es leer. El día que soporte necesite más, lo concede su paquete con el motivo
escrito al lado.

`DELETE` no se concede **en ninguna tabla**.

---

## El pendiente estructural que esto cierra

`audit_log` se escribe desde P0 y **nadie podía leerlo**. La política
`audit_log_app_no_lee` (`USING (false)`) es deliberada —la aplicación cliente
solo inserta— pero no existía ningún otro rol. Diez paquetes acumulando evidencia
sin lector: cumplía la letra de SEGURIDAD.md §10 y no su propósito.

`costeo_backoffice` es ese lector, y leer la auditoría de un tenant **es un
acceso cross-tenant como cualquier otro**: pide motivo y deja su línea.

---

## Consecuencias

**Lo que mejora.** El soporte es posible. El log de auditoría tiene por fin quien
lo lea. El alta de un tenant deja de ser un script suelto y pasa a ser una
operación registrada. Y los tres límites del plan (D5) por fin se verifican, en
vez de ser una columna que nadie mira.

**Lo que empeora, dicho sin adornos.** Existe una credencial que, si se filtra,
abre todos los clientes a la vez. Su contraseña no protege un tenant: protege la
cartera entera. Las mitigaciones son las cuatro condiciones de arriba más:

- El back office **escucha solo en loopback** y se llega por túnel SSH. La
  interfaz no es configurable a propósito: una variable que permitiera `0.0.0.0`
  es una variable que algún día alguien pone a `0.0.0.0`.
- **No hay endpoint de alta de operadores.** Se crean con
  `npm run operador:backoffice`, que exige estar en la máquina y tener las
  credenciales de superusuario. Un back office que puede crearse operadores desde
  su propia API convierte una sesión robada en acceso permanente.
- La sesión dura **ocho horas**, no las de la aplicación cliente. Una sesión de
  back office abierta es una llave que abre todo.

**Lo que queda pendiente y hay que saber.** No hay segundo factor. Con un
operador y acceso por túnel SSH —que ya exige una clave— añadirlo ahora sería
proteger la segunda cerradura antes que la primera. **En cuanto haya un segundo
operador, esto se reevalúa**, y queda anotado en `ESTADO.md` como tal.

---

## Alternativas dentro de la decisión que también se descartaron

**Que el rol fuera `NOBYPASSRLS` con políticas propias.** Habría que añadir una
política por tabla para `costeo_backoffice`, y una tabla nueva sin esa política
sería invisible para el soporte sin que nada avisara — un fallo silencioso. Con
`BYPASSRLS` el fallo posible es el contrario, ver de más, y ese lo cazan los
`GRANT`, que sí hay que escribir a mano tabla por tabla.

**Que la migración creara el rol.** `costeo_migrator` es `NOCREATEROLE`, y
ampliarlo sería dar capacidad de crear roles al dueño de todas las tablas para
ahorrarse un comando. La migración **comprueba que el rol existe y falla en alto**
si no; `npm run rol:backoffice` es la respuesta a ese fallo.

**Que el back office escribiera también en `audit_log`.** Serían dos verdades
sobre el mismo hecho y obligaría a concederle `INSERT` sobre el log del tenant.
Son dos registros con dos dueños: `audit_log` es el rastro del tenant,
`backoffice_access_log` el del operador.
