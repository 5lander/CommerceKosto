# AUDITORIA.md — Checklist obligatoria antes de cada commit

> Se ejecuta **completa** al terminar cada paquete. Se responde **punto por punto**, con ✅ o ❌ y evidencia.
> **Un ❌ se corrige antes del commit.** No se acepta como deuda técnica.

---

## A. Arquitectura

| # | Verificación | Cómo comprobarlo |
|---|---|---|
| A1 | Ningún archivo de `domain/` importa framework, ORM, `pg`, HTTP o `process.env` | Buscar imports en la carpeta |
| A2 | `application/` no importa implementaciones concretas de infraestructura | Revisar imports |
| A3 | `infrastructure/` no contiene reglas de negocio | Revisión del código |
| A4 | Los casos de uso reciben sus puertos por constructor | Revisar constructores |
| A5 | Ningún módulo que no sea `catalog` crea, edita ni borra ítems, artículos de compra, unidades, conversiones o grupos | Buscar escrituras a esas tablas · regla de `dependency-cruiser` |
| A6 | **El motor de costeo (`modules/costing/domain`) se puede probar sin base de datos** | Ejecutar sus pruebas con la base apagada |

## B. Código

| # | Verificación |
|---|---|
| B1 | Cero apariciones de `any`, `@ts-ignore`, `eslint-disable` |
| B2 | `npm run typecheck` en verde |
| B3 | `npm run lint` en verde |
| B4 | Ninguna función supera 20 líneas sin justificación explícita |
| B5 | Ninguna función supera 3 niveles de indentación |
| B6 | Ninguna función tiene más de 3 parámetros sueltos |
| B7 | Sin números ni cadenas mágicas: todo en constantes con nombre |
| B8 | Se usan tipos de dominio (`CompanyId`, `LocationId`, `ItemId`, `ProductId`, `Money`, `Quantity`, `Ratio`, `UnitOfUse`), no primitivos sueltos |
| B9 | Errores tipados de dominio, no cadenas genéricas |
| B10 | Ningún `catch` vacío o que silencie el error |
| B11 | Sin código comentado en el repositorio |
| B12 | Validación por esquema en **todo** límite externo |

## C. Seguridad

| # | Verificación |
|---|---|
| C1 | `company_id` presente en toda tabla nueva del dominio de negocio |
| C2 | RLS **deny-by-default** y `FORCE ROW LEVEL SECURITY` activados en esas tablas, **en la misma migración que las crea** *(desde P1)* |
| C3 | El `company_id` se deriva de la sesión, **nunca** del cliente |
| C4 | Todo acceso por ID valida pertenencia a la company **y** a la ubicación cuando el rol es de ubicación (IDOR) |
| C5 | **Ningún endpoint devuelve los datos protegidos del proyecto (composición de recetas y todo dato del que se despeje)** — verificado en la respuesta cruda |
| C6 | Los campos que NUNCA salen (para el rol BODEGA: líneas de receta, consumo teórico, stock teórico, diferencia de conteo, valorización de la diferencia, punto de reorden, costo de plato, margen y food cost) no aparecen en ninguna ruta |
| C7 | Consultas parametrizadas; cero concatenación de SQL |
| C8 | Contraseñas con Argon2id; jamás en logs |
| C9 | Webhooks con validación de firma — **no aplica mientras no haya webhooks entrantes** (SEGURIDAD.md §6). Se reactiva sin excepción el día que se añada uno |
| C10 | Rate limiting en endpoints sensibles |
| C11 | Secretos fuera del repositorio |
| C12 | Cifrado a nivel de campo (AES-256-GCM, con `key_version` por registro) en **las líneas de receta con sus cantidades y en los precios de referencia** (SEGURIDAD.md §8) |
| C13 | Errores al exterior genéricos; detalle solo en logs internos |
| C14 | Logs sin datos personales ni datos de negocio del cliente en claro: los IDs sí, las cantidades de receta y los precios no. **Y sin una sola credencial**: `authorization`, la `cookie` de la petición, el `set-cookie` de la respuesta y `X-CSRF-Token` se borran en `redact` (`logger.options.ts`). La lista completa la clava `logger.options.spec.ts` — **toda cabecera que lleve un secreto nuevo entra ahí en el mismo paquete que la introduce** *(P16-A2: el token anti-CSRF se quedó fuera y salió en claro en el log de cada mutación)* |
| C15 | Sin concatenación en SQL, incluido `ORDER BY` dinámico (lista blanca de columnas) |
| C16 | Límites anti fuerza bruta activos por cuenta **y** por IP en login, códigos y tokens (SEGURIDAD.md §2.1) |
| C17 | Respuestas de login/recuperación idénticas y en tiempo constante (`timingSafeEqual`, hash dummy) |
| C18 | Esquemas de entrada `.strict()` — mass assignment rechazado, no ignorado |
| C19 | Cabeceras de seguridad completas (HSTS, CSP con nonce, X-Frame-Options, nosniff) y `Cache-Control: no-store` en toda respuesta con datos personales o de negocio del cliente |
| C20 | Rotación de sesión al login; revocación total al cambiar contraseña/correo; detección de reuso de refresh |
| C21 | Uploads: magic bytes + tamaño + límite de filas + nombre UUID + bucket privado + parser de hoja de cálculo aislado en worker |
| C22 | Sin fetch del lado servidor a URLs provistas por usuarios (SSRF) |
| C23 | Comparaciones de firmas/secretos con `timingSafeEqual`, nunca `===` |
| C24 | DTOs explícitos por endpoint — nunca se serializa la entidad completa |
| C25 | Timeouts en peticiones, llamadas salientes, SQL (`statement_timeout`) y trabajos de cola |
| C26 | Dependencias sin vulnerabilidad alta/crítica (`npm audit` en verde o excepción con ADR) |
| C27 | Tests de seguridad del paquete presentes y en verde (SEGURIDAD.md §11) |
| C28 | **Todo evento del catálogo de auditoría (SEGURIDAD.md §10) que este paquete introduce queda registrado** con actor, IP, geo, device y correlation_id |
| C29 | Logins registran éxito y fallo con origen; aviso por correo ante dispositivo/ubicación nueva |
| C30 | La tabla de auditoría es append-only para el rol de la app; consultar el log también se audita |

## D. Base de datos

| # | Verificación |
|---|---|
| D1 | Migración versionada **y reversible** incluida |
| D2 | Restricciones en la base: `NOT NULL`, `CHECK`, `UNIQUE` donde corresponde |
| D3 | Claves foráneas con integridad declarada |
| D4 | `numeric` para dinero, `timestamptz` para fechas |
| D5 | Enums en tabla de catálogo, no en tipo nativo de Postgres |
| D6 | Índices creados según la tabla de `CLAUDE.md` §5.2 |
| D7 | Índices compuestos empiezan por `company_id` donde aplica |
| D8 | **`EXPLAIN ANALYZE` ejecutado y adjuntado** para toda consulta nueva del camino crítico |
| D9 | Sin N+1: ninguna consulta dentro de un bucle |
| D10 | Sin `SELECT *` |
| D11 | Paginación por cursor, no `OFFSET` |
| D12 | Filtros y agregaciones en SQL, no en JavaScript |
| D13 | Ninguna llamada externa dentro de una transacción abierta |
| D14 | **Toda restricción o trigger nuevo tiene su guarda de dominio**, con mensaje, y una prueba de que el rechazo sale como 4xx y no como 500. Registrado en `docs/sistema/guardas-de-dominio.md`, que `audit:migrations` M11 exige. Ver INC-012 |

## E. Reglas de negocio

| # | Verificación | Regla | Desde |
|---|---|---|---|
| E1 | Ninguna consulta se ejecuta sin tenant efectivo: test con dos companies donde A no ve nada de B, ni pasando IDs de B | R1 | P1 |
| E2 | El cliente de base de datos no se usa fuera de la capa de transacción-con-tenant (`audit:forbidden` en verde) | R1 | P1 |
| E3 | Ningún endpoint acepta `company_id` de entrada; el tenant sale de la sesión | R1 | P1 |
| E4 | El saldo de inventario de una ubicación no cambia al operar sobre otra | R2 | P6 |
| E5 | No existe `UPDATE` ni `DELETE` sobre la tabla de movimientos de inventario | R3 | P6 |
| E6 | El saldo reconstruido desde el libro coincide con la proyección almacenada | R3 | P6 |
| E7 | Existe test con el mismo ítem en base AP y en base EP, con resultados distintos y ambos correctos | R4 | P5 |
| E8 | Cambiar el precio de un ítem hoy no altera el costo calculado de un período anterior | R5 | P3 |
| E9 | Un precio no pasa a vigente sin confirmación explícita de un usuario | R5 | P3 |
| E10 | Para todo producto: `mc_pct + food_cost_pct = 1` | R6 | P5 |
| E11 | `ROUND(costo_ventas_teorico − costo_ventas_segun_costeo, 2) = 0` con dataset completo | R7 | P8 |
| E12 | Por cada endpoint de inventario o costeo existe un test que autentica como BODEGA y verifica sobre la **respuesta cruda** que ningún campo prohibido aparece | R8 | P1 |
| E13 | La pantalla de conteo físico no recibe stock teórico ni derivados para BODEGA (conteo a ciegas) | R8 | P7 |
| E14 | Una receta con ciclo directo o indirecto se rechaza **al guardar**, con error de dominio | R9 | P4 |
| E15 | El ítem PRODUCIDO se costea con su precio de referencia, no con el costo del último lote | R10 | P6 |
| E16 | El movimiento de producción registra el costo real del lote y su varianza contra el estándar | R10 | P6 |
| E17 | Propagar una receta exige permiso de company, muestra previsualización y deja registro reversible | R11 | P4 |
| E18 | Un GERENTE_LOCAL recibe 403 al intentar propagar a otras ubicaciones | R11 | P4 |
| E19 | La provisión de merma no atribuible se aplica una sola vez, sobre el costo por porción ya afectado por rendimiento | R12 | P5 |
| E20 | Con `iva_recuperable = false` el costo sube exactamente el porcentaje del IVA, en ítems y en empaques | R13 | P3 |
| E21 | `venta_neta = pvp / (1 + iva_venta)` y el food cost se calcula sobre venta neta, nunca sobre PVP | R14 | P5 |
| E22 | Ningún importe ni cantidad usa punto flotante; todo pasa por el tipo `Money` y `numeric` en la base | R6/R7 | P0 |
| E23 | El consolidado de company es exactamente la suma de sus ubicaciones | R2 | P9 |
| E24 | `varianza (§16) = −mermas_y_ajustes (§18) − diferencia_de_conteo (§18)`, por ítem y ubicación sobre el mismo mes. Es una **identidad**, no una tolerancia: si no da cero, una de las dos vistas está mal | R15 | P16-J |

## F. Frontend *(solo en P12, P13 y P14)*

| # | Verificación |
|---|---|
| F1 | **Cero colores, tamaños o fuentes literales en componentes** |
| F2 | Todos los valores visuales salen de `tokens.css` |
| F3 | Los componentes de dominio no contienen `className` con valores visuales |
| F4 | `components/ui` podría reemplazarse entero sin tocar la lógica |
| F5 | **Lo que un rol no puede ver, no llega al navegador**: abrir el inspector de red como `BODEGA` no revela ningún campo prohibido. Nada se oculta con CSS |
| F6 | Estados de carga, error y vacío en toda vista que consuma la API |
| F7 | Funciona en 360 px de ancho; la carga de conteo físico y de unidades vendidas es usable de pie |
| F8 | Validación en cliente **y** servidor |
| F9 | Accesibilidad básica: etiquetas, foco visible, contraste, teclado. La grilla de unidades vendidas se completa **sin tocar el ratón** |

## G. Pruebas

| # | Verificación |
|---|---|
| G1 | Todas las pruebas en verde |
| G2 | El dominio del paquete tiene cobertura de pruebas unitarias |
| G3 | Las pruebas del dominio corren sin base de datos |
| G4 | Test de aislamiento entre companies **y entre ubicaciones** en verde *(desde P1 y P6)* |
| G5 | Test de datos protegidos frente a `BODEGA` en verde, verificado sobre la respuesta cruda |
| G6 | Casos conocidos de `docs/pruebas/casos-conocidos.md` ejecutados *(desde P0 para la aritmética, completos desde P5)* |
| G7 | Ningún dato real de clientes usado en pruebas: ni recetas, ni precios, ni márgenes reales. Solo sintéticos o los casos conocidos del Excel de referencia |

## H. Documentación *(todos los paquetes)*

| # | Verificación |
|---|---|
| H1 | `docs/pasos/P{n}/CONSTRUCCION.md` existe y tiene **todas** sus secciones completas |
| H2 | Todo endpoint nuevo documentado en `docs/apis/` con la plantilla API-ENDPOINT |
| H3 | `docs/sistema/FUNCIONAMIENTO.md` actualizado; diagramas Mermaid renderizan sin error |
| H4 | `docs/sistema/modelo-datos.md` al día con las migraciones del paquete |
| H5 | `docs/sistema/configuracion.md` al día con `config/` y `.env.example` |
| H6 | Cada decisión técnica relevante tiene su ADR en `docs/decisiones/` |
| H7 | Runbooks creados/actualizados si el paquete introdujo algo operable |
| H8 | `docs/CHANGELOG.md` tiene la entrada del paquete |
| H9 | `docs/pruebas/casos-conocidos.md` al día |
| H10 | **Todo problema del paquete que cumple el criterio de `docs/incidencias/README.md` tiene su ficha, con la fila en el índice** |
| H11 | **Ninguna incidencia del paquete que fuese automatizable quedó solo documentada**: la verificación o la prueba existen |
| H12 | **Ninguna incidencia registrada llegó a tres recurrencias sin que se implementara su prevención** |
| H13 | La documentación describe lo construido, no lo planeado |
| H14 | `docs/pasos/P{n}/AUDITORIA-RESULTADO.md` completo con evidencia (este mismo reporte) |

## I. Optimización y eficiencia *(todos los paquetes — detalle en docs/OPTIMIZACION.md §8)*

| # | Verificación |
|---|---|
| I1 | `audit:deadcode` en verde — sin exports, archivos ni dependencias sin uso |
| I2 | `audit:complexity` en verde — complejidad ≤10, profundidad ≤3, funciones ≤40 líneas |
| I3 | `audit:duplication` en verde — **cero clones detectados** (≥50 tokens, ≥5 líneas) |
| I4 | Ninguna abstracción con una sola implementación fuera de los puertos |
| I5 | Nada de CPU pesada en el proceso HTTP |
| I6 | Concurrencia acotada en todo `Promise.all` sobre I/O |
| I7 | Cachés nuevos cumplen las tres condiciones (lectura≫escritura, staleness tolerable, invalidación definida) |
| I8 | Presupuestos de rendimiento medidos y en verde (p95) — **`npm run bench`, ver abajo** |
| I9 | Presupuesto de bundle en verde — **`npm run medir-bundle`** tras `npm run build --workspace @costeo/web`, en todo commit que toque `apps/web`. Mide en gzip lo que el navegador baja por pantalla: piso ≤ 200 KiB, pantalla ≤ 350 KiB. Si se pasa, se arregla la pantalla, no el umbral |
| I10 | Optimizaciones no triviales documentadas con antes/después |

### I8 — `npm run bench` no está en `npm run audit`, y hay que saberlo

**Cuándo es obligatorio ejecutarlo:** en todo paquete que toque el camino de
LECTURA de `costing`, `analytics`, `inventory` o `pricing`. En los demás, no.

**Por qué está fuera de los doce checks.** Tarda unos dos minutos, casi todos
sembrando 219.000 movimientos, y eso se pagaría en cada commit y en cada
pre-commit. Es un compromiso consciente, no un olvido.

**El riesgo que abre, dicho en voz alta:** un medidor fuera del pre-commit puede
decaer sin que nadie se entere — que es exactamente lo que le pasó al
presupuesto de §5 entre P9 y P15, cuando la deuda se aplazó tres veces y el
consolidado acabó incumpliendo su límite en un 75 % sin que ningún check
protestara. Por eso esta fila está aquí y no en una nota al pie.

**Cómo se lee su salida.** Falla con código 1 si algún presupuesto se pasa.
Cuando eso ocurra: **el check tiene razón hasta que se demuestre lo contrario, y
lo que se arregla es la consulta, no el umbral.** El «suelo del entorno» que
imprime arriba es lo que cuesta un viaje a la base en esa máquina; sin restarlo
mentalmente, los otros números no significan nada.

---

## Formato de reporte

```
AUDITORÍA P{n}

A. Arquitectura      ✅ A1-A6
B. Código            ✅ B1-B12
C. Seguridad         ✅ C1-C30
D. Base de datos     ✅ D1-D13  · EXPLAIN ANALYZE adjunto abajo
E. Reglas de negocio ✅ E1-E23
F. Frontend          — no aplica
G. Pruebas           ✅ G1-G7 · 47 pruebas en verde
H. Documentación     ✅ H1-H14
I. Optimización      ✅ I1-I10

EXPLAIN ANALYZE:
  {consulta}: Index Scan usando {índice}, {t} ms
```

Si algún punto no aplica al paquete, se marca **— no aplica** con la razón. **No se omite.**

## Verificación automatizada — la prueba del guardián

`npm run audit` corre once verificaciones. Un check verde sobre un repositorio sin código no demuestra nada: demuestra que no encontró nada, que es distinto de que funcione.

**Por eso, en el paquete que introduce o modifica una verificación, hay que demostrar que falla cuando debe.** Se introduce a mano una violación deliberada, se captura la **salida de fallo literal**, se revierte, y esa salida se pega en `docs/pasos/P{n}/AUDITORIA-RESULTADO.md`.

En P0, donde se crean las once, **sin las once salidas capturadas no hay commit.**
