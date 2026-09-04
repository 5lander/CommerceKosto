# INC-008 — La validación que impide arrancar con el rol equivocado no se ejecuta si otra variable ya era inválida

| Campo | Valor |
|---|---|
| **Fecha** | 2026-08-27 |
| **Paquete** | P0 |
| **Área** | arquitectura |
| **Tiempo perdido** | ~25 min |
| **Recurrencias** | 1 |

> **Esto no es un check que no medía (eso es [INC-007](INC-007-un-check-pasa-en-verde-sin-medir-nada.md)).** Es peor de otra manera: una regla de seguridad que funcionaba en el caso normal y **fallaba abierto** justo cuando había otro error de configuración — que es precisamente el momento en que alguien está tocando el `.env` a ciegas.

## Síntoma

El esquema de entorno rechaza correctamente un `DATABASE_URL` con el rol de migraciones:

```
Configuracion de entorno invalida:
  - DATABASE_URL: el usuario es "costeo_migrator" y tiene que ser "costeo_app". ...
```

Pero con **una segunda variable también inválida**, esa línea desaparece del informe:

```
Configuracion de entorno invalida:
  - PORT: Too small: expected number to be >=1
  - LOG_LEVEL: Invalid option: expected one of "trace"|"debug"|"info"|...
```

`DATABASE_URL` sigue apuntando a `costeo_migrator` y el informe no lo menciona. Se arregla el puerto, se reinicia, y aparece un fallo que ya estaba ahí desde el principio.

Lo encontró esta prueba, que no existía para esto sino para que la configuración no se arreglara de una en una:

```
AssertionError: expected 2 to be greater than or equal to 3
 ❯ src/shared/infrastructure/config/environment.spec.ts:78:32
```

## Contexto

`apps/api/src/shared/infrastructure/config/environment.ts`, paso 16 de P0. La comprobación de que el usuario de `DATABASE_URL` es exactamente `costeo_app` estaba escrita en el `.superRefine()` **del objeto**, junto a la regla de que `MIGRATION_DATABASE_URL` no puede existir en producción — porque las dos parecían «reglas que miran varios campos a la vez».

## Causa raíz

**En Zod, el `superRefine` de un objeto solo se ejecuta si TODOS sus campos han pasado su propia validación.** Es coherente: el refinamiento recibe el valor ya parseado y tipado, y si un campo falló no hay valor que pasarle. Pero la consecuencia práctica es que **cualquier error de formato en cualquier variable desactiva todas las comprobaciones de objeto**, incluidas las que son controles de seguridad.

Y la comprobación del rol nunca necesitó ser de objeto: mira **un solo campo**. Estaba ahí por parecido temático con la regla de producción —que sí es de objeto, porque depende de `NODE_ENV`— y no por necesidad técnica.

El fallo es abierto, no cerrado: la aplicación no llega a arrancar de todos modos, así que no hubo fuga. Lo que se pierde es el **aviso**, y se pierde exactamente cuando más falta hace.

## Solución

Mover la comprobación al `superRefine` **del campo**, donde se evalúa siempre:

```diff
- const cadenaDeConexion = z.string().min(1).refine(esUrlValida, { ... });
+ const cadenaDeConexionDeLaAplicacion = z
+   .string()
+   .min(1)
+   .superRefine((valor, ctx) => {
+     const usuario = usuarioDeLaConexion(valor);
+     if (usuario === null) { ctx.addIssue({ code: 'custom', message: 'no es una URL...' }); return; }
+     if (usuario !== ROL_DE_APLICACION) { ctx.addIssue({ code: 'custom', message: '...' }); }
+   });

  const esquema = z.object({ ... }).superRefine((valores, ctx) => {
-   // comprobacion del rol de DATABASE_URL
    if (valores.NODE_ENV !== 'production') return;
    // MIGRATION_DATABASE_URL / SHADOW_DATABASE_URL: esta SI es de objeto
  });
```

La regla de producción se queda en el objeto porque de verdad cruza dos campos. Si `NODE_ENV` es inválido, tampoco corre — pero entonces `NODE_ENV` no vale `production` y la regla no aplicaría igual.

## Qué NO era

- **No era un fallo de Zod.** El comportamiento es el correcto y está documentado. Lo que estaba mal era dónde se puso la regla.
- **No se arregla con `.catch()` ni con valores por defecto** en los campos que fallaban: eso convertiría un error de configuración en un arranque silencioso con valores inventados, que es peor.
- **No bastaba con probar el caso aislado.** La prueba de «rechaza el rol de migraciones» pasaba en verde: solo falla cuando hay **dos** errores a la vez. Una validación de seguridad probada únicamente en aislamiento no está probada.

## Prevención

- [x] ¿Se puede convertir en una prueba automatizada? **Sí, y es la que lo encontró:** `environment.spec.ts` exige que un entorno con tres variables mal listadas produzca **al menos tres problemas**. Cualquier regla que se caiga del informe rompe esa prueba. Se replica en todo esquema de validación futuro.
- [ ] ¿Se puede convertir en una verificación de `npm run audit`? No de forma general: `audit:forbidden` no puede distinguir un `superRefine` legítimo de objeto de uno que debería ser de campo. Lo cubre la prueba.
- [x] ¿Es una regla que debería estar en `CLAUDE.md`? **Sí, y va con §3** («validación por esquema en todo límite externo»), como matiz de cómo escribirla.
- [ ] ¿Es una decisión que merece un ADR? No: es una regla de escritura, no una elección entre alternativas.

### La regla que se lleva esta ficha

> **Toda validación que sea un control de seguridad va en el campo, nunca en el refinamiento del objeto.** El refinamiento de objeto se reserva para reglas que de verdad cruzan varios campos, y se asume que puede no ejecutarse.
>
> **Corolario para las pruebas:** una validación de seguridad se prueba también **acompañada de otro error**, no solo en aislamiento. El caso de un único fallo es el que siempre pasa.

Aplica a todo lo que viene: los DTO de entrada de P1 en adelante, el esquema de las filas importadas de P10 y cualquier otro límite externo. La forma de la trampa es la misma: la regla barata de formato hace sombra a la regla cara de autorización.

## Referencias

- `apps/api/src/shared/infrastructure/config/environment.ts` — el comentario en el propio esquema explica por qué la regla está donde está
- CLAUDE.md §3 (validación por esquema) y §4.1 (por qué el rol importa)
- Zod — semántica de `superRefine` sobre objetos. Consultado el 2026-08-27
