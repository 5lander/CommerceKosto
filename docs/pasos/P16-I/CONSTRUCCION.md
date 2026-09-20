# P16-I — Tres casos conocidos para los tres agregados de dinero

> **Decisión del usuario D-16.201**: «`casos-conocidos.md` gana, por cada agregado de dinero del
> modelo (`compras_del_mes`, `consumo_real`, valorización de inventario), un caso con el vocabulario
> completo del libro: COMPRA, corrección, transferencia, producción y merma en el mismo mes, con el
> resultado esperado calculado a mano y contrastado con el Excel donde el Excel lo cubra. Prueba
> unitaria por caso. **Cierra la clase de INC-029, no solo la instancia.**»

## 1 · Cuál era la clase

INC-029 —una compra corregida que seguía contando su importe— no fue un descuido aislado. Fue la
consecuencia de una asimetría que llevaba desde P6:

| | Definiciones | Quién las vigila |
|---|---|---|
| **El saldo** (cantidad) | dos: el `SUM` de PostgreSQL y `proyectarSaldos` | una prueba de integración exige que den el mismo número (criterio de aceptación de P6) |
| **El dinero** | **una**, dentro de una consulta SQL, en infraestructura | **nadie** |

No había un solo sitio donde estuviera escrito **qué vale `compras_del_mes`**. Por eso el fallo
pudo vivir cuatro paquetes sin que nada se pusiera rojo, y por eso arreglarlo no bastaba: la
siguiente consulta que olvidara el signo entraría por la misma grieta.

## 2 · Las tres piezas que la cierran

**1. La definición baja al dominio.** `inventory/domain/agregados.ts`:
`plegarAgregadosDelPeriodo` y `comprasDelMes`, puros, con la base apagada. La regla que INC-029
violaba queda escrita en una función de tres líneas —`importeConSigno`— con su porqué encima.

**2. Los casos, con su número esperado, calculados antes que el pliegue.**
`docs/pruebas/casos-conocidos.md` gana **CC-010, CC-011 y CC-012**, los tres sobre **el mismo mes**:

```
marzo 2026 · Local Centro · Arroz (kg) · costo de uso 1,00
  +100 COMPRA 100.00 · +50 COMPRA 50.00 · −50 CORRECCIÓN 50.00
  −20 TRANSFERENCIA (sin importe) · −8 PRODUCCIÓN 8.00
  −2,5 MERMA · +0,5 AJUSTE · −22 CONSUMO POR VENTA
  conteo de febrero 40 kg · conteo de marzo 86 kg
```

| Caso | Agregado | Esperado |
|---|---|---|
| **CC-010** | `compras_del_mes` y las cantidades de SPEC §18 | `100.00` · compras `100` kg · mermas y ajustes `−2` · otros `−28` |
| **CC-011** | `CONSUMO_REAL` y su varianza (SPEC §16) | `54.00` · teórico `22.00` · varianza `32.00` |
| **CC-012** | El inventario valorizado (SPEC §18) | teórico `88` kg · diferencia `−2` · reorden `7` · cobertura `88` días |

**La varianza de CC-011 se desglosa sin residuo en el vocabulario del libro**, y eso es lo que hace
que el caso valga: `32 = 20 transferencia + 8 producción + 2,50 merma − 0,50 ajuste + 2 faltante`.

**3. El `SUM` y el pliegue, atados.** Una prueba de integración nueva escribe los seis tipos por la
API en una sucursal propia y exige que `agregadosDelPeriodo` y `comprasEntre` —las consultas de
producción— devuelvan **exactamente** lo que devuelve el pliegue del dominio sobre las filas crudas.
Es el criterio que P6 fijó para el saldo, ahora también para el dinero.

## 3 · Qué cubre el Excel, y qué no — dicho con precisión

D-16.201 pide contrastar «donde el Excel lo cubra», y la respuesta honesta tiene dos mitades:

- **Cubre las fórmulas.** SPEC §16 y §18 se verificaron una a una contra el archivo en P8, y esa
  tabla sigue al final de `casos-conocidos.md`. Los tres casos usan esas fórmulas sin tocarlas.
- **No cubre los resultados**, por tres razones que ya estaban escritas en el documento: el Excel
  **no tiene dimensión temporal** (SPEC §3), **no tiene correcciones, transferencias ni producción**
  —son la extensión de P6— y tiene **todas las unidades vendidas en cero**, así que sus vistas de
  período están vacías en el propio archivo. No hay celda que copiar.

Está dicho en cada caso, y no se disfraza: lo contrastable está contrastado, lo demás se calculó a
mano aquí y lleva su fecha.

## 4 · Lo que los casos dejaron a la vista — duda abierta #16

De los 32 dólares de varianza de CC-011, **28 son transferencia y producción**: stock que salió del
local sin haberse consumido en él. La fórmula de SPEC §16 —`inicial + compras − final`— los cuenta
como consumo **porque en el Excel no existen**. A nivel de company se compensan —el local que recibe
muestra consumo negativo—; **por ubicación, no**.

No se arregla aquí: es una decisión de modelo que toca el SPEC, y este paquete no abre frentes
transversales. Queda como **duda abierta #16**, junto a la divergencia de la MC promedio, y con una
prueba que fija el comportamiento actual para que un cambio se vea.

## 5 · Y la regla que se llevó CLAUDE.md §3

«**Código generado desde Python: raw strings o la herramienta de escritura; nunca `str.replace`
sobre literales con barras invertidas**». En una cadena normal de Python `\b` es el carácter de
retroceso, no un límite de palabra: la regex compila, no lanza y no casa nunca. Tres veces en este
proyecto (INC-007, casos 7, 8 y 14), la última hace dos paquetes.

## 6 · Y una prueba inestable que resultó no serlo — INC-014, recurrencia 1

Al correr la auditoría, `la corrección CONSERVA el tipo…` expiró a los 60 s en una corrida y pasó
en la siguiente. «Pasa sola» no cierra un fallo, así que se miró: la base de desarrollo tiene **12
GB y 34,4 millones de movimientos**, y las siete consultas crudas de `inventario.spec.ts` estaban
escritas **sin `company_id`** — y todos los índices del libro empiezan por el tenant.

```
Parallel Seq Scan on inventory_movement     →     Index Scan using (company_id, location_id, item_id, occurred_at)
```

Un barrido de 34 millones de filas por aserción, cuyo tiempo depende de la caché y de qué más corra
en la máquina: de ahí la intermitencia. Las siete llevan ahora el tenant por delante y la suite
bajó de expirar a **43 s**. Queda como recurrencia 1 de INC-014, con la lección que faltaba: **una
prueba que lee la base a pelo también está sujeta a la regla de índices del proyecto**.

> **Lo que no se hizo, y queda dicho:** la base sigue en 12 GB, y `costeo_restaurado` —la auxiliar
> del simulacro de P16-G2— sigue ocupando lo suyo. El runbook dice que la auxiliar se tira al
> terminar, y `npm run db:reset -- --si` recorta la de desarrollo; las dos cosas borran datos de tu
> máquina, así que las decides tú.
