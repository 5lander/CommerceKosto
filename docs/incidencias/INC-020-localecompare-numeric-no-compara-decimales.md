# INC-020 — `localeCompare` con `numeric: true` no compara decimales, y pintaba el semáforo al revés

| Campo | Valor |
|---|---|
| **Fecha** | 2026-09-08 |
| **Paquete** | P14b (ensayo de despliegue) · el fallo entró en la Fase C |
| **Área** | frontend · aritmética decimal |
| **Tiempo perdido** | ~20 min |
| **Recurrencias** | 0 |

> **Es el fallo más caro que ha tenido este proyecto**, medido por lo que
> costaría al cliente: enseñaba un food cost del **40 % en verde**. El producto
> de este sistema es la exactitud del número, y este mentía en la dirección que
> nadie va a mirar dos veces.

## Síntoma

Una captura de la pantalla de costeo con datos reales, servida por la pila de
producción:

- `16,7 %` de food cost, pintado en **Oxblood** —el color de la pérdida— y con
  la señal de atención al costado.
- `26,1 %`, igual.

Los dos están por debajo del umbral verde de 28 %. Los dos deberían ir en Jade.

## La causa

```ts
function menorOIgual(izquierda: string, derecha: string): boolean {
  return izquierda.localeCompare(derecha, undefined, { numeric: true }) <= 0;
}
```

**`Intl.Collator` con `numeric: true` no compara números: compara tramos de
dígitos.** `"0.1673"` se parte en `0`, `.`, `1673`; `"0.28"` en `0`, `.`, `28`.
Empatan el `0` y el punto, y entonces compara **1673 contra 28**.

Medido, falla en las dos direcciones:

| Comparación | Decía | Es |
|---|---|---|
| `0.1673 <= 0.28` | `false` | `true` |
| `0.2612 <= 0.32` | `false` | `true` |
| **`0.4 <= 0.32`** | **`true`** | **`false`** |
| `0.05 <= 0.28` | `true` | `true` |

La última fila es la que explica por qué sobrevivió: **con un decimal de la
misma longitud a los dos lados, acierta.** Cualquier prueba escrita con
`0.30` contra `0.28` habría pasado.

Y la tercera es la peligrosa. Un plato con 40 % de food cost —muy por encima del
máximo— salía **en verde**, y un dueño que ve verde no vuelve a mirar.

## Por qué no lo vio nadie

1. **La línea parecía correcta.** Llevaba `numeric: true`, que suena a
   «compáralo como número», y un comentario diciendo que evitaba el punto
   flotante. Lo evitaba. Lo que hacía en su lugar estaba mal.
2. **`apps/web` no tiene ni una prueba.** Es una decisión consciente —allí no
   vive lógica de negocio—, y este fallo es exactamente lo que esa decisión deja
   fuera: no es lógica de negocio, es **una comparación que decide un color**.
3. **Ninguna revisión de código lo iba a encontrar**, porque para verlo hay que
   ejecutar la comparación, no leerla.

**Lo encontró mirar una captura de pantalla con datos reales.**

## El arreglo

Comparar alineando: parte entera por la izquierda, parte decimal por la derecha,
las dos rellenadas a la misma longitud. Con la misma longitud, el orden
alfabético de los dígitos **es** el orden numérico.

```ts
export function menorOIgual(izquierda: string, derecha: string): boolean {
  const [enteraI = '0', decimalI = ''] = izquierda.split('.');
  const [enteraD = '0', decimalD = ''] = derecha.split('.');

  const largoEntero = Math.max(enteraI.length, enteraD.length);
  const largoDecimal = Math.max(decimalI.length, decimalD.length);

  const i = enteraI.padStart(largoEntero, '0') + decimalI.padEnd(largoDecimal, '0');
  const d = enteraD.padStart(largoEntero, '0') + decimalD.padEnd(largoDecimal, '0');

  return i <= d;
}
```

Vive en `apps/web/src/lib/decimales.ts` con el resto de las reglas de cómo se
enseña un número. Comprobado contra 15 casos, incluidos los de borde:
`0.280000000000 <= 0.28` (escala de almacenamiento contra umbral), `0.2800000001
<= 0.28`, y `10.5 <= 9.9` (partes enteras de distinta longitud).

## Prevención

**Automatizada, en el mismo paquete.** Regla de `audit:forbidden`:

> `no-comparar-decimales-con-localecompare` — `localeCompare` con
> `numeric: true` en cualquier `apps/*/src/**`

`localeCompare` **sin** `numeric` sigue permitido: ordenar nombres
alfabéticamente está bien, y es el único uso legítimo que hay en el repositorio.

Guardián forzado: reponiendo la línea original, el check pasa a
`FALLO — 1 infraccion(es)` señalando archivo y línea.

## La lección

**Una API del navegador que suena a lo que quieres no hace lo que quieres.**
`numeric: true` está pensado para ordenar `archivo2` antes que `archivo10`, no
para comparar magnitudes decimales. La documentación lo llama *numeric
collation*, y colación no es comparación.

Y la de fondo, que ya estaba escrita en `ESTADO.md` y aquí se cumple otra vez:
**un caso de prueba tiene que ser el que distingue.** Con `0.05` contra `0.28`
esta función acierta. El caso que la delata es el que tiene distinto número de
decimales a cada lado, y ese es justo el que no se escribe solo.
