# DECISIONES.md — Valores provisionales para construir sin frenarse

> Las decisiones abiertas del proyecto, resueltas con un **valor provisional** para que la construcción no se detenga.
> **Regla**: todo valor de este archivo se implementa como **configuración versionada**, nunca como constante en el código.
> Estado: 🟡 provisional (usar sin preguntar) · ✅ confirmada por el usuario · 🔴 bloqueante (preguntar sí o sí)

---

## D1 — Nombre del proyecto 🟡

**Valor provisional:** `costeo-saas` como nombre de trabajo del repositorio y los paquetes.

No hay nombre comercial definido. **No inventar branding.** Usar el nombre de trabajo en código y rutas; los textos visibles al usuario que necesiten el nombre del producto leen de `config/branding.ts`, con el valor provisional `"Costeo"`.

Destranca: dominio, marca, correo transaccional. Ver `docs/FASE0-CHECKLIST.md` A1.

---

## D2 — Versiones exactas del stack 🔴

**Bloquea:** el cierre de P0.

Hay una propuesta de versiones en `CLAUDE.md` §1, derivada de las cadencias públicas de cada proyecto. **No son lecturas de fuente oficial.** En la fase PLAN de P0, Claude Code confirma los seis puntos de la tabla de `CLAUDE.md` §1 y escribe **ADR-001** con las fechas confirmadas.

Propuesta de partida: Node 24 LTS · PostgreSQL 18 · NestJS 11 · Prisma 6 · Next.js 16.

**Dos avisos con consecuencia real:**

- **Node 20 alcanzó su fin de soporte en abril de 2026.** No usarlo.
- **Node 24 vence en abril de 2028**, poco menos de dos años. Node 26 promueve a LTS hacia octubre de 2026 con soporte hasta ~abril de 2029. Si al ejecutar P0 ya promovió, usar 26. Si no, arrancar en 24 y planificar el salto.

No bloquea empezar a trabajar; bloquea **cerrar** P0 sin el ADR.

---

## D12 — ORM: Prisma frente a Drizzle ✅

**Confirmada por el usuario: Prisma**, con las tres barreras de aislamiento de `CLAUDE.md` §4.1 implementadas completas.

**El problema.** Prisma **no tiene soporte RLS nativo**. El patrón obligado es transacción interactiva + `SET LOCAL` inyectado mediante Client Extensions (`$extends`), y tiene caveats conocidos con connection pooling. Drizzle ORM, en cambio, declara políticas RLS **en el esquema** (`pgPolicy`, `pgRole`) y da control explícito de la conexión, lo que reduce la probabilidad de ejecutar un query en una conexión sin contexto de tenant.

**Por qué Prisma igual.** Tres razones:

1. **La garantía real la da PostgreSQL**, no el ORM. Con RLS deny-by-default, `FORCE ROW LEVEL SECURITY` y un rol de aplicación no-superusuario, una fuga es imposible aunque el ORM se use mal. El ORM solo determina la ergonomía de fijar el contexto
2. **Madurez.** Prisma tiene más trayectoria, ecosistema y tooling. Drizzle ha tenido más rotación de API
3. **La integración futura con Noctis Commerce**, que usa Prisma. Dos ORMs distintos en productos que un día se fusionan es fricción evitable

**Condiciones para que esta decisión sea válida.** Si alguna no se cumple en P1, se reevalúa:

- Un único punto centralizado con `$extends` que fuerce transacción + `SET LOCAL`
- Regla de `audit:forbidden` que impida usar el cliente fuera de ese envoltorio
- Prueba explícita bajo **PgBouncer en modo transacción** con `?pgbouncer=true` antes de producción
- Test de dos tenants que falla si el envoltorio se omite

**La decisión está confirmada, las condiciones no son opcionales.** Confirmar Prisma no elimina el problema que Drizzle resolvía de fábrica: lo traslada a la barrera 1 y al envoltorio de `$extends`. Si esas cuatro condiciones no están completas al cerrar P1, el aislamiento depende de que nadie se equivoque nunca, y eso no es una garantía.

**Sigue siendo relevante verificar en P0** si Prisma publicó soporte RLS nativo (punto 4 de la tabla de `CLAUDE.md` §1). Si lo hizo, simplifica la barrera 2 y hay que actualizar ADR-002.

Debe quedar registrado en **ADR-002**, incluyendo por qué se descartó Drizzle: la garantía real la aporta PostgreSQL, la madurez de Prisma, y la integración futura con Noctis Commerce, que ya usa Prisma.

---

## D3 — Parámetros de costeo por defecto ✅

Valores confirmados, tomados del Excel original. **Son configuración por company**, editables desde la app, con estos valores como semilla al crear un tenant:

| Parámetro | Valor semilla | Vive en |
|---|---|---|
| IVA de venta | `0.15` | `company_settings` |
| IVA de compra recuperable | `true` | `company_settings` |
| Provisión de merma no atribuible | `0.02` | `company_settings` |
| Food cost objetivo mínimo | `0.25` | `company_settings` |
| Food cost máximo aceptable | `0.32` | `company_settings` |
| Umbral verde de food cost | `0.28` | `company_settings` |
| Prime cost máximo | `0.65` | `company_settings` |
| Días operativos al mes | `22` | `company_settings` |
| Días de cobertura objetivo | `7` | `company_settings` |
| Regla de popularidad (Kasavana-Smith) | `0.70` | `company_settings` |

**Ninguno de estos números se escribe en el código.** El motor de costeo los recibe como parámetro.

---

## D4 — Qué representa el tipo `LNK` en T1 del Excel 🔴

**Bloquea:** la migración de datos desde el Excel (no bloquea P0–P8).

Cuatro filas de `T1_INSUMOS` están marcadas `LNK` y el LEEME no las documenta. Los otros tres tipos sí están resueltos: `INS` → ítem comprado, `SUB` → ítem producido, `SUP` → nivel de confianza del precio.

Hasta tener respuesta: **no modelar nada para `LNK`.** Si aparece al importar, se rechaza la fila con un error explícito y se pregunta.

---

## D5 — Modelo de suscripción y precios 🟡

**Valor provisional:** suscripción mensual por company con límite de ubicaciones incluidas. Estructura de tres planes, sin precios definidos.

En código: la company tiene un `plan_id` y el plan declara límites (`max_locations`, `max_items`, `max_products`). Los límites se **verifican en el backend** desde el primer paquete que los toque, con valores generosos por defecto.

No implementar cobro, pasarela ni facturación en este proyecto. Ver D9.

---

## D6 — Retención y cierre de períodos 🟡

**Valor provisional:** un período es un mes calendario. Se cierra manualmente al cargar el conteo físico. Un período cerrado es de solo lectura: los movimientos con fecha dentro de él se rechazan.

Reapertura: posible solo por rol `OWNER`, registrada en el log de auditoría.

Vive en `config/periods.ts`.

---

## D7 — Política de conteo físico parcial 🟡

**Valor provisional:** el conteo puede ser parcial. Los ítems sin conteo no generan diferencia y quedan marcados como "sin verificar"; el food cost real se calcula señalando qué porcentaje del valor del inventario fue efectivamente contado.

Alternativa descartada por ahora: exigir conteo completo. Se descartó porque en la práctica nadie cuenta 200 ítems y forzarlo produce números inventados.

---

## D8 — Fuentes externas de precios ✅

**Decisión: fuera de alcance de este proyecto.** No se implementa integración con Tipti ni scraping de ninguna plataforma.

Razones registradas: son precios de retail al consumidor y los clientes compran mezclado entre mayorista y supermercado; no consta API pública para terceros; el scraping implicaría incumplimiento probable de términos de uso y una dependencia frágil en el camino crítico del producto.

**Lo único que se construye:** el campo `origen` del precio de referencia acepta `MANUAL`, `ULTIMA_COMPRA` y `EXTERNO`. Nada más.

Pendiente de negocio, no de código: verificar con el equipo comercial de Tipti si existe acceso bajo contrato, sus términos de uso, y si permiten redistribuir precios dentro de un producto de terceros.

---

## D9 — Integración futura con Noctis Commerce 🟡

**Valor provisional:** este proyecto es independiente y no comparte código, base de datos ni despliegue con Noctis Commerce.

Restricción que sí se respeta desde ahora: la API no asume que las unidades vendidas se digitan. El caso de uso `RegisterSales` recibe un lote de (producto, ubicación, período, unidades) sin importar si viene de digitación, importación o un sistema externo. La digitación es un adaptador más.

No diseñar la integración. Solo no cerrarle la puerta.

---

## D10 — Hosting y despliegue 🟡

**Valor provisional:** contenedores sobre AWS, con PostgreSQL gestionado. La decisión concreta de servicio se posterga al paquete de endurecimiento.

Consecuencia obligatoria desde P0: **nada específico de proveedor en el código de aplicación.** Almacenamiento de archivos y correo van tras puerto con fake.

---

## D11 — Idioma y localización 🟡

**Valor provisional:** español de Ecuador, moneda USD, zona horaria `America/Guayaquil`, formato de fecha `dd/MM/yyyy`.

Los textos visibles viven en archivos de recursos desde el primer componente, aunque haya un solo idioma. El código es en inglés.

---

## Cómo usar este archivo

- Claude Code **usa estos valores sin preguntar** mientras estén en 🟡
- Si una tarea exige decidir algo que **no está aquí ni en el SPEC** → se agrega a `ESTADO.md` como duda, se elige la opción **más conservadora y configurable**, y se deja registrado
- El usuario cambia 🟡 → ✅ al confirmar, o corrige el valor
- Los 🔴 sí detienen: son D2 (cierre de P0) y D4 (migración de datos)
- D12 (ORM) quedó confirmada en Prisma. Sus cuatro condiciones se verifican al cerrar P1.
