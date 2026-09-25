# Runbook — la sesión con el cliente

> Qué se le enseña, en qué orden, y qué hay que tener comprobado **antes** de
> abrir el portátil.

---

## D.2 — La comprobación previa, la noche anterior

Esto se hace **antes**, no delante. Si algo de aquí falla, la sesión se mueve.

### Sus datos, cargados y contados

```sh
# En el VPS
cd /opt/costeo
docker compose exec -T db psql -U postgres -d costeo -c "
SELECT 'items'    t, count(*) FROM item          WHERE company_id = '<uuid>'
UNION ALL SELECT 'articulos', count(*) FROM purchase_article WHERE company_id = '<uuid>'
UNION ALL SELECT 'precios',   count(*) FROM reference_price  WHERE company_id = '<uuid>' AND status = 'CONFIRMED'
UNION ALL SELECT 'productos', count(*) FROM product         WHERE company_id = '<uuid>'
UNION ALL SELECT 'recetas',   count(*) FROM recipe_line     WHERE company_id = '<uuid>'
UNION ALL SELECT 'combos',    count(*) FROM combo_component WHERE company_id = '<uuid>';"
```

**Los precios tienen que estar en `CONFIRMED`.** Si están en `SUGGESTED`, el
costeo devuelve cero y la pantalla sale vacía. Es lo que hace la bandera
`--confirmar-precios`.

### Que puede entrar

Con **su** usuario y **su** contraseña, no con la tuya. Un login que falla
delante del cliente cuesta más que media hora de preparación.

### Que los números cuadran, uno a uno

Coge **tres platos** —el más vendido, el más caro y uno con receta larga— y
compara el costo de la pantalla con el de su hoja. Si alguno no cuadra, **no lo
dejes para la sesión**: averigua por qué antes.

### Un respaldo, hecho hoy

```sh
bash scripts/vps/respaldo-diario.sh
```

Si el cliente toca algo que no debía, se vuelve atrás. Sin eso, no.

---

## Las tres diferencias conocidas — dilas TÚ antes de que él las vea

Es la parte que decide la reunión. Un número que no cuadra y sale por sorpresa
destruye la confianza en el sistema entero; el mismo número explicado por
adelantado la construye.

### 1. Los céntimos frente a su Excel

**Qué va a ver:** un costo de `2,77` donde su hoja dice `2,78`. Nunca más.

**Por qué:** Excel calcula en coma flotante de 64 bits y redondea al final; este
sistema usa aritmética decimal exacta y redondea a dos decimales **una sola
vez**, al mostrar. En una cadena de seis multiplicaciones y dos divisiones, Excel
acumula el error de cada paso.

**Cómo se dice:** «Su hoja y el sistema difieren en un céntimo en algunos platos.
El del sistema es el correcto: Excel arrastra el redondeo de cada paso y nosotros
redondeamos solo al final. En un plato no se nota; en el costo de un mes, sí.»

**No lo minimices y no lo escondas.** Es un punto a favor, no una disculpa.

### 2. Los ítems sin contar valen su teórico, no cero

**Qué va a ver:** un inventario valorizado más alto de lo que esperaba tras un
conteo parcial.

**Por qué (D7, ADR-010 §5):** un ítem que nadie contó vale lo que el libro dice
que hay. Valorarlo en cero equivale a declarar que se consumió entero, y eso
dispararía el consumo real del mes por una omisión de captura, no por un consumo
real.

**Cómo se dice:** «Si no contó el jamón, el sistema no asume que se acabó: asume
que sigue ahí lo que dice el libro. Por eso la pantalla le dice qué porcentaje
del valor del inventario contó de verdad — para que sepa cuánto se puede fiar del
número.»

### 3. El margen de referencia del menú

**Qué va a ver:** un «margen de referencia» distinto al promedio de su hoja.

**Por qué (ADR-015):** su Excel usa `AVERAGE`, que es la media simple de los
platos. Aquí es el **promedio ponderado por unidades vendidas**, que es el
Kasavana-Smith canónico y lo que dice SPEC §15.

**Cómo se dice:** «Su hoja promedia los platos; nosotros promediamos las ventas.
Con la media simple, un plato caro que vende uno al mes empuja el promedio hacia
arriba y convierte en "perros" a los que sostienen el negocio. La pantalla le
enseña las dos cifras de la división para que pueda rehacerla.»

**Y la trampa que hay que adelantar:** si divide el margen total entre las
unidades **totales** no le va a dar, porque un producto sin PVP no entra en
ninguno de los dos lados. La pantalla enseña los dos números por separado justo
por eso.

---

## D.1 — El guion, en este orden

**El orden importa: se empieza por lo que ya sabe y se termina por lo que no.**

### 1. Entrar y elegir sucursal · 2 minutos

Que entre **él**, con su usuario. Que vea su sucursal con su nombre.

> «Esto es suyo. Sus platos, sus precios, su sucursal.»

### 2. Costeo por producto · 10 minutos — es la pantalla que convence

Abre el plato que él conoce mejor. Recorre la fila **de izquierda a derecha**:
costo bruto, costo neto, costo total, venta neta, margen, food cost.

> «El costo bruto es lo que paga por el producto. El neto ya descuenta lo que se
> pierde al limpiarlo. El total añade el empaque.»

**Aquí es donde dices lo de los céntimos**, con un plato delante y no en
abstracto.

Y explica el food cost sobre venta neta: «El PVP incluye IVA. El food cost se
mide sobre lo que de verdad entra, no sobre lo que cobra.»

### 3. Ingeniería de menú · 8 minutos — es la que sorprende

Empieza por los **caballos**: platos que vende mucho y dejan poco.

> «Estos dos los vende muchísimo y casi no le dejan nada. No hay que sacarlos de
> la carta: hay que subirles el precio o bajarles el costo.»

Es la pantalla que hace que el sistema deje de parecer una hoja de cálculo cara.
**Aquí dices lo del margen de referencia.**

### 4. Carga de ventas · 5 minutos — es la que decide si sigue el mes dos

Que la use **él**, no tú. Que teclee tres o cuatro números y vea que Enter baja
de fila.

> «Esto es todo lo que hay que hacer una vez al mes. Diez minutos y las tres
> pantallas anteriores se actualizan solas.»

**Si algo va a hacer que abandone el sistema, es esta pantalla.** Si le resulta
pesada aquí, sentado y tranquilo, en un mes no la abre.

### 5. Inventario y conteo · 5 minutos, y solo si queda tiempo

Enseña la hoja **en el teléfono**, no en el portátil: es donde se va a usar, de
pie y en la bodega.

> «Esta hoja no le dice cuánto debería haber, a propósito. Si se lo dijera, nadie
> contaría: apuntaría lo que pone.»

**Aquí dices lo de los ítems sin contar.**

### 6. Qué le hace falta a él · 10 minutos

Cállate y apunta. Esta parte vale más que las cinco anteriores.

---

## Lo que NO se enseña

- **La importación.** Es un comando y la usas tú. Enseñarla abre la conversación
  de «¿y puedo cargar yo mis productos?», que hoy la respuesta es no.
- **Nada que no esté terminado.** Ni una pantalla a medias, ni un «esto va a
  estar». Un cliente recuerda lo que le prometiste, no lo que le enseñaste.
- **Los internos.** Sin hablar de RLS, de transacciones ni de la arquitectura. Le
  importa que el número sea correcto, y eso se demuestra con el número.

---

## D.3 — Después de la sesión, el mismo día

Cada cosa que dijo entra en una de estas tres cajas, **con su nombre**:

| Caja | Qué es | Dónde va |
|---|---|---|
| **Bloquea el uso diario** | No puede hacer su trabajo sin esto | Se arregla **esta semana**. Ficha en `docs/incidencias/` si fue un fallo |
| **Molesta pero no bloquea** | Lo hace, refunfuñando | Paquete propio, con su prioridad |
| **Es otro producto** | «¿Y podría facturar desde aquí?» | Se anota y se dice que no ahora |

**Lo que se apunta se apunta el mismo día.** Al día siguiente ya es «algo del
inventario, creo».

Y para lo que sea un fallo: **`docs/incidencias/README.md` tiene el criterio**.
Si costó más de veinte minutos entenderlo o el mensaje de error apuntaba al sitio
equivocado, tiene ficha.
