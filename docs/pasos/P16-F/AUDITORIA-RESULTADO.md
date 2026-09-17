# P16-F — Resultado de la auditoría

**Alcance del diff:** `apps/api` (política de intentos, error nuevo, caso de uso, puerto y repositorio
de autenticación, una migración, pruebas en los tres niveles), `docs/` (ADR-028, INC-027, SEGURIDAD,
sistema/seguridad, app-cliente, pasos/P16-F), `ESTADO.md` y `CHANGELOG`. **Ni una línea de `apps/web`.**

| Sección | Resultado | Evidencia |
|---|---|---|
| A · Arquitectura | ✅ | La regla nueva es **dominio puro** (`evaluarRociadoPorIp`: lista de fechas y correos, `ahora` por parámetro) y se prueba sin base ni reloj; el caso de uso solo la usa; el adaptador solo trae los datos |
| B · Código | ✅ | `audit:types`, `audit:lint`, `audit:complexity`; `audit:forbidden` **47 reglas sobre 564 archivos** |
| C · Seguridad | ✅ | El eje de cuenta no cambia (5/15 min, escalada, aviso al titular). El de IP deja de poder dejar fuera a terceros, y sigue cortando el rociado. Ni el bloqueo ni el límite gastan Argon2id. La IP sigue siendo la del cliente (INC-022) |
| D · Base de datos | ✅ | Migración 19: **solo una fila de catálogo**. `audit:migrations` **OK**; el `down` no borra la semilla (M10, INC-011) y lo explica |
| E · Reglas | ✅ | SEGURIDAD.md §2.1 queda apartada **en su segunda mitad**, con el porqué en la propia sección y en ADR-028 |
| G · Pruebas | ✅ | **902 unitarias** (+8) y **545 de integración** (+3), todas 🔴 del comportamiento nuevo. Las de HTTP, en archivo propio y con IP propia: la primera versión rompió tres suites ajenas y eso también se documenta |
| H · Documentación | ✅ | ADR-028, INC-027 con prevención automatizada, `app-cliente.md` con los dos 429 y su diferencia |
| I · Duplicación | ✅ | `Found 0 clones` |

### Salida de `npm run audit`

```
audit:forbidden  OK — 47 reglas sobre 564 archivos
✔ no dependency violations found (391 modules, 1755 dependencies cruised)
audit:arch  OK — reglas de capa respetadas y guardian verificado
Found 0 clones.
audit:migrations  OK — 19 migracion(es) reversibles y con RLS
audit:deps  OK — sin vulnerabilidades altas fuera de las 4 aceptadas y documentadas
      Tests  19 passed | 531 skipped (550)
      Tests  902 passed (902)
ℹ tests 49
ℹ pass 49
ℹ fail 0
      Tests  545 passed | 5 skipped (550)
audit:tests  OK — unitarias (sin base) e integracion en verde
audit exit=0
```
