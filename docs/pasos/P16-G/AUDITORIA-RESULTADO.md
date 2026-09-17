# P16-G — Resultado de la auditoría

**Alcance del diff:** `scripts/` (restauración por tenant, catálogo de tablas del tenant, volcado por
descriptor), `package.json`, `docs/` (runbook, INC-028, pasos/P16-G), `ESTADO.md` y `CHANGELOG`.
**Ni una línea de `apps/`.**

| Sección | Resultado | Evidencia |
|---|---|---|
| A · Arquitectura | ✅ | El script no decide qué es de quién: lo decide RLS. Ningún `WHERE company_id` escrito a mano |
| B · Código | ✅ | `audit:types`, `audit:lint`, `audit:complexity`; `audit:forbidden` **47 reglas sobre 567 archivos**. Sin identificadores interpolados: los nombres de tabla viajan como argumentos de `pg_dump`, y los recuentos son una unión escrita a mano (como `testigos.mjs`) |
| I · Duplicación (lo que destapó) | ✅ | `audit:duplication` marcó dos clones que el archivo nuevo hizo cruzar el umbral: `apuntandoA` (4 copias) y `argumento` (3) se van a `lib/`, y las dos invocaciones de `docker compose exec` —idénticas desde que ambas aceptan entorno— a `lib/docker.mjs`. `Found 0 clones` |
| Secretos | ✅ | `audit:secrets` murió con `ERR_STRING_TOO_LONG` al toparse con el volcado de 722 MiB en `.respaldos/`: un check que falla por el tamaño de un archivo binario que no mira nadie. `.secretlintignore` excluye los respaldos, con el motivo escrito |
| C · Seguridad | ✅ | Las filas salen y entran con el rol de la aplicación y el tenant fijado; `company_settings` **no** se reinserta con un rol más alto, se compara y se avisa; sesiones y outbox no vuelven; los dos logs no son ni legibles para la aplicación |
| D · Base de datos | ✅ | Sin migraciones. Orden de claves foráneas explícito y **guardián contra el catálogo**: una tabla de tenant que la lista no conozca para el script |
| G · Pruebas | ✅ | **902 unitarias** y **545 de integración**, sin cambios: esto es tooling de operación. Su prueba es el simulacro, y está en `CONSTRUCCION.md` y en el runbook |
| H · Documentación | ✅ | Runbook con el procedimiento, lo que no vuelve, el límite del libro append-only y la fila del ensayo; INC-028 |
| I · Duplicación | ✅ | `Found 0 clones`; las invocaciones de psql y pg_dump siguen viviendo una vez |

### Salida de `npm run audit`

```
audit:forbidden  OK — 47 reglas sobre 567 archivos
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
