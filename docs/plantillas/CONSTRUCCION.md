# P{n} — Documento de construcción

> Se crea al **iniciar** el paquete y se completa durante la construcción. Es la bitácora técnica de lo que realmente se hizo. Vive en `docs/pasos/P{n}/CONSTRUCCION.md`.

## Resumen
| Campo | Valor |
|---|---|
| Paquete | P{n} — {nombre} |
| Fecha inicio / fin | |
| Commit final | `{hash}` |
| Secciones del SPEC implementadas | |
| Estado | 🟡 en curso · ✅ completado |

## Objetivo del paquete
{Qué debía lograr, en 2-3 líneas, con criterio de aceptación}

## Plan aprobado
{El plan de la Fase 2 del protocolo, tal como se aprobó}

## Qué se construyó

### Dominio
| Elemento | Archivo | Descripción |
|---|---|---|
| {Entidad/VO/Regla} | `src/modules/.../domain/...` | |

### Casos de uso y puertos
| Caso de uso | Puertos que define | Archivo |
|---|---|---|

### Infraestructura
| Adaptador | Implementa | Archivo |
|---|---|---|

### Migraciones
| Migración | Qué cambia | Índices creados | Reversible |
|---|---|---|---|

## Diagrama del paquete
```mermaid
{flowchart / sequenceDiagram / erDiagram de lo construido}
```

## Decisiones técnicas tomadas
> Todo lo que no estaba en el SPEC ni en DECISIONES.md y se resolvió aquí. Cada una debe referenciar su ADR si amerita.

| # | Decisión | Alternativas descartadas | Razón | ADR |
|---|---|---|---|---|

## Consultas del camino crítico
| Consulta | Índice que usa | EXPLAIN ANALYZE (resumen) | Tiempo |
|---|---|---|---|

## Pruebas
| Tipo | Cantidad | Qué cubren |
|---|---|---|
| Unitarias dominio | | |
| Casos de uso | | |
| Integración | | |

## Problemas encontrados y cómo se resolvieron
| Problema | Solución | Tiempo perdido |
|---|---|---|

## Deuda y pendientes
{Solo lo aprobado explícitamente por el usuario. Referencia a ESTADO.md}

## Cómo probar manualmente lo construido
{Pasos concretos para que el usuario verifique el paquete: comandos, URLs, datos de ejemplo}


## Incidencias registradas en este paquete

> Problemas que cumplieron el criterio de `docs/incidencias/README.md`. Los que no lo cumplen se anotan arriba, en problemas, y no generan ficha.

| Incidencia | Síntoma | ¿Se automatizó la prevención? |
|---|---|---|
| — | — | — |
