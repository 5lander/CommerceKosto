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

---

## Revisión del umbral — D-16.199 (2026-09-19)

**Alcance del diff:** `apps/api` (una constante del dominio, su comentario y cinco pruebas),
`docs/` (ADR-028 con el porqué del número, SEGURIDAD, sistema/seguridad, app-cliente, este paso),
`ESTADO.md` y `CHANGELOG`. **Sin migraciones y sin cambios de forma: solo el número y lo que lo fija.**

| Sección | Resultado | Evidencia |
|---|---|---|
| A · Arquitectura | ✅ | El cambio es **una constante del dominio**; ni el caso de uso ni el adaptador se tocan |
| C · Seguridad | ✅ | El umbral sube donde el tráfico legítimo compartido no llega (50 cuentas/hora). El eje de cuenta —el que protege la credencial— no cambia: cinco fallos y esa cuenta se bloquea |
| E · Reglas | ✅ | ADR-028 gana la sección «Por qué cincuenta y no diez», con el error asimétrico escrito y qué se mira para revisarlo |
| G · Pruebas | ✅ | **905 unitarias** (+3) y **546 de integración** (+1): doce cuentas no limitan · cuatrocientos fallos de diez cuentas siguen siendo diez · cincuenta sí, sin escalada |
| I · Duplicación | ✅ | `Found 0 clones` |

### Salida de `npm run audit`

```
audit:forbidden  OK — 47 reglas sobre 567 archivos
✔ no dependency violations found (391 modules, 1755 dependencies cruised)
audit:arch  OK — reglas de capa respetadas y guardian verificado
Found 0 clones.
audit:migrations  OK — 19 migracion(es) reversibles y con RLS
audit:deps  OK — sin vulnerabilidades altas fuera de las 4 aceptadas y documentadas
      Tests  19 passed | 532 skipped (551)
      Tests  905 passed (905)
ℹ tests 49
ℹ pass 49
ℹ fail 0
      Tests  546 passed | 5 skipped (551)
audit:tests  OK — unitarias (sin base) e integracion en verde
audit exit=0
```
