# ADR-029: La transferencia en dos pasos sobre rutas de abastecimiento

> Architecture Decision Record. **Inmutable una vez aceptado**: si la decisión cambia, se escribe un
> ADR nuevo que lo reemplaza.

| Campo | Valor |
|---|---|
| Estado | 🟡 **propuesto** — esperando lectura y aprobación del usuario antes de escribir código |
| Fecha | 2026-09-22 |
| Paquete | **P16-T**, con protocolo completo de `apps/api`; después de P16-E, antes de retomar la pantalla 22 |
| Decisores | Usuario (modelo y alcance) / Claude Code (diseño y consecuencias) |
| Reemplaza en parte a | La transferencia de un paso de **P6**, que se conserva en el libro pero deja de poder escribirse |

---

## Contexto

### Lo que lo destapó

Construyendo la pantalla 20 se comprobó, contra la API y saltándose la interfaz, que

```
POST /inventario/transferencias  como BODEGA  →  403 PERMISO_DENEGADO
                                                 «Esa ubicacion no esta en tu alcance.»
```

`BODEGA` tiene `inventory.transfer` desde P6 y **no puede usarlo nunca**. La transferencia de un
paso exige que **las dos** ubicaciones estén en el alcance de la sesión, y un bodeguero alcanza una
sola. El permiso es letra muerta justo para el rol cuyo trabajo diario es mandar producto al local.

### Las dos salidas obvias, y por qué las dos están mal

| Salida | Por qué se descarta |
|---|---|
| Quitarle `inventory.transfer` a `BODEGA` | Deja el despacho en manos de quien no está en la bodega. El trabajo sigue existiendo; solo se le quita el botón a quien lo hace |
| Abrir el destino a cualquier ubicación de la company | **Quien despacha escribiría en el saldo de otro.** Una diferencia en el camino aparecería como stock que el local nunca vio, y al contarlo saldría como **merma del local**: el local paga una pérdida que no causó, y nadie puede demostrar dónde ocurrió |

La segunda es la peligrosa, porque funciona. El saldo cuadra, el consolidado cuadra, y la conclusión
—«este local tiene mucha merma»— es falsa. Es la forma de fallo que este proyecto lleva registrando
desde P5: *un invariante agregado que se cumple tapando un desglose que no*.

### La restricción real

Una transferencia no es un hecho instantáneo: **es dos hechos separados por un camino**. Modelarla
como uno solo obliga a que alguien tenga poder sobre las dos puntas, y borra el único sitio donde
puede aparecer la diferencia. Lo que el modelo tiene que representar es el camino.

---

## Opciones consideradas

### Dónde vive lo que está en tránsito

| Opción | A favor | En contra |
|---|---|---|
| **(A) Ubicación virtual «tránsito»** — una fila de `location` por company, y dos transferencias normales contra ella | R2 se cumple sola: el tránsito está dentro de la company. Cero reglas nuevas en el consolidado | Una ubicación falsa se cuela **en todo**: el selector de sucursal, `GET /ubicaciones`, el alcance de cada rol, las vistas por ubicación, los conteos físicos. Habría que excluirla a mano en cada sitio, y el día que alguien se olvide, una pantalla ofrece «contar el tránsito» |
| **(B) El tránsito es una PROYECCIÓN del libro** — despachado menos recibido, por transferencia | No hay tabla de saldos ni ubicación inventada. Es literalmente R3: *todo saldo es proyección del libro*. El libro no cambia de forma | R2 hay que **reenunciarla**: entre despacho y recepción, la suma de los saldos por ubicación es menor que el total de la company. El consolidado tiene que enseñar la línea (que es lo que se pidió) |
| (C) Tabla de saldos en tránsito | Consulta directa | Un saldo mutable al lado de un libro append-only. Es exactamente lo que R3 prohíbe, y el día que discrepen no hay forma de saber cuál miente |

**Se elige (B).** (A) parece más barata y su coste está repartido en veinte sitios donde nadie lo va a
buscar; (C) contradice la regla que sostiene todo el módulo.

### Dónde se registra lo que se perdió en el camino

Despachadas 10, recibidas 9. Ese kilo tiene que ir a algún sitio, porque si no la transferencia queda
«en tránsito» para siempre y el total de la company nunca cierra.

| Opción | Por qué |
|---|---|
| En el **origen**, como merma | El origen ya restó los 10 al despachar. Restarle uno más lo descuadra: habría perdido 11 de un stock del que salieron 10 |
| En el **destino**, como merma del local | Es justo lo que este ADR existe para impedir |
| **En el destino, con TIPO PROPIO** | El destino es **donde la diferencia se descubre**, y es el único sitio donde el libro puede cerrarla. El tipo propio —`MERMA_DE_TRASLADO`— la mantiene separada de la merma del local en todas las vistas |

**Se elige la tercera.** La recepción escribe **dos** movimientos en el destino: la entrada por **lo
despachado** y, si llegó menos, la diferencia como `MERMA_DE_TRASLADO`.

```
origen   −10  TRANSFERENCIA_SALIDA     (despacho, fecha de salida)
destino  +10  TRANSFERENCIA_ENTRADA    (recepción, fecha de llegada)
destino   −1  MERMA_DE_TRASLADO        (recepción, fecha de llegada)
```

El saldo del destino sube 9, que es lo que hay en la estantería. El tránsito cierra —despachado 10,
recibido 10— y el total de la company baja 1, que es lo que de verdad se perdió. **Y la pérdida tiene
nombre, sitio y fecha**, que es lo que la opción de «abrir el destino» borraba.

---

## Decisión

**Una transferencia deja de ser una escritura y pasa a ser un ciclo de dos pasos sobre una ruta de
abastecimiento declarada: despacho contra el origen, recepción contra el destino, y lo que no llegó
se registra como merma de traslado.** El producto entre los dos pasos está **en tránsito**, y el
tránsito es una proyección del libro, no una ubicación ni un saldo guardado.

### 1 · Rutas de abastecimiento

```
supply_route(id, company_id, from_location_id, to_location_id, activa, created_at, created_by)
  UNIQUE (company_id, from_location_id, to_location_id)
  CHECK  (from_location_id <> to_location_id)
```

- **Sin ruta activa no hay despacho.** Es lo que impide que cualquiera mande producto a cualquier
  sitio, sin necesidad de ampliar el alcance de nadie.
- Cubre las tres cadenas pedidas: `bodega → local`, `cocina central → local` y `local ↔ local`
  **como dos filas**, una por dirección. Que la ruta sea dirigida no es un detalle: que el local A
  pueda surtir al B no significa que el B pueda surtir al A, y la mayoría de las cadenas reales son
  de un solo sentido.
- Se declara con **`location.update`**, el permiso que ya gobierna cómo son las ubicaciones de la
  company. *(Alternativa descartada: un `supply_route.write` propio. Es la misma decisión —cómo se
  relacionan las ubicaciones de esta company— y un permiso más que nadie sabría a quién dar.)*

### 2 · Despacho — `POST /inventario/despachos`

- Permiso `inventory.transfer` **y alcance sobre el ORIGEN**. Nada sobre el destino.
- Exige ruta activa `(origen → destino)`.
- Escribe **una** fila: `TRANSFERENCIA_SALIDA` negativa en el origen, con la fecha del despacho.
- `inventory_transfer` gana `estado` y los datos del traslado (ver punto 8). Nace `DESPACHADA`.
- **No toca el destino.** Ni su libro, ni su saldo, ni su período.

### 3 · Recepción — `POST /inventario/despachos/:id/recepcion`

- Permiso `inventory.transfer` **y alcance sobre el DESTINO**.
- Se registra **lo que llegó**, con la **fecha de llegada**, no la de salida.
- Escribe en el destino la entrada por lo despachado y, si llegó menos, la diferencia como
  `MERMA_DE_TRASLADO`. La transferencia pasa a `RECIBIDA`.
- **Recibir más de lo despachado se rechaza**, con el motivo escrito: se recibe lo despachado y el
  sobrante se registra como `AJUSTE` del destino, que es una decisión de quien cuenta, no un efecto
  colateral de una recepción.

### 4 · El tránsito y R2

`R2` pasa a enunciarse así, y **es una identidad, no una tolerancia**:

```
total_de_la_company = Σ saldos por ubicación  +  en_tránsito
en_tránsito         = Σ (despachado − recibido) de las transferencias DESPACHADAS
```

El consolidado enseña **`en tránsito`** como línea propia. Sin esa línea, cada transferencia sin
recibir haría que el consolidado de la company enseñara menos inventario del que hay, y nadie sabría
por qué.

### 5 · Cierre de período — la propuesta, con su razón

**El cierre NO se bloquea por despachos sin recibir.** Lo que lo hace posible es que **cada pata
lleva su propia fecha**: el despacho pertenece al mes en que salió, la recepción al mes en que llegó.

- Un despacho del 28 de septiembre recibido el 2 de octubre escribe en septiembre **solo** la salida,
  y en octubre **solo** la entrada. **Ninguna escritura entra nunca en un mes cerrado**, así que
  «cerrado es de solo lectura» (D6) se mantiene sin excepciones.
- El inventario de septiembre del origen no lo incluye —ya salió— y el del destino tampoco —aún no
  llegó—. **El consolidado de septiembre lo enseña en la línea de tránsito**, y por eso el mes
  cuadra. Es la misma línea del punto 4, haciendo aquí su trabajo de verdad.
- Un despacho que no va a llegar nunca se cierra **recibiendo cero**, con la merma de traslado entera
  en la fecha de recepción, que cae en un mes abierto.

**Las dos alternativas, y por qué no:**

| Alternativa | Por qué se descarta |
|---|---|
| Bloquear el cierre del origen mientras tenga despachos sin recibir | Le da a una ubicación **poder sobre la contabilidad de otra**: un local que no recibe deja a la bodega sin poder cerrar el mes, indefinidamente |
| Obligar a decidir en el cierre (recibir, anular o dar por perdido) | Pone la decisión en el momento de más prisa del mes, y encima en manos de quien cierra, que puede no saber si el camión llegó |

**Lo que esta decisión cuesta, dicho en voz alta:** un traslado a caballo entre dos meses deja al
origen con menos inventario final y al destino con menos inventario inicial del que tendrían con el
modelo de un paso. Los números de cada ubicación **cambian**; el de la company, no. Quien mire una
sola sucursal a fin de mes tiene que saberlo, y por eso la línea de tránsito va también en la vista
de la ubicación, no solo en el consolidado.

### 6 · Aviso de despacho sin recibir

Una transferencia `DESPACHADA` con más de **N días** desde la salida sale en un aviso. `N` es
configuración de la company, con valor por defecto **3 días**, y se razona así: por debajo de eso el
aviso sería ruido en cualquier cadena con camión de reparto semanal; por encima, un camión perdido
tarda una semana en notarse. **Es un valor provisional 🟡**: la primera cadena real lo corrige.

### 7 · Confidencialidad — §4.3

La respuesta del despacho **no lleva ni un dato de inventario del destino**: ni saldo, ni stock
teórico, ni diferencia, ni valorización, ni costo. Lleva el **nombre** de la ubicación de destino,
porque sin él no se puede elegir a dónde se manda, y el nombre no está en la lista de §4.3.

🔴 **Prueba obligatoria**: despachar autenticado como `BODEGA` y verificar **sobre la respuesta
cruda** que no aparece ninguno de los campos prohibidos de §4.3.

### 8 · Los datos de la guía de remisión

El despacho **guarda** lo que una guía de remisión necesita. **No la emite**: eso es del futuro
backend de facturación electrónica, y este paquete no toca el SRI.

| Dato | Dónde vive |
|---|---|
| Establecimiento de origen y de destino | **Columna nueva en `location`** (código de establecimiento). Hoy no existe |
| Transportista: nombre, identificación y placa | Columnas nuevas en `inventory_transfer`, anulables |
| Motivo del traslado | Columna nueva; por defecto, traslado entre establecimientos de la misma company |
| Qué y cuánto | Ya está: los movimientos del despacho |
| Fecha de inicio y de fin del traslado | Despacho y recepción, que ya llevan la suya |

> ⚠️ **Esto NO es una afirmación de cumplimiento.** La lista de campos que el SRI exige en una guía
> de remisión **se verifica contra la normativa vigente el día que se emita**, no hoy y no de
> memoria. Lo que este paquete promete es que **el dato existe y se puede recuperar**; que el
> documento sea válido es responsabilidad del paquete que lo emita.

### 9 · Lo que ya está escrito no se toca

Las transferencias de un paso que hay en el tenant de ensayo —y cualquiera que exista— **se quedan
como están** (R3: el libro es append-only). La migración les pone `estado = 'RECIBIDA'`, que es la
verdad: se escribieron con las dos patas a la vez.

**El camino de escritura de un paso desaparece**: `POST /inventario/transferencias` se retira y con
él `RegistrarTransferencia`. Queda **una sola** forma de mover producto entre ubicaciones, porque dos
formas significan que la segunda se salta las reglas de la primera.

---

## Consecuencias

### Lo que se gana

- **`BODEGA` puede hacer su trabajo** sin que nadie le abra el saldo de otra ubicación.
- La diferencia del camino **tiene sitio, nombre y fecha**, y no se disfraza de merma del local.
- El cierre de un mes **nunca** depende de que otra ubicación haga algo.
- El libro no cambia de forma: el tránsito es proyección, como todo saldo (R3).

### Lo que se sacrifica o queda condicionado

- **Dos pasos donde había uno.** Mover producto pasa a costar dos acciones de dos personas. Es el
  precio de que la diferencia sea atribuible, y la razón por la que la pantalla 20 se parte en dos.
- **R2 se reenuncia** y gana un sumando. Toda vista que compare «total de la company» con «suma de
  ubicaciones» tiene que incluir el tránsito, o fallará **exactamente cuando haya un camión en la
  carretera**, que es el caso que nadie prueba.
- **P16-J hereda una línea más.** `MERMA_DE_TRASLADO` es una salida de stock como cualquier otra, así
  que entra en la identidad de **R15** con todo derecho; lo que **no** puede es aparecer como «merma
  registrada» del local en el desglose de la pantalla 25. El desglose pasa de cuatro líneas a cinco.
  **Esto hay que escribirlo en D-16.202 antes de construir P16-J.**
- **Un caso conocido nuevo** en `casos-conocidos.md`: un mes con un traslado a caballo entre dos
  meses y una merma de traslado, calculado a mano, para que el cierre con tránsito quede probado
  contra un número y no contra una intuición.
- El valor de **N días** del aviso es provisional 🟡 hasta que una cadena real lo corrija.

### Qué habría que hacer si esto cambia

Si algún día un solo actor tiene poder sobre las dos puntas —una cadena con un único encargado de
inventario—, el modelo de dos pasos **sigue sirviendo**: se despacha y se recibe seguido, y el
tránsito dura segundos. Lo que no se puede es volver al paso único sin recuperar el problema que este
ADR resuelve. Un ADR que lo reemplace tendría que decir **dónde se registra la diferencia del
camino**, que es la pregunta que el modelo de un paso no sabe responder.

---

## Lo que este ADR deja abierto, a propósito

| # | Pregunta | Por qué no se decide aquí |
|---|---|---|
| 1 | ¿Puede **anularse** un despacho antes de recibirlo, o siempre se cierra recibiendo cero? | Anular es más cómodo; recibir cero deja rastro de que hubo un camión. Se decide con la primera cadena real, y mientras tanto **solo existe recibir cero** |
| 2 | ¿La recepción parcial deja la transferencia abierta? | La propuesta es **no**: una recepción cierra la transferencia y lo que falte es merma de traslado. Una transferencia que se recibe en dos tandas es, en la práctica, dos despachos |
| 3 | ¿Quién ve el aviso del punto 6? | Depende de la pantalla 28 (consolidado) y del resumen de Inicio, que son de otro paquete |
