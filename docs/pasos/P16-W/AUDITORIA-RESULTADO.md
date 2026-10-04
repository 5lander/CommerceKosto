# P16-W — Resultado de la auditoría

**Alcance del diff:** `scripts/lib/sonda-de-la-base.mjs` (nuevo), `tools/audit/base.mjs` (nuevo),
`tools/audit/tests.mjs`, `tools/doctor.mjs`, `package.json` (un script y su sitio en `audit`),
`CLAUDE.md` (§3 «Commits» y una fila en §13), INC-015 e **INC-035** con sus filas en el índice,
`docs/pasos/P16-W/`, `ESTADO.md` y el `CHANGELOG`. **Ni una línea de `apps/api` ni de `apps/web`.** Sin
migración, sin endpoint, sin dominio.

| Sección | Resultado | Evidencia |
|---|---|---|
| A · Arquitectura | ✅ | No aplica: el cambio vive en `scripts/` y `tools/`. `audit:arch` sin violaciones (397 módulos, 1.788 dependencias) |
| B · Código | ✅ | `audit:types` (con `checkJs` sobre `tools/` y `scripts/`), `audit:lint`, `audit:complexity` y `audit:duplication` (`Found 0 clones`) en verde. La constante de intentos vive una vez, en el módulo |
| C · Seguridad | ✅ | **La sonda no autentica ni manda una contraseña**: el `StartupMessage` lleva usuario y base, y se lee solo la primera respuesta. **El módulo no carga el `.env`**, así que `audit:tests` sigue sin pasar variables a las unitarias. `audit:secrets` en verde |
| D · Base de datos | ✅ | `audit:migrations` 22/22. Ninguna migración nueva. `migrate:verify` **no se ejecuta**: el paquete no toca ninguna migración |
| E · Reglas de negocio | ✅ | Intactas. El diff no toca dominio ni casos de uso |
| F · Rendimiento | ✅ | Sin efecto en la aplicación. La sonda añade como mucho 3 × 3 s por puerto si algo no contesta, y en verde tarda milisegundos. No se ejecuta `npm run bench`: no toca ninguna lectura (AUDITORIA.md I8) |
| G · Pruebas | ✅ | 918 unitarias · 558 de integración (5 saltadas) · 56 de `apps/web` · 19 de cabeceras. **La verificación que cuenta aquí son los cuatro escenarios provocados de verdad** (`CONSTRUCCION.md`), no una prueba automatizada: el tooling no tiene suite propia |
| H · Documentación | ✅ | INC-015 con las recurrencias 2 y 3 y la prevención hecha · **INC-035 nueva** · filas en el índice · `CONSTRUCCION.md` · `ESTADO.md` · `CHANGELOG` · CLAUDE.md §3 y §13 |
| I · Duplicación / YAGNI | ✅ | Un módulo que ya tenía dos llamantes (`doctor` y `audit:tests`) y gana un tercero (`audit:base`). No hay opción ni parámetro que nadie use |

### La primera corrida salió en rojo, y no por P16-W

`npm run audit` del 2026-10-03 terminó con **exit 1**: 24 pruebas de integración en rojo en
`autenticacion-y-autorizacion.spec.ts` y `backoffice-correo.spec.ts`, todas por
`Error: Memory allocation error` de Argon2. Todo lo de este paquete estaba en verde (`audit:base` OK).
**No se hizo commit.**

La medición lo explicó: **2.618 MB de memoria comprometida libre de 64.893 MB**. Con el permiso del
usuario se paró un `next dev` de otro proyecto (8.964 MB privados), la memoria libre pasó a
**13.196 MB**, y la misma auditoría, sin cambiar una línea, pasó entera. La hipótesis de la
concurrencia quedó descartada: la integración corre en un solo proceso y esas suites calculan un hash
cada una. Es **INC-035**.

### La sonda, vista FALLAR

Los cuatro escenarios están en `CONSTRUCCION.md`. El que reproduce la recurrencia 3:

```
$ docker stop costeo-pgbouncer
audit:base  FALLO — localhost:6432 (PGBOUNCER_DATABASE_URL) rechazada
  Reenvio de Docker desincronizado (INC-015): npm run db:down && npm run db:up
audit:tests  FALLO — la base no contesta como dicen las cadenas: localhost:6432 (PGBOUNCER_DATABASE_URL) rechazada
```

### Salida de `npm run audit` (la repetición, 2026-10-04)

```
audit:forbidden  OK — 50 reglas sobre 604 archivos
✔ no dependency violations found (397 modules, 1788 dependencies cruised)
audit:arch  OK — reglas de capa respetadas y guardian verificado
Found 0 clones.
audit:migrations  OK — 22 migracion(es) reversibles y con RLS
audit:deps  OK — sin vulnerabilidades altas fuera de las 12 aceptadas y documentadas
audit:base  OK — localhost:5442, localhost:6432 contestan; el directo es PostgreSQL
      Tests  19 passed | 544 skipped (563)     (cabeceras de seguridad)
      Tests  918 passed (918)                  (unitarias, con la base apagada)
ℹ tests 56 · ℹ fail 0                          (apps/web, node --test)
      Tests  558 passed | 5 skipped (563)      (integracion)
audit:tests  OK — unitarias (sin base) e integracion en verde
exit=0  ·  Memory allocation error: 0
```
