# INC-024 — Un margen negativo se muestra como `100.00`, y un −7,5 % como `-007,5 %`

| Campo | Valor |
|---|---|
| **Fecha** | 2026-09-14 |
| **Paquete** | Existía desde P14 · encontrado preparando P16 · Inicio |
| **Área** | frontend · aritmética decimal |
| **Tiempo perdido** | ~10 min |
| **Recurrencias** | 0 |

> **Ningún mensaje de error: un número plausible y falso.** Es el modo de fallo de INC-020, en el mismo
> archivo y con otra causa.

## Síntoma

```
comoImporte('-9.999')      = 100.00      (esperado -10.00)
comoImporte('-0.001')      = -0.00       (esperado 0.00)
comoPorcentaje('-0.075')   = -007,5 %    (esperado -7,5 %)
comoPorcentaje('-0.0004')  = -000,0 %    (esperado 0,0 %)
```

La pantalla de menú pasa por `comoImporte` el **margen de contribución**, que es negativo en un plato
que pierde dinero: un margen de −9,999 se habría leído como 100.

## Contexto

Diseñando Inicio, que enseña la utilidad operativa y la varianza —las dos pueden ser negativas—, se
probó `lib/decimales.ts` con negativos compilándolo aparte, antes de usarlo.

## Causa raíz

`redondear` y `moverComa` trabajan **sobre los dígitos de la cadena**, y trataban el `-` como uno más.
En `redondear('-9.999', 2)` el acarreo recorre `-999` de derecha a izquierda; `SIGUIENTE['-']` no
existe, así que el `-` se toma por un nueve, se pone a cero y se acarrea: sale `1000` y el signo
desaparece. `moverComa('-0.075', 2)` concatena `-0` y `075` y la expresión que quita los ceros de la
izquierda (`^0+`) no ve los que van después del `-`.

## Solución

`conSigno(valor, transformar)`: aplica la operación al **valor absoluto** y devuelve el signo después,
salvo que el resultado sea cero (`-0.00` no existe). `redondear` y `comoPorcentaje` pasan por ahí.
Medio hacia arriba sobre el absoluto es alejarse del cero, que es lo que hace el `ROUND` de Excel.

## Qué NO era

- **El redondeo medio hacia arriba** → no: `-2.345` ya daba `-2.35`; el fallo solo aparece cuando el
  acarreo llega hasta el signo o cuando hay ceros entre el signo y la primera cifra.

## Prevención

- [x] **¿Prueba automatizada?** Sí, y es la primera de `apps/web`: `lib/decimales.spec.ts` y
  `lib/fechas.spec.ts`, con `node --test` y sin dependencias (ADR-027), corridas por `audit:tests`.
  Guardianes: quitar `conSigno` de `redondear` o de `comoPorcentaje` pone la prueba en rojo, y una
  prueba del web en rojo para `audit:tests` con «FALLO — pruebas de apps/web en rojo».
- [x] **¿Regla de proceso?** INC-023 dejó escrito que el ejecutor se montaba si volvía un fallo del
  cliente que la API no puede ver. Volvió, y se montó en el mismo commit.

## Referencias

- INC-020 (el mismo archivo, un `localeCompare`) · INC-023 · ADR-027.
