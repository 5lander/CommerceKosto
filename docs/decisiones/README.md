# ADRs — Registros de decisión de arquitectura

Numerados e **inmutables**. Una decisión que cambia no se edita: se escribe un ADR nuevo que supersede al anterior y se marca el viejo como reemplazado.

Plantilla en `docs/plantillas/ADR.md`.

## Índice

| # | Decisión | Estado | Paquete |
|---|---|---|---|
| [ADR-001](ADR-001-versiones-del-stack.md) | Versiones del stack y fechas de fin de soporte (cierra D2) | ✅ aceptado | P0 |
| [ADR-002](ADR-002-orm-prisma-frente-a-drizzle.md) | ORM: Prisma 7.10.0 frente a Drizzle para RLS multi-tenant (cierra D12) | ✅ aceptado | P0 |
| [ADR-003](ADR-003-aritmetica-decimal-con-decimal-js.md) | Aritmética decimal con `decimal.js` y su excepción a la regla de capa | ✅ aceptado | P0 |
| [ADR-004](ADR-004-migraciones-reversibles.md) | Migraciones reversibles con `down.sql` verificado en bases reales | ✅ aceptado | P0 |
| [ADR-005](ADR-005-hooks-con-core-hookspath.md) | Hooks de git con `core.hooksPath` en vez de husky | ✅ aceptado | P0 |
| [ADR-006](ADR-006-las-tres-barreras-del-aislamiento.md) | Las tres barreras del aislamiento multi-tenant, las cuatro condiciones de D12 y las decisiones de sesión | ✅ aceptado | P1 |
| [ADR-007](ADR-007-propagacion-de-recetas-por-copia.md) | Propagación de recetas por copia, no por herencia | ✅ aceptado | P4 |
| [ADR-008](ADR-008-las-tres-decisiones-que-el-spec-no-escribe.md) | Las tres decisiones de costeo que el SPEC no escribe: el empaque, la precedencia de la cascada y el combo | ✅ aceptado | P5 |
| [ADR-009](ADR-009-el-signo-el-costo-y-el-interruptor-de-stock.md) | El signo del movimiento, el importe del lote y la confidencialidad del saldo frente a `BODEGA` | ✅ aceptado | P6 |
| [ADR-010](ADR-010-el-mes-el-corte-y-lo-que-no-se-conto.md) | De quién es el período, dónde vive la frontera del mes, y qué significa exactamente no haber contado un ítem | ✅ aceptado | P7 |
| [ADR-011](ADR-011-el-consumo-teorico-y-lo-que-R7-destapo.md) | El consumo teórico, el rendimiento por lote, y el fallo de P6 que la conciliación R7 sacó a la luz | ✅ aceptado | P8 |
| [ADR-012](ADR-012-el-consolidado-y-lo-que-no-se-suma.md) | El consolidado de company: qué suma, qué se recalcula sobre los totales, y el umbral medido que haría falta una vista materializada | ✅ aceptado | P9 |
| [ADR-020](ADR-020-el-armazon-de-la-aplicacion-cliente.md) | El armazón de la aplicación cliente: grupo de rutas `(app)`, permisos de `GET /auth/sesion` cerrados por defecto y declarados por sección, la sesión caducada desde un solo sitio, el mes en la URL con dos `select`, y la navegación móvil detrás de «Menú» | ✅ aceptado | P16 · Armazón |
| [ADR-021](ADR-021-el-token-anti-csrf-de-la-sesion.md) | El token anti-CSRF de la sesión: synchronizer en claro en la fila, en el cuerpo del login y de `GET /auth/sesion`, comparado con `timingSafeEqual`; la sesión sin token es 401; el back office lo lleva también; `Origin`/`Referer` descartado con su señal. **Supersede en parte a ADR-006** | ✅ aceptado | P16-A2 |
| [ADR-022](ADR-022-como-leen-y-escriben-las-pantallas.md) | Cómo leen y escriben las pantallas: `useCarga` con el origen del resultado, `Vista` y sus cuatro estados, `useEnvio`, el estado editable montado con los datos, **la mutación sin sesión que sale sin token** (INC-023) y las casillas sin ceros de sobra | ✅ aceptado | P16 · Armazón |
| [ADR-027](ADR-027-las-pruebas-de-apps-web-con-el-ejecutor-de-node.md) | Las pruebas de `apps/web` con `node --test`, sin dependencias: funciones puras de `lib/`, importes con extensión, corridas por `audit:tests`; Vitest en el web descartado mientras no haga falta un DOM. Supersede la consecuencia «sin prueba del cliente» de ADR-022 | ✅ aceptado | P16 · Inicio |
| [ADR-028](ADR-028-el-eje-de-ip-del-login-limita-no-bloquea.md) | El eje de IP del login **limita, no bloquea**: cuenta cuentas distintas (10/h) y responde 429 con quince minutos fijos, sin escalada. Aparta la segunda mitad de SEGURIDAD.md §2.1 | ✅ aceptado | P16-F |
| [ADR-023](ADR-023-concurrencia-optimista-version-del-agregado-y-testigo-de-receta.md) | Concurrencia optimista: `version` entera por agregado (producto e ítem) con la condición en el `WHERE` y relectura 404/409; la receta protegida con `basadaEn` bajo `pg_advisory_xact_lock`; los lotes suben la versión sin exigirla; el 409 sin la versión dentro; la deuda entre sucursales (D-16.20) con su señal | ✅ aceptado | P16-B |
| [ADR-024](ADR-024-el-iva-de-compra-en-dos-niveles-y-la-discontinuidad-del-libro.md) | El IVA de compra en dos niveles, la discontinuidad que deja en el libro, la semilla 0.15, la guarda «COMPRA nueva ⇒ desglose» y el IVA cero de las preparaciones | ✅ aceptado | P16-A1 |
| [ADR-025](ADR-025-correo-transaccional-con-outbox-y-despachador.md) | El correo transaccional: outbox en la misma transacción, despachador con rol y proceso propios, las dos definer que escriben, el token que vive solo en vuelo (y el cifrado del campo, descartado con su señal), Resend por HTTP, la reserva junto a `SKIP LOCKED` | ✅ aceptado | P16-A1 |
| [ADR-026](ADR-026-limite-de-tasa-e-ip-tras-el-proxy.md) | El límite de tasa por IP y por destinatario en los cuatro endpoints, contar-y-anotar bajo `pg_advisory_xact_lock`, `rate_limit_hit` como exención de ámbito, la purga por el despachador, el 429 propio, y la IP del cliente tras el proxy (`ipDelCliente`, la IP fija de Caddy, la subred fija) | ✅ aceptado | P16-A1 |

## ADRs esperados por el plan

> La numeración es por **orden de creación**, no por tema. P0 consumió del 001 al 005 —dos de ellos, el del ORM y el de la aritmética, eran decisiones que había que tomar para escribir la primera línea de código—, así que lo que sigue se renumeró respecto de la previsión inicial.

> **Los dos ADR que el plan preveía para P6 salieron como uno solo, y merece explicarse.**
>
> El primero iba a ser «libro append-only frente a saldo mutable». Al escribirlo quedó claro que **no es una decisión**: R3 lo manda, CLAUDE.md §5 lo repite, y no hay alternativa que evaluar. Lo que sí había que decidir eran cosas que ninguno de los dos documentos nombra —si la cantidad lleva signo, si se guarda el total o el unitario, de qué tipo es una corrección— y esas son las que ADR-009 registra.
>
> El segundo iba a ser «costo real frente a costo estándar». Es la **decisión 4** de ADR-009, y se escribió ahí porque no se entiende sola: solo tiene sentido junto a la precedencia contraria que ADR-008 fijó para el motor de costeo, y separarlas habría dejado dos documentos que se contradicen en apariencia.

- *(ninguno pendiente hasta P7)*
