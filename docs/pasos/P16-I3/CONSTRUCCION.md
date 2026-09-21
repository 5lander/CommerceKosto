# P16-I3 — R15: la varianza del mes cuadra con el inventario

> **Confirmación del usuario a D-16.202** (2026-09-20): «El AJUSTE es línea propia, no parte de "no
> atribuible". `varianza = merma registrada − ajustes (con signo) + diferencia de conteo = 2,50 −
> 0,50 + 2,00 = 4,00` sobre CC-011. Invariante 🔴 nuevo, numerar en CLAUDE.md §6. Pantalla 25 enseña
> tres líneas. CC-011 se corrige con 4,00 y este desglose.»

**Este paquete no construye la regla: la escribe.** D-16.202 se construye en **P16-J**, justo antes
de la pantalla 25. Lo que entra ahora es lo que tiene que estar escrito **antes** de que alguien
toque el código, que es el orden que CLAUDE.md §8 exige: primero el número esperado, después la
implementación.

## 1 · Por qué el ajuste es línea propia

Un **ajuste** es una corrección que alguien registró, con su nota y su autor. **«Sin explicar»** es
precisamente lo que nadie registró. Meterlos en la misma cifra borraría la única distinción que le
importa a quien mira la varianza: **«se corrigió» frente a «falta»**.

```
varianza = merma registrada − ajustes (con signo) + diferencia de conteo
  4,00   =      2,50        −      0,50           +        2,00
```

El ajuste de CC-011 es `+0,5 kg` —suma stock—, así que **resta** varianza. Por eso entra con signo y
no en valor absoluto.

## 2 · R15, y por qué no es una tolerancia

```
varianza (§16)  =  −mermas_y_ajustes (§18)  −  diferencia_de_conteo (§18)
```

Se comprobó **antes** de escribirla, despejando:

```
§18   stock_teorico = inicial + compras + mermasYAjustes + otros − consumo_teorico
      diferencia    = conteo_fisico − stock_teorico

§16   consumo_real  = inicial + compras + otros − conteo_fisico        (D-16.202)

⇒ consumo_real = inicial + compras + otros
                 − (inicial + compras + mermasYAjustes + otros − consumo_teorico + diferencia)
               = −mermasYAjustes + consumo_teorico − diferencia

⇒ varianza = consumo_real − consumo_teorico = −mermasYAjustes − diferencia
```

**El término `otros` —transferencias y producción— se cancela entero.** Eso es lo que convierte la
comprobación en una identidad: no hay margen donde esconder un error, y si no da cero, una de las
dos vistas del mismo libro está mal.

Sobre CC-011: `−(−2,00) − (−2,00) = 4,00` ✔.

**Dónde queda escrita:** `CLAUDE.md` §6 como **R15** *(desde P16-J)*, y `docs/AUDITORIA.md` sección
E como **E24**, que es de donde sale la checklist de cada commit.

## 3 · CC-011, reescrito

| | Antes (fórmula del Excel) | Ahora (D-16.202) |
|---|---|---|
| `CONSUMO_REAL` | `54.00` | **`26.00`** |
| `VARIANZA_USD` | `32.00` | **`4.00`** |
| Desglose | 20 transferencia + 8 producción + 2,50 merma − 0,50 ajuste + 2 faltante | **2,50 merma − 0,50 ajustes + 2,00 sin explicar** |

Y el caso lleva ahora la identidad de R15 demostrada, no solo comprobada con números.

> **La prueba de hoy sigue anclando los 32,00**, con su comentario diciendo por qué: un caso conocido
> dice lo que el número **debe** valer y la prueba dice lo que **vale**. Mientras las dos cifras no
> coincidan, el hueco entre ellas **es** el trabajo de P16-J, y se ve en verde en vez de esconderse.

## 4 · La tabla de cobertura

Gana CC-010, CC-011 y CC-012 —que P16-I había escrito sin anotarlos ahí— y una fila para **R15**,
marcada ⬜ P16-J. CC-011 queda en 🟡: **escrito con D-16.202, cumplido cuando P16-J entre**.

## 5 · Lo que la pantalla 25 tendrá que enseñar

Tres líneas, no un número: **merma registrada · ajustes · sin explicar**. Está en la decisión y en el
caso conocido, para que la pantalla no tenga que inventarse el desglose cuando llegue.
