# CHANGELOG

Una entrada por commit de paquete. Formato: `## P{n} — {nombre}` con fecha, qué se entregó y qué quedó pendiente.

---

## P0 — Fundación del repositorio · 2026-08-27

**Objetivo:** que escribir código malo sea difícil. P0 no implementa negocio: implementa las condiciones para que el negocio se escriba bien.

### Entregado

- **`npm run audit` con once verificaciones**, en CI y en pre-commit: tipos, lint, prohibiciones, capas, código muerto, complejidad, duplicación, migraciones, secretos, cabeceras de seguridad y pruebas
- **Tipos de dominio para dinero y cantidades** — `Money`, `Ratio`, `Count`, `Quantity` y `UnidadDeUso`, con marca nominal, `valueOf()` que lanza y API de comparación completa. 98 pruebas
- **Mini-conciliación R7** con tres productos reales del Excel de referencia. `ROUND(diff, 2) = 0.00`, con canario a `1e-6`
- **PostgreSQL 18.6 fijado por digest**, con dos roles separados: `costeo_migrator` (dueño) y `costeo_app` (sujeto a RLS, no superusuario). Verificado por 9 pruebas contra la base real
- **Migraciones reversibles** con `down.sql` generado y verificado por una escalera de cuatro pasos sobre bases reales
- **`audit_log` append-only en tres capas**, con RLS deny-by-default. 14 pruebas
- **Aplicación NestJS** — entorno validado por Zod, `correlation_id` por `AsyncLocalStorage`, `/health` y `/ready` separadas, cabeceras de SEGURIDAD.md §4.4 con nonce por respuesta, limitador, timeout, formato único de error y falsos de correo y almacenamiento
- **CI en GitHub Actions** con acciones fijadas por SHA, que levanta el stack completo y comprueba que responde **sin una sola credencial real**
- **ADR-001 a ADR-005** · **INC-001 a INC-009** · documentación de sistema, modelo de datos, configuración y despliegue

### Decisiones que cierran preguntas abiertas

- **D2 cerrada** (ADR-001): Node 24.20.0, PostgreSQL 18.6, NestJS 11.2.3, Prisma 7.10.0, Next.js 16.3.3, con sus fechas de fin de soporte verificadas en fuente oficial
- **D12 cerrada** (ADR-002): se mantiene Prisma. El RLS nativo existe solo en Prisma 8 RC y cubre la Barrera 1, **no la Barrera 2**

### Lo que se descubrió por el camino

**Seis checks pasaban en verde sin medir nada** — un parser ausente, un fixture en ruta excluida, un glob que dejaba fuera las pruebas, unos patrones de ignorar mal anclados, una clave de configuración que la herramienta ignora, y un guardián que solo cubría dos de las tres formas de abrir una conexión. Cuatro de los seis los encontró la prueba del guardián. Registrado en [INC-007](incidencias/INC-007-un-check-pasa-en-verde-sin-medir-nada.md).

**Una regla de seguridad fallaba abierto**: la comprobación de que `DATABASE_URL` usa el rol de la aplicación no se ejecutaba si otra variable era inválida. [INC-008](incidencias/INC-008-superrefine-no-corre-si-otro-campo-fallo.md), y la regla general está ahora en `CLAUDE.md` §3.

### Pendiente

| Qué | Cuándo |
|---|---|
| Prueba del limitador de peticiones — hoy no protege ninguna ruta | P1 |
| Barreras 2 y 3 del aislamiento | P1 |
| `CompanyId`, `LocationId`, `ItemId`, `ProductId` | P1–P4 |
| `UnitCost` | P3 |
| CC-004 (base AP frente a EP) — no se pudo extraer del Excel: las 293 líneas de T3 están todas en base EP | P5 |
| Generador `prisma-client-js` → `prisma-client` | Con la evaluación de Prisma 8 |
| Salto a Node 26 | Promueve a LTS el 2026-10-28 |

**174 pruebas en verde** · 128 unitarias con la base apagada, 46 de integración.
