# P16-U — Resultado de la auditoría

**Alcance del diff:** `docker/postgres/initdb/10-bootstrap.sh` (8 líneas y el **modo del archivo**),
`tools/audit/rules/repo.rules.mjs` (una regla nueva), `docs/incidencias/INC-033` y su fila en el
índice, `docs/pasos/P16-U/`, `ESTADO.md` y el `CHANGELOG`. **Ni una línea de `apps/api` ni de
`apps/web`.** No hay migración, no hay endpoint, no hay dominio tocado.

| Sección | Resultado | Evidencia |
|---|---|---|
| A · Arquitectura | ✅ | No aplica: el cambio vive en `docker/` y `tools/`. `audit:arch` sin violaciones (397 módulos, 1.788 dependencias) |
| B · Código | ✅ | `audit:types`, `audit:lint`, `audit:complexity` y `audit:duplication` (`Found 0 clones`) en verde. La regla nueva sigue la forma de las 48 existentes: `id`, `descripcion`, `porQue`, `referencia`, `desde`, `revisar` |
| C · Seguridad | ✅ | **Refuerza la Barrera 1.** Lo que estaba roto era la creación de los cuatro roles, y `costeo_app` es el rol no-propietario sobre el que descansa todo el RLS (CLAUDE.md §4.1). Un cluster que arranca sin roles no es un fallo de despliegue: es la defensa entera sin construir. Ningún secreto nuevo; `audit:secrets` en verde |
| D · Base de datos | ✅ | `audit:migrations` **22/22** · `migrate:verify` **4/4**, con `ENABLE` + `FORCE ROW LEVEL SECURITY` en toda tabla. Ninguna migración nueva: el arreglo es del arranque del cluster, anterior a la primera migración |
| E · Reglas de negocio | ✅ | Intactas. El diff no toca dominio ni casos de uso |
| F · Rendimiento | ✅ | Sin efecto: el script corre una vez, con el volumen vacío. No se ejecuta `npm run bench` porque el paquete **no toca ninguna lectura** (AUDITORIA.md I8) |
| G · Pruebas | ✅ | 918 unitarias (con la base apagada) · 555 de integración · 49 de `apps/web`. **Y la verificación que de verdad cuenta aquí no es una prueba automatizada**: levantar la base con un volumen vacío, que es la condición que el defecto necesitaba (ver abajo) |
| H · Documentación | ✅ | INC-033 con síntoma literal, causa, solución, «qué NO era» y prevención · fila en el índice de incidencias · **dos áreas frecuentes nuevas** · `CONSTRUCCION.md` · `ESTADO.md` · `CHANGELOG` |
| I · Duplicación / YAGNI | ✅ | Una regla, ocho líneas de script y un `chmod`. No se añadió ningún andamiaje para «vigilar el bit de ejecución», que es lo que pedía el cuerpo: con `core.fileMode=false` no hay de dónde leerlo de forma fiable, y un check que no puede medir es INC-007 otra vez. Queda **declarado** como no cubierto, no fingido |

### La verificación que importa

**La auditoría completa ya pasaba ANTES del arreglo.** Eso es exactamente lo que hace peligroso este
defecto y por qué el verde de esta tabla, solo, no probaría nada.

Lo que se verificó, en la condición que el fallo necesitaba —volumen **vacío**, en un proyecto de
compose aparte para no tocar la base de desarrollo—:

```
[initdb] creando roles costeo_migrator, costeo_app, costeo_backoffice y costeo_despachador
[initdb] creando la base sombra costeo_shadow
[initdb] aplicando privilegios en costeo
[initdb] aplicando privilegios en costeo_shadow
[initdb] listo

SALUD=healthy
costeo_app · costeo_backoffice · costeo_despachador · costeo_migrator
```

La base de prueba y su volumen se destruyeron después. La de desarrollo siguió en pie.

### La regla nueva, vista FALLAR

Un check que solo se ha visto en verde no está verificado (INC-007). Se volvió a añadir la línea
original y el check la señaló con ruta y línea:

```
audit:forbidden  FALLO — 1 infraccion(es)
  [initdb-no-resuelve-su-ruta-con-dollar-cero]
     docker/postgres/initdb/10-bootstrap.sh:53  directorio="$(dirname "$0")/sql"
```

Restaurado el archivo bueno, vuelve a `OK — 49 reglas`.

### Lo que la auditoría destapó, y no estaba en el plan

**La regla del doble intérprete (CLAUDE.md §3) volvió a morder, dentro de este mismo paquete.** Al
insertar la fila del índice de incidencias con un `python -c "..."` desde bash, los backticks del
texto Markdown los ejecutó **bash** como sustitución de comandos antes de que Python viera la
cadena, y la fila quedó con dos huecos donde estaban `container costeo-db is unhealthy` y el mensaje
de `psql`. Es el caso de P16-I calcado.

No lo caza `sin-caracteres-de-control`, porque el daño no es un carácter de control: es **texto que
desaparece**. Se corrigió reescribiendo la fila con la herramienta de edición, que es lo que la
regla manda desde el principio. **Queda como recurrencia registrada del patrón, no como ficha
nueva.**

### Salida de `npm run audit`

```
audit:forbidden  OK — 49 reglas sobre 602 archivos
✔ no dependency violations found (397 modules, 1788 dependencies cruised)
audit:arch  OK — reglas de capa respetadas y guardian verificado
Found 0 clones.
audit:migrations  OK — 22 migracion(es) reversibles y con RLS
audit:deps  OK — sin vulnerabilidades altas fuera de las 4 aceptadas y documentadas
      Tests  19 passed | 541 skipped (560)     (cabeceras de seguridad)
      Tests  918 passed (918)                  (unitarias, con la base apagada)
ℹ tests 49                                     (apps/web, node --test)
      Tests  555 passed | 5 skipped (560)      (integracion)
audit:tests  OK — unitarias (sin base) e integracion en verde
```

`migrate:verify` — 4/4, ejecutado aparte como en cada paquete.

**Las 5 saltadas son los presupuestos p95 de §5**, que se omiten en Windows por INC-016 y **se
exigen en CI**, donde `SE_EXIGE_EL_PRESUPUESTO` lee `process.env.CI`. Hasta este paquete **nunca
habían llegado a ejecutarse en CI**, porque el job moría antes.
