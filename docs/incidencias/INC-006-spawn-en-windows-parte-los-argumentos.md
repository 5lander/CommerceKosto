# INC-006 — `psql` recibe el SQL partido en trozos: "syntax error at end of input / LINE 1: DROP"

| Campo | Valor |
|---|---|
| **Fecha** | 2026-08-27 |
| **Paquete** | P0 |
| **Área** | build · base de datos |
| **Tiempo perdido** | ~35 min |
| **Recurrencias** | 2 |

## Síntoma

Un script de Node ejecuta `psql -c "DROP DATABASE IF EXISTS x WITH (FORCE);"` y PostgreSQL responde como si le hubieran mandado solo la primera palabra:

```
psql: warning: extra command-line argument "DATABASE" ignored
psql: warning: extra command-line argument "IF" ignored
psql: warning: extra command-line argument "EXISTS" ignored
psql: warning: extra command-line argument "costeo_verif_ida" ignored
psql: warning: extra command-line argument "WITH" ignored
psql: warning: extra command-line argument "(FORCE);" ignored
ERROR:  syntax error at end of input
LINE 1: DROP
            ^
```

El mismo comando copiado a mano en la terminal funciona.

Y una segunda cara, en otro momento del mismo día:

```
Error: migrate deploy fallo sobre costeo_verif_ida:
```

—sin más texto. El proceso hijo ni siquiera había arrancado.

## Contexto

Scripts de `scripts/` y `tools/` que lanzan procesos hijo: `psql`, `docker compose exec`, el CLI de Prisma, `depcruise`, Vitest. Todos escritos con el patrón habitual en proyectos que tienen que funcionar en Windows:

```js
spawnSync(comando, args, { shell: process.platform === 'win32' });
```

## Causa raíz

Son **dos** problemas encadenados, y ahí está la trampa: al arreglar el primero aparece el segundo, que se parece muy poco.

**1. `shell: true` en Windows no pasa argumentos: los concatena.**
Node construye una única línea de comandos uniendo los elementos del array **sin entrecomillarlos**. Un argumento con espacios —una consulta SQL, una ruta con espacios— se parte en varios en cuanto `cmd.exe` lo vuelve a trocear. Node avisa de esto con `DEP0190`, pero el aviso aparece mezclado con la salida normal y es fácil de pasar por alto.

**2. La razón por la que se llegó a `shell: true` no se puede arreglar con `.cmd`.**
Se usa el shell porque en Windows `npx` y `npm` son `npx.cmd` y `npm.cmd`, y sin shell dan `ENOENT`. La reacción natural es apuntar directamente al `.cmd`… y eso da **`EINVAL`**: desde la mitigación de **CVE-2024-27980**, Node se niega a ejecutar `.cmd` y `.bat` sin shell, porque el intérprete de `cmd.exe` permite inyección de comandos a través de los argumentos.

Es decir: **no existe forma segura de ejecutar un envoltorio `.cmd` sin shell.** El callejón no tiene salida por ese lado.

## Solución

**Dejar de ejecutar el envoltorio.** Todo CLI de npm es, por debajo, un archivo JavaScript declarado en el campo `bin` de su `package.json`. Se resuelve ese archivo y se lanza con `node`, que sí es un ejecutable real:

```js
// scripts/lib/proceso.mjs
export function correrCli(paquete, args, opciones) {
  return spawnSync(process.execPath, [binarioDe(paquete), ...args], { ...opciones, shell: false });
}
```

Con eso: sin shell, sin problemas de comillas, sin depender de la plataforma, y sin el aviso `DEP0190`.

Dos detalles que hicieron falta:

- **`docker`, `git` y `psql` sí son ejecutables reales** (`.exe`) y funcionan con `shell: false` directamente. Solo los envoltorios de npm necesitan el rodeo.
- **`require.resolve('<paquete>/package.json')` falla** con `ERR_PACKAGE_PATH_NOT_EXPORTED` en los paquetes que declaran `exports` sin incluir `./package.json` — `dependency-cruiser` es uno. `binarioDe` prueba tres vías en cascada y la última mira directamente en `node_modules/`.

## Qué NO era

- **No era una comilla mal puesta en el SQL.** El SQL era correcto; llegaba troceado.
- **No era un problema de codificación ni de acentos**, que fue la primera hipótesis por tratarse de Windows.
- **No era que `psql` no estuviera disponible** (eso es INC-002, y ya estaba resuelto): el binario se ejecutaba, solo que con los argumentos mal.
- **No se arregla entrecomillando a mano los argumentos** antes de pasarlos. Es lo que parece la solución obvia y es exactamente lo que la mitigación de CVE-2024-27980 existe para impedir: entrecomillar para `cmd.exe` de forma segura no es un problema resoluble en el caso general.
- **El segundo síntoma (`stderr` vacío) no era un fallo de Prisma.** Era `EINVAL` del `spawn`, que no escribe nada en `stderr` porque el proceso nunca llegó a existir. Un mensaje de error vacío casi siempre significa "el hijo no arrancó", no "el hijo falló".

## Prevención

- [x] ¿Se puede convertir en una verificación de `npm run audit`? **Sí.** `audit:forbidden` incluye la regla `no-shell-en-spawn`: falla ante `shell: true` o `shell: process.platform === 'win32'` en cualquier `.mjs` de `tools/` o `scripts/`. La vía correcta es `correr` / `correrCli` de `scripts/lib/proceso.mjs`.
- [x] ¿Se puede convertir en una prueba automatizada? **Indirectamente, y ya está:** `migrate:verify` y `audit:tests` ejercitan los dos caminos (`docker` y CLI de npm) en cada corrida. Si alguien reintroduce el shell, el SQL con espacios vuelve a partirse y la escalera falla.
- [ ] ¿Es una regla que debería estar en `CLAUDE.md`? No: es un detalle de plataforma, no de diseño.
- [ ] ¿Es una decisión que merece un ADR? Queda documentada en el encabezado de `scripts/lib/proceso.mjs`, que es donde alguien la va a leer.

## Recurrencia 2 — 2026-09-04, P1

`tools/audit/dependencies.mjs` llamaba a `correr('npm', ['audit', '--json'])` y la salida llegaba **vacia**, con el mensaje generico «`npm audit` no devolvio nada. ¿Hay red?». Misma causa: `npm` es `npm.cmd`.

La solucion de la ficha —resolver el JavaScript y lanzarlo con `node`— no aplicaba tal cual, porque `npm` no es un paquete de `node_modules` y `binarioDe` no lo encuentra. La via para npm es **`process.env.npm_execpath`**, que el propio npm rellena al ejecutar un script y apunta a su `npm-cli.js`:

```js
const NPM = process.env['npm_execpath'];
correr(process.execPath, [NPM, 'audit', '--json'], { ... });
```

**Que enseña la recurrencia:** la regla `no-shell-en-spawn` cubria el error de la primera vez (`shell: true`) pero no este, porque aqui no habia shell — habia un `.cmd` invocado por nombre. La prevencion completa seria una regla que prohiba lanzar `npm`, `npx`, `prisma` o cualquier envoltorio por nombre; queda anotado y entra si aparece una tercera.

## Referencias

- Node.js `DEP0190` — *Passing args to a child process with shell option true*
- CVE-2024-27980 — inyección de comandos en Windows a través de argumentos de `.bat` / `.cmd`
- Consultado el 2026-08-27
