# ESTADO.md — Memoria del proyecto costeo-saas

> **Este archivo es la única memoria que sobrevive a una compactación de contexto.**
> Claude Code lo lee al inicio de cada sesión y lo actualiza al cerrar cada paquete.
> Escríbelo pensando en alguien que no vivió las sesiones anteriores.

---

## Estado actual

**Paquete en curso:** P0 — Fundación del repositorio
**Fase del protocolo:** no iniciado
**Último commit:** —
**Fecha de última actualización:** —

---

## Progreso

| Paquete | Estado | Commit | Fecha |
|---|---|---|---|
| P0 — Fundación del repositorio | ⬜ Pendiente | — | — |
| P1 — IAM · tenants · ubicaciones · roles | ⬜ Pendiente | — | — |
| P2 — Catálogo · ítems · artículos · unidades | ⬜ Pendiente | — | — |
| P3 — Precios de referencia con vigencia | ⬜ Pendiente | — | — |
| P4 — Recetas · productos · combos | ⬜ Pendiente | — | — |
| P5 — MOTOR DE COSTEO ⭐ | ⬜ Pendiente | — | — |
| P6 — Inventario · libro mayor append-only | ⬜ Pendiente | — | — |
| P7 — Períodos · conteo físico | ⬜ Pendiente | — | — |
| P8 — Vistas analíticas | ⬜ Pendiente | — | — |
| P9 — Consolidado y comparativa | ⬜ Pendiente | — | — |
| P10 — Importación Excel/CSV | ⬜ Pendiente | — | — |
| P11 — Back office | ⬜ Pendiente | — | — |
| P12 — Frontend app cliente | ⬜ Pendiente | — | — |
| P13 — Frontend back office | ⬜ Pendiente | — | — |
| P14 — Capa visual | ⬜ Pendiente | — | — |
| P15 — Endurecimiento | ⬜ Pendiente | — | — |

Estados: ⬜ Pendiente · 🟡 En curso · ✅ Completado · ⚠️ Completado con pendientes

---

## Decisiones tomadas durante la construcción

> Toda decisión técnica que no estaba en el SPEC y se resolvió al implementar. Sin esto, un "tú" futuro la vuelve a decidir distinto y aparecen inconsistencias.

| # | Decisión | Paquete | Razón |
|---|---|---|---|
| — | — | — | — |

---

## Dudas abiertas para el usuario

> Preguntas que surgieron y aún no tienen respuesta. Bloquean o condicionan trabajo futuro.

| # | Duda | Paquete que la levantó | Qué bloquea |
|---|---|---|---|
| — | — | — | — |

---

## Deuda técnica aceptada conscientemente

> Solo entra aquí lo que el **usuario aprobó explícitamente** posponer. Un fallo de auditoría **no** se registra aquí: se corrige.

| # | Deuda | Paquete | Cuándo se paga |
|---|---|---|---|
| — | — | — | — |

---

## Convenciones establecidas

> Nombres, patrones y estructuras que se fijaron al construir y deben mantenerse consistentes.

| Ámbito | Convención |
|---|---|
| Nombres de tablas | *(por definir en P0)* |
| Nombres de migraciones | *(por definir en P0)* |
| Estructura de módulos | `src/modules/<modulo>/{domain,application,infrastructure}` |
| Nombres de pruebas | *(por definir en P0)* |
| Formato de commits | `P{n}: {nombre}` — ver `docs/PROTOCOLO.md` |

---

## Notas de contexto

> Cualquier cosa que un desarrollador nuevo (o un contexto compactado) necesitaría saber y no está en el SPEC.

- El SPEC completo está en `docs/SPEC.md`
- Las reglas obligatorias están en `CLAUDE.md`; protocolo en `docs/PROTOCOLO.md`; checklist en `docs/AUDITORIA.md`
- Las decisiones abiertas con valores provisionales están en `DECISIONES.md` — no cerrarlas sin preguntar
- `docs/FASE0-CHECKLIST.md` lista lo no-técnico que bloquea el lanzamiento; se revisa al inicio de cada corrida
- `docs/incidencias/README.md` es el registro de problemas ya resueltos. **Se lee al inicio de cada paquete y antes de diagnosticar cualquier error.** Después de una compactación es especialmente valioso: es probable que el problema con el que estabas peleando ya esté ahí
- **P5 (motor de costeo) es el camino crítico.** Es el único componente donde un error no se ve en pantalla: produce números plausibles y equivocados que el cliente usa para fijar precios. Todo P0–P4 existe para alimentarlo y todo P6–P15 para mostrarlo. Su criterio arquitectónico —que se pueda probar con la base de datos apagada— es el que valida que las capas están bien hechas.