# INC-009 — `syntax error at or near ":"` en un SQL que se ve correcto

| Campo | Valor |
|---|---|
| **Fecha** | 2026-08-27 |
| **Paquete** | P0 |
| **Área** | base de datos |
| **Tiempo perdido** | ~20 min |
| **Recurrencias** | 1 |

## Síntoma

`npm run migrate:verify` falla en el primer paso, y el error señala los dos puntos de una variable de psql:

```
Error: SQL de superusuario fallido sobre "postgres": ERROR:  syntax error at or near ":"
LINE 1: DROP DATABASE IF EXISTS :"base" WITH (FORCE);
                                ^
```

El SQL está bien escrito, la variable se pasa con `-v base=costeo_verif_ida`, y el mismo SQL con el nombre puesto a mano funciona.

## Contexto

`scripts/migrate-verify.mjs` recrea bases limpias antes de comparar esquemas. El nombre de la base **no se puede** pasar como parámetro —PostgreSQL no admite `$1` donde va un identificador— así que se usa la sustitución de psql `:"base"`, que lo entrecomilla como identificador. Es la forma correcta y además mantiene el código dentro de la regla `no-sql-interpolado` de `audit:forbidden`.

La invocación era:

```js
psql -v ON_ERROR_STOP=1 -v base=X -U postgres -d postgres -c 'DROP DATABASE IF EXISTS :"base" WITH (FORCE);'
```

## Causa raíz

**`psql -c` no sustituye variables.** La documentación lo dice de otra manera, y por eso es fácil pasarlo por alto: el argumento de `-c` debe ser *«una cadena completamente parseable por el servidor, es decir, que no contenga características propias de psql»*. `:"variable"` es exactamente una característica propia de psql.

Lo que ocurre entonces no es un error de psql, sino que **psql envía la cadena tal cual** y el que se queja es el servidor. De ahí que el mensaje apunte al SQL y no a la invocación, que es donde está el problema.

La sustitución **sí** ocurre cuando el SQL entra por un archivo o por la entrada estándar.

## Solución

Todo el SQL entra por stdin con `-f -`, también el de una sola línea:

```diff
- ...(entrada === undefined ? ['-c', sql ?? ''] : ['--single-transaction', '-f', '-']),
+ ...(desdeArchivo ? ['--single-transaction'] : []),
+ '-f', '-',
```

Con un detalle que no se puede unificar: **`--single-transaction` solo para el archivo de privilegios.** `DROP DATABASE` y `CREATE DATABASE` no pueden ejecutarse dentro de un bloque de transacción, así que la vía de una sola sentencia va sin él.

## Qué NO era

- **No era el SQL.** Estaba bien escrito; llegaba sin sustituir.
- **No era que faltara `-v`.** Estaba puesto y bien formado. psql lo aceptaba y lo ignoraba para `-c`.
- **No era interpolación insegura.** Justamente se usaba `:"base"` para **evitar** interpolar el nombre en la cadena. La solución conserva esa propiedad: sigue siendo psql quien entrecomilla el identificador.
- **No se arregla interpolando el nombre en JavaScript.** Sería un `${}` dentro de una cadena SQL, que es lo que `no-sql-interpolado` prohíbe, y con razón.

## Prevención

- [x] ¿Se puede convertir en una prueba automatizada? **Sí, y ya existía:** `migrate:verify` es la prueba. Lo que faltaba era **ejecutarla**. Está en el workflow de CI como paso propio, así que a partir de ahora ninguna rama pasa sin correrla.
- [ ] ¿Se puede convertir en una verificación de `npm run audit`? No de forma razonable: `audit:forbidden` no puede saber si una cadena con `:"..."` va a ir por `-c` o por stdin. Y `migrate:verify` no entra en `audit` a propósito, porque crea y destruye bases (ADR-004).
- [ ] ¿Es una regla que debería estar en `CLAUDE.md`? No: es un detalle de una herramienta.
- [ ] ¿Es una decisión que merece un ADR? No.

### La lección, que es más amplia que psql

**Un comando que se dio por verde en una sesión anterior no está verde ahora.** `migrate:verify` se había reportado en verde antes en este mismo paquete, y al volver a ejecutarlo falló al primer paso. Lo que vale como evidencia es la salida de **esta** corrida, no el recuerdo de la anterior — que es, por otra vía, la misma lección de [INC-007](INC-007-un-check-pasa-en-verde-sin-medir-nada.md).

Por eso `migrate:verify` es ahora un paso explícito del workflow de CI, y no algo que se corre a mano cuando uno se acuerda.

## Referencias

- PostgreSQL — documentación de `psql`, opción `-c` y sección «Variables». Consultado el 2026-08-27
