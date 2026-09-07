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
| `costeo_migrator` | Migraciones (solo el CLI de Prisma) | Dueño del esquema y de las tablas. `NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT` |
| `costeo_app` | Aplicación cliente | **No superusuario, no dueño.** Sujeto a RLS. Sin `CREATE`, sin `TEMPORARY`, sin membresías. Timeouts fijados en el rol |
| `costeo_backoffice` | Back office | **No existe todavía.** El nombre está reservado; se crea en P11. Un rol con login que nadie usa es superficie de ataque sin contrapartida |

Los `DEFAULT PRIVILEGES` conceden `SELECT` e `INSERT`, **nunca `UPDATE` ni `DELETE`**: esos se conceden tabla por tabla, en la migración que la crea. El orden inverso tiene el fallo invertido — si alguien olvidara un `REVOKE`, el libro de inventario dejaría de ser append-only **en silencio**.

El detalle completo de los roles, y de la base sombra `costeo_shadow`, está en `docs/sistema/configuracion.md`. Nueve pruebas de integración lo verifican contra la base real en cada corrida.

### Nota sobre connection pooling

**Corregido en ADR-001:** Prisma ya **no** recomienda `?pgbouncer=true` a partir de PgBouncer 1.21.0. Lo que sigue siendo obligatorio es: PgBouncer en **modo transacción**, `max_prepared_statements > 0` —Prisma usa prepared statements— y una **conexión directa separada** para los comandos del CLI.

**Probado en P1, no asumido.** `docker-compose.yml` levanta PgBouncer 1.25.2 en modo transacción con `default_pool_size = 1` —una sola conexión al servidor, para que la reutilización entre clientes no sea probable sino segura— y `apps/api/test/integracion/pgbouncer.spec.ts` comprueba que el tenant no sobrevive a la transacción, alternando dos companies en serie y en paralelo.

Se verificó además que esa prueba mide algo: cambiando el `TRUE` de `set_config` por `FALSE`, un cliente que consulta **sin tenant** ve la fila de la company del cliente anterior. Y al deshacer el cambio la prueba seguía fallando hasta **reiniciar PgBouncer**: el tenant filtrado vivía en la conexión que el pooler guarda, y sobrevivió al reinicio del proceso entero. Una fuga así no se limpia reiniciando la API.

La prueba **falla si no hay pooler**, no se salta: una prueba de seguridad que se omite cuando falta la infraestructura es un verde que no mide nada (INC-007).

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
| **Saldo de inventario** *(P6)* | ✅ | ✅ | ✅ su ubicación | ❌ | ✅ |
| **Libro de movimientos** *(P6)* | ✅ | ✅ | ✅ su ubicación | ❌ | ✅ |
| **Registrar producción** *(P6)* | ✅ | ✅ | ✅ su ubicación | ❌ | ❌ |
| **Conteo físico: contar** *(P7)* | ✅ | ✅ | ✅ su ubicación | ✅ **a ciegas** | ❌ |
| **Conteo físico: conciliar** *(P7)* | ✅ | ✅ | ✅ su ubicación | ❌ | ✅ |
| **Cerrar el mes** *(P7)* | ✅ | ✅ | ✅ su ubicación | ❌ | ❌ |
| **Reabrir un mes** *(P7)* | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Estado del período** *(P7)* | ✅ | ✅ | ✅ su ubicación | ✅ | ✅ |
| **Unidades vendidas** *(P8)* | ✅ | ✅ | ✅ su ubicación | ❌ | ✅ lectura |
| **Costos fijos (T6)** *(P8)* | ✅ | ✅ | ✅ su ubicación | ❌ | ✅ lectura |
| **Las seis vistas analíticas** *(P8)* | ✅ | ✅ | ✅ su ubicación | ❌ | ✅ |
| Propagar recetas | ✅ | ✅ | ❌ | ❌ | ❌ |
| Suscripción y eliminar company | ✅ | ❌ | ❌ | ❌ | ❌ |

**El filtrado se implementa como proyecciones distintas por rol en la API**, no como filtro sobre una respuesta completa.

### Por qué `BODEGA` registra compras y no puede ver el saldo *(P6)*

Las dos filas parecen contradecirse hasta que se escribe la aritmética:

```
saldo = inicial + compras − consumo
```

`BODEGA` conoce el inicial y las compras **porque las registra él**. Con el saldo delante despeja el consumo, y `consumo ÷ unidades vendidas` **es** la cantidad de la receta. La fila «recetas y cantidades ❌» no se sostiene sin esta.

Tiene tres consecuencias que valen para todo endpoint futuro que toque el libro:

1. `inventory.read` **no** se le concede; `inventory.write` e `inventory.transfer`, sí.
2. **Ninguna escritura devuelve el saldo resultante.** Un `POST` que responda «nuevo saldo: 12,4 kg» filtra lo mismo que un `GET`. Las escrituras del libro responden `{ "id": … }`.
3. El **semáforo de reposición** —que sí le corresponde— necesita el punto de reorden, que sale del consumo teórico de SPEC §18. Llega en P8; P6 dejó los permisos repartidos para que sea el único dato que reciba.

Hay guardián que lo mide: `docs/pasos/P6/evidencia/guardian-2-confidencialidad-bodega.txt` rompe las dos primeras de la forma en que alguien lo haría de buena fe —«si puede escribir, que pueda leer lo que escribió»— y las tres pruebas caen.

### La misma asimetría en el conteo físico *(P7)*

`BODEGA` cuenta y **no concilia**. La conciliación lleva stock teórico, diferencia y valorización de la diferencia: tres de los datos prohibidos de la matriz, y desde el stock teórico se despeja el consumo por el mismo camino de arriba.

| | |
|---|---|
| `count.write` | Sí. Contar es su trabajo |
| `count.read` | **No.** La conciliación es la vista de costeo del inventario |
| `period.read` | Sí. Saber que un mes está cerrado no permite despejar nada, y sin ello no entendería por qué le rechazan una compra |
| `period.close` | No. Contar y sellar el mes son actos distintos |

Tres consecuencias, hermanas de las tres de P6:

1. **La hoja de conteo lista todos los ítems almacenables, tengan saldo o no.** Si trajera solo los que el libro conoce, la presencia de una fila diría «de esto hay algo» y su ausencia diría «cero». El conteo dejaría de ser ciego por la puerta de atrás.
2. **Confirmar devuelve `204` sin cuerpo**, aunque acabe de calcular la conciliación entera.
3. **La lista de conteos no lleva los tres valores.** `valorTeorico` y `valorFisico` viven solo en la proyección que exige `count.read`, y son dos interfaces distintas y no una con campos opcionales: así el compilador obliga a decidir dónde va cada campo nuevo.

**Y el efecto colateral lo pide el propio SPEC §4:** `BODEGA` cuenta a ciegas, sin saber cuánto debería haber. Quien conoce el número esperado tiende a ajustar el conteo hacia él, así que la restricción de confidencialidad **mejora la calidad del dato de inventario**.

Guardián: `docs/pasos/P7/evidencia/guardian-4-confidencialidad-frente-a-bodega.txt`, que lo rompe por los dos sitios reales —relajar el permiso, y añadir un campo a la proyección «básica»— y captura los dos fallos.


---

## El permiso de nivel company — P9

`analytics.consolidated.read` protege las tres rutas del consolidado, y **`GERENTE_LOCAL` no lo tiene**.

| Rol | ¿Ve la cadena? | Por qué |
|---|---|---|
| `OWNER`, `ADMIN` | Sí | Mandan sobre la company |
| `LECTURA` | Sí | Rol de solo lectura de nivel company — el contador, el socio |
| `GERENTE_LOCAL` | **No, 403** | Vería, sumadas y comparadas, las ventas y los márgenes de los locales de sus compañeros |
| `BODEGA` | No | Ya no recibe ninguna vista analítica desde P8 |

**Es la tercera vez que aparece la misma línea**, y conviene verla junta: P4 se la negó en la propagación de recetas (criterio E18), P6 y P7 en el saldo y la conciliación, y P9 en el consolidado. La regla que las une es la de CLAUDE.md §4.4: **un gerente manda en su local, no en la cadena ni en el local de al lado.**

**Dónde se comprueba.** En la primera línea de cada caso de uso, en su propia función, nunca dentro de un refinamiento — CLAUDE.md §3, y la razón está en INC-008. Cuatro pruebas de integración: tres de 403, una por ruta, y una cuarta que verifica que el gerente **sigue viendo la vista de su ubicación**. Sin esa cuarta, una restricción demasiado ancha pasaría por buena.

### Y por tercera vez, en las vistas analíticas *(P8)*

`BODEGA` no recibe **ninguna** de las seis vistas. Todas llevan consumo teórico, stock teórico, diferencias o costos: cuatro de los seis datos prohibidos de la matriz, y desde cualquiera de ellos se despeja la receta por la misma aritmética.

Lo único que le corresponde —y SPEC §4 lo dice con estas palabras— es un semáforo `REPONER`/`OK` **sin la cantidad que lo origina**. Se sirve desde `GET /analitica/reposicion`, con `replenishment.read`, tres campos y ninguna cantidad.

**Dos detalles que ya son patrón del proyecto y conviene no perder:**

1. **La proyección reducida es un tipo propio, no un `Omit` de la completa.** Con un `Omit`, el campo que se añada mañana a la vista de inventario aparecería en el semáforo sin que nada avisara.
2. **`FALTAN_COMPRAS` y `REPONER` colapsan**, igual que `SIN_CONSUMO` y `OK`. Que `BODEGA` pudiera distinguirlos ya sería un dato sobre el stock teórico.

Guardián: `docs/pasos/P8/evidencia/guardian-4-confidencialidad-frente-a-bodega.txt`.

## Back office

Conexión privilegiada que puentea RLS, con pool separado, aislada en su proceso, inalcanzable desde la app cliente. Todo acceso cross-tenant registrado con motivo obligatorio en log append-only.

**Riesgo asumido y documentado:** un fallo de autorización en el back office expone a todos los tenants a la vez.


---

## Qué está implementado a día de hoy (P0)

P0 no tiene autenticación ni datos de negocio: lo que existe es el andamiaje que las barreras necesitarán.

| Control | Estado | Dónde |
|---|---|---|
| **Barrera 1** — roles de BD separados, app no superusuario | ✅ verificado contra la base real | `docker/postgres/initdb/sql/` · 9 pruebas de integración |
| **Barrera 2** — capa de transacción-con-tenant | ⬜ P1 | Hoy `PrismaConnection` es el único sitio autorizado a construir el cliente |
| **Barrera 3** — tenant desde la sesión | ⬜ P1 | No hay sesiones todavía |
| `audit_log` append-only + RLS deny-by-default | ✅ | 14 pruebas de integración |
| Cabeceras de §4.4 en **toda** respuesta, incluidos 404 y 429 | ✅ | 18 pruebas (`audit:sec-headers`) |
| CSP estricta con nonce **distinto por respuesta** | ✅ | `http/security-headers.ts` |
| Formato único de error `{ code, message }`; los 5xx no revelan su causa | ✅ | `http/error.filter.ts` + 8 pruebas |
| `correlation_id` en toda línea de log y en la respuesta | ✅ | `observability/` |
| Timeout de petición + `statement_timeout` en el rol | ✅ | Dos capas distintas |
| Limitador de peticiones | 🟡 cableado, **sin ruta que proteger** | `/health` y `/ready` llevan `@SkipThrottle`. Su prueba es de P1 |
| Argon2id, sesiones, bloqueo por fuerza bruta | ⬜ P1 | — |
| Cifrado de campo en líneas de receta y precios | ⬜ P3/P4 | — |

### Lo que NO se hizo, y por qué

- **CORS está desactivado.** `SEGURIDAD.md` §4.4 exige lista blanca exacta y jamás `*`. En P0 no hay frontend: no habilitarlo es la opción más restrictiva.
- **No hay prueba del limitador.** No existe ninguna ruta a la que aplique. `security/bruteforce.test` es de P1, como ya dice `SEGURIDAD.md` §11. No se escribió una prueba de mentira para marcar la casilla.


---

## Autenticación — cómo quedó en P1

### El orden del login

1. **Bloqueo** antes de tocar la contraseña. Un atacante bloqueado no debe conseguir que el servidor gaste 64 MiB y decenas de milisegundos por intento.
2. **`auth_lookup`**, una sola lectura.
3. **Verificar siempre**, exista o no el usuario: el puerto acepta `hash: null` y el adaptador verifica contra un hash ficticio. Sin esto el tiempo de respuesta distingue «no existe» de «contraseña incorrecta».
4. **Estado** de usuario y company **después** de verificar, para no reabrir el canal de tiempo que el paso 3 cierra.

Los cuatro motivos de rechazo dan **el mismo mensaje**. El motivo real solo va a `audit_log`.

### Argon2id

`m=65536, t=3, p=1`, explícitos y no los de la librería: los valores por defecto cambian entre versiones, y un cambio silencioso en el coste de hashear es a la vez un problema de seguridad (si baja) y una caída de servicio (si sube).

`parallelism: 1` merece su línea: la librería trae 4, y cuatro hilos por cada login concurrente saturan el pool de libuv —que tiene cuatro en total— y bloquean el resto de la aplicación, base de datos incluida.

### Bloqueo progresivo — con umbral distinto por eje

| Eje | Umbral | Por qué |
|---|---|---|
| **Cuenta** | 5 fallos / 15 min | El número de SEGURIDAD.md §2.1 |
| **IP** | 25 fallos / 15 min | Detrás de una IP hay una cocina entera |

Escala 1 → 5 → 15 → 60 min, contando desde el **último** fallo: insistir alarga la espera. Dos ventanas: la de disparo (15 min) decide si hay bloqueo, la de escalada (60 min) decide cuánto dura — sin la segunda, quien espera a que caduquen los quince minutos vuelve a empezar en el escalón más bajo, con cinco intentos gratis cada cuarto de hora para siempre.

**El umbral por IP es un apartamiento razonado de la lectura literal de SEGURIDAD.md §2.1**, que da un solo número para los dos ejes. Con cinco, cinco errores repartidos entre cinco empleados de un mismo restaurante bloquean el local completo durante una hora, y cualquiera puede dispararlo desde la acera con el wifi del sitio. Lo que el eje de IP tiene que cortar es el rociado de contraseñas, y 25 fallos en una hora sigue siendo un techo bajísimo. Razonado en ADR-006; reversible: son dos constantes.

**Los contadores viven en PostgreSQL, no en Redis** (decisión del usuario): el bloqueo de una cuenta **sobrevive a un reinicio**. Con un almacén volátil, un flush levanta todos los bloqueos activos sin que nadie se entere.

### Sesiones

Token opaco de 256 bits del CSPRNG, **hasheado con SHA-256 en la base**. SHA-256 y no Argon2 porque un token de sesión no se adivina probando: lo único que compraría un hash lento aquí es gastar 64 MiB **en cada petición**.

Vida absoluta 12 h, inactividad 4 h. Cookie `HttpOnly; SameSite=Strict; Path=/`, con `Secure` decidido por configuración y no por el socket —con TLS terminado en un proxy, `socket.encrypted` es `false` en producción—.

**Aplazado a P12, dicho en voz alta:** el refresh rotativo con detección de reuso que pide SEGURIDAD.md §2.2. Riesgo residual: un token robado sirve hasta 4 h de inactividad o 12 h absolutas, salvo revocación. El razonamiento completo está en ADR-006.

### Contraseñas

12–128 caracteres, **sin reglas de composición** (NIST SP 800-63B las desaconseja desde 2017: se cumplen con `Password1!` y empujan al papel pegado al monitor). Se rechazan las de una lista local de filtradas —también sin la cola no alfabética, porque lo que la gente escribe cuando le exigen doce caracteres es la misma contraseña con un año detrás— y las que contienen la parte local del correo.

Lista local y no HIBP: la comprobación por k-anonimato mete una llamada de red en el camino crítico de un alta, y cuando falla hay que elegir entre aceptar sin comprobar o bloquear el alta. Las dos salidas son malas.

## Autorización

**Deny by default.** `SesionGuard` es global: toda ruta exige sesión salvo las marcadas `@Publico()`, y la lista completa se lee con `grep -rn "@Publico" apps/api/src`. El sentido contrario —un `@Autenticado()` que hubiera que acordarse de poner— falla abierto.

**Capacidades, no roles** (SPEC §4). El endpoint declara qué hace falta poder hacer; qué rol tiene esa capacidad es una fila en `role_permission`, no un despliegue.

**Dos escalas, dos mecanismos.** La vertical la corta `PermisosGuard`; la horizontal —ver una ubicación que no es la tuya— la corta el caso de uso con `sesion.alcance`, que es una **unión** (`company` o lista de ubicaciones) y no una lista con un caso especial. Un `[]` que significara «todas» es la clase de convención que alguien lee al revés una vez y convierte en fuga.

**Dos reglas que la base no puede expresar**, y por eso viven en `politica-de-roles.ts`: nadie modifica sus propios roles, y nadie toca los del `OWNER`. La base impide **dos** owners; no impide quitarle el suyo al que hay.
