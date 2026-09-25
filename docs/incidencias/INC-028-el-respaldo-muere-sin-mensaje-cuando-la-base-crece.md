# INC-028 — El respaldo muere sin mensaje en cuanto la base pasa de medio giga

| Campo | Valor |
|---|---|
| **Fecha** | 2026-09-17 |
| **Paquete** | P16-G (lo destapó el simulacro de D-16.195) |
| **Área** | despliegue · build |
| **Tiempo perdido** | ~25 min |
| **Recurrencias** | 0 |

> **`npm run respaldo` falla con el stderr vacío.** No hay mensaje de PostgreSQL, no hay línea de
> error del sistema: solo `Error: pg_dump fallo sobre "costeo":` y nada detrás.

## Síntoma

```
[respaldo] volcando
Error: pg_dump fallo sobre "costeo":
    at volcar (file:///…/scripts/lib/pgdump.mjs:108:11)
```

Y `pg_dump` lanzado a mano contra la misma base, con las mismas credenciales, **funciona**.

## Contexto

Apareció al preparar el simulacro de restauración por tenant (D-16.195), que empieza por hacer un
respaldo. La base de desarrollo pesa **10 GB** —bench, datos de ejemplo y varias pasadas de
importación— y su volcado comprimido son **757 MB**.

## Causa raíz

`volcar()` recogía el volcado **en memoria**, por `stdout`, con `maxBuffer: 512 MiB`.

Cuando la salida pasa de `maxBuffer`, `spawnSync` **mata al hijo y devuelve un estado distinto de
cero con `stderr` vacío**: el proceso no llegó a escribir ningún error porque no hubo ningún error
suyo. El script informaba de lo único que tenía —nada— y el operador se quedaba mirando un fallo sin
causa.

Tres cosas se juntaron para que no se viera antes:

1. **El tope era generoso** (512 MiB) y en desarrollo la base era pequeña.
2. **El fallo es silencioso por construcción**: si `spawnSync` dijera «superado el buffer», habrían
   bastado diez segundos.
3. **Es exactamente el día en que el respaldo importa**: cuanto más datos tiene el cliente, más
   probable es que el respaldo no se haga… y menos se puede permitir perderlos.

`pg_restore` tenía el mismo defecto por el otro lado: el volcado entraba como `Buffer` por `stdin`,
así que restaurar un respaldo grande exigía tenerlo entero en la memoria de Node.

## Solución

Los bytes no pasan por Node: **descriptores de archivo en las dos direcciones**.

- `volcar({ conexion, destino })` escribe con `stdio: ['ignore', fd, 'pipe']` directamente al archivo
  y devuelve su tamaño. Sin tope, y `stderr` sigue siendo un tubo para que el mensaje de pg_dump
  llegue cuando lo haya.
- `conPgRestore` lee el volcado con `stdio: [fd, 'pipe', 'pipe']`.
- Como el archivo ahora se crea **antes** de verificarlo, el respaldo se **borra** si la verificación
  falla: la promesa del runbook —«un respaldo que no cuadra no se queda»— se conserva.

## Prevención

- [x] **El camino ya no tiene tope**: no hay número que ajustar ni que se quede corto.
- [x] **`npm run respaldo` corre sobre la base de desarrollo de 10 GB** y termina: es la prueba
  empírica, y es la que faltaba. La suite no puede hacerla (no hay una base grande en CI).
- [ ] **Lo que no se automatiza**: un respaldo de tamaño realista en CI. Queda dicho en el runbook,
  junto a los tres modos de fallo que ya documenta.

## Y una segunda víctima del mismo tamaño

`audit:secrets` **también murió** por el volcado, con otro mensaje igual de opaco:
`ERR_STRING_TOO_LONG`. Secretlint escaneaba `.respaldos/**` —un binario de 722 MiB que ningún secreto
en claro va a tener— y no puede cargarlo como cadena. `.secretlintignore` los excluye desde P16-G,
con el motivo escrito: **un check que falla por el tamaño de un archivo que no mira nadie enseña a
ignorar su salida**, que es como se pierde un check de verdad.

## Referencias

- `scripts/lib/pgdump.mjs` → `volcar`, `conPgRestore` · INC-019 (el otro fallo del respaldo, que
  volcaba la base equivocada) · `docs/runbooks/respaldos-y-restauracion.md`.
