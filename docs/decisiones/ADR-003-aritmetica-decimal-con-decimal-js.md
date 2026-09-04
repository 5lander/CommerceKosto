# ADR-003: Aritmética decimal con `decimal.js`, y su excepción a la regla de capa

| Campo | Valor |
|---|---|
| Estado | ✅ aceptado |
| Fecha | 2026-08-27 |
| Paquete | P0 |
| Decisores | Usuario / Claude Code |

## Contexto

`CLAUDE.md` §3 prohíbe el punto flotante para dinero y cantidades, y §2 prohíbe **librerías de terceros en la capa `domain`**. Las dos reglas juntas dejan sin resolver de dónde sale la aritmética exacta que el motor de costeo necesita: es dominio puro, y el dominio no puede importar nada.

La exigencia de fondo es R7: `ROUND(costo_ventas_teorico − costo_ventas_segun_costeo, 2)` debe dar **exactamente 0**. Con `number`, `0.1 + 0.2 !== 0.3`, y esa diferencia se acumula sobre 1.500 líneas de receta.

## Opciones consideradas

| Opción | A favor | En contra |
|---|---|---|
| **`number` con redondeo cuidadoso** | Cero dependencias | No es una opción: el error es inherente al binario, no al redondeo |
| **`BigInt` en centésimas o milésimas** | Nativo, exacto, sin dependencia | La escala hay que llevarla a mano en cada operación, y una división mal escalada pasa desapercibida. `costo_neto_uso` necesita 12 decimales y `BigInt` no lo dice en el tipo |
| **`decimal.js` acotado a una carpeta** | Exacto, con escala explícita, y con un modo de redondeo que reproduce el `ROUND()` de Excel | Es una dependencia de terceros dentro de `domain` |

## Decisión

**`decimal.js`, importable ÚNICAMENTE desde `apps/api/src/shared/domain/decimal/`.** El resto del proyecto no lo ve: solo ve `Money`, `Ratio`, `Count` y `Quantity`.

La excepción está acotada por dos verificaciones automáticas, no por disciplina:

- `dependency-cruiser` → regla `domain-sin-node-modules`, cuya única `pathNot` es esa carpeta.
- `audit:forbidden` → regla `decimaljs-solo-en-shared-domain-decimal`.

## Las tres trampas de `decimal.js`, y cómo se neutralizan

Ninguna es teórica; las tres rompen R7 en silencio.

**1. La configuración es global y mutable.** `Decimal.set({ precision, rounding })` afecta a todo el proceso, y cualquier dependencia transitiva puede llamarlo.
→ Se usa **`Decimal.clone({...})`** una sola vez, en `nucleo.ts`, produciendo un constructor propio inmune a la configuración global. Hay una prueba que ejecuta un `set` global y verifica que nuestros resultados no se mueven.

**2. Trabaja en dígitos significativos, no en decimales.** `precision: 60` no significa 60 decimales.
→ **Toda división pasa por `dividir({ dividendo, divisor, escala, contexto })`, con la escala OBLIGATORIA en la firma.** Es la única operación del módulo que redondea. Suma, resta y multiplicación son exactas y nunca redondean.

**3. `ROUND_HALF_UP` no significa lo mismo en todas las librerías.** En `decimal.js` es *half away from zero*, que **sí** es el `ROUND()` de Excel, y **no** es *banker's rounding*.
→ Verificado por una batería de pruebas que discrimina los dos comportamientos (`0.125 → 0.13`, `2.5 → 3`, `−2.5 → −3`), no por un comentario.

## Lo que sostiene la prohibición del `number`

La regla no se cumple por buena voluntad:

| Defensa | Qué cierra |
|---|---|
| Marca nominal + campo privado `#valor` | `money + 1`, `money * 2`, `Math.max(a, b)` no compilan |
| Ningún constructor acepta `number` (salvo `Count.fromInteger`, que valida `Number.isSafeInteger`) | `0.1` nunca entra como binario |
| `valueOf()` lanza | Cierra lo que el compilador no ve: un `any` colado desde `JSON.parse`, un helper genérico |
| `audit:forbidden` → `no-decimal-literal-en-dominio` | Un literal con punto decimal dentro de `domain/` |
| `audit:forbidden` → `no-coercion-numerica-en-dominio` | `parseFloat`, `Number(...)`, `.toNumber()` |
| `audit:forbidden` → `no-as-unknown-as` | La única llave que abriría todo lo anterior |

**Hueco conocido y documentado:** TypeScript permite los operadores relacionales entre dos operandos del mismo tipo, así que `precioA > precioB` **compila**. En ejecución lanza, porque `valueOf()` lanza, y hay una prueba que lo fija.

La respuesta preventiva a ese hueco es que la API de comparación está **completa** — `compare`, `equals`, `lessThan`, `greaterThan`, `lessThanOrEqual`, `greaterThanOrEqual`, `isZero`, `isNegative`, `isPositive` — en los cuatro tipos. La vía legal existe y es más cómoda que la ilegal: **una regla que bloquea la única salida disponible termina relajándose por presión.**

Esa API completa por cuadruplicado es lo que hizo aparecer la clase base `ValorDecimal` (ver INC-007): la cuarta repetición del mismo bloque, que es una más del umbral que `OPTIMIZACION.md` §1 fija para extraer. La marca nominal **no** se hereda —cada subclase declara la suya—, así que compartir comportamiento no volvió compatibles a `Money` y `Ratio`.

## `@ts-expect-error` y los contratos de tipo

Las defensas de compilación se afirman en archivos `*.type-contract.ts`, que **no se ejecutan**: cada `@ts-expect-error` asegura que la línea de debajo **no compila**. Si algún día compilara, `tsc` falla por directiva no usada — es autoverificable.

Por eso `audit:forbidden` permite `@ts-expect-error` **solo** en esos archivos, y `@ts-ignore` en ninguno: el primero afirma algo comprobable, el segundo solo silencia.

## Consecuencias

- Se gana: exactitud demostrable, escala explícita en la firma de toda división, y un único punto donde se redondea.
- Se sacrifica: una dependencia dentro de `domain`, contra la letra de §2. La excepción está acotada a una carpeta y verificada por dos herramientas.
- **Qué lo revertiría:** que el `Decimal` de la propuesta TC39 llegue a Stage 4 y esté disponible en el Node LTS del momento. Entonces la dependencia sobra y la excepción se retira.
