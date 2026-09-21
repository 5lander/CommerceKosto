# CHANGELOG

Una entrada por commit de paquete. Formato: `## P{n} — {nombre}` con fecha, qué se entregó y qué quedó pendiente.

---

## P16-I3 · R15 — la varianza del mes cuadra con el inventario · 2026-09-20

> Una regla de negocio, un caso conocido reescrito y una fila de auditoría. Sin código: se construye
> en P16-J.

El usuario confirma el desglose de D-16.202 —**el `AJUSTE` es línea propia**, no parte de «sin
explicar»— y con él entra **R15**:

```
varianza (§16)  =  −mermas_y_ajustes (§18)  −  diferencia_de_conteo (§18)
```

**No es una tolerancia: es una identidad.** Al despejar el stock teórico de §18 dentro del
`consumo_real` de D-16.202, el término de transferencias y producción **se cancela entero** y lo que
queda es exactamente lo que el libro no explica. Si las dos vistas del mismo libro dejan de cuadrar,
una está mal y da igual cuál. Se probará sobre el dataset de CC-010/011/012 **y** sobre el caso
conocido de R7.

**CC-011 queda reescrito** con la fórmula nueva: `consumo_real = 26,00` y
`varianza = 4,00 = 2,50 merma − 0,50 ajustes + 2,00 sin explicar` — las tres líneas que la pantalla
25 enseñará. La prueba de hoy sigue anclando los 32,00 que el sistema da **hasta P16-J**, a
propósito: es lo que hará visible el cambio cuando llegue.

---

## P16-I2 · La regla del doble intérprete, la base en limpio y D-16.202 registrada · 2026-09-20

> Reglas, entorno y una decisión anotada. Sin código de aplicación y sin migraciones.

**La regla de CLAUDE.md §3 se generaliza.** Hablaba de Python y de `\b`; la causa real es que el
contenido atraviesa **dos intérpretes** y el primero se come lo que el segundo necesitaba —tres
casos, tres lenguajes: el retroceso de Python (INC-007 7/8/14), los backticks que bash ejecutó
dentro de un `node -e` (P16-I) y el *here-string* de PowerShell que dejó una arroba en el asunto de
un commit (P16-H)—. **El contenido de archivos y mensajes se escribe con la herramienta de escritura
o desde un archivo; nunca incrustado en un comando de shell.**

**La base de desarrollo pasa de 12 GB y 34,4 millones de movimientos a 15 MB**, y la auxiliar del
simulacro se elimina. El entorno sintético se reconstruye entero: dos companies con los mismos
nombres y cifras distintas, como pide D-16.193.

**Y los UUID escritos a mano dejan de estarlo.** El reset dejó 21 guiones de verificación apuntando
a filas inexistentes —un 404 que parece un fallo de pantalla—: ahora `ids.mjs` resuelve ubicaciones,
ítems y productos **por nombre** y falla diciendo cuáles hay.

**D-16.202 queda registrada** (la duda #16, decidida con la opción (a) extendida) para construirse
como **P16-J, justo antes de la pantalla 25**. Con una cuenta anotada que no cuadra: sobre el
dataset de CC-011 la varianza nueva sale **4,00**, no 4,50, porque el `AJUSTE` de +0,5 kg resta.

---

## P16-I · Tres casos conocidos para los tres agregados de dinero · 2026-09-20

> Dominio, casos conocidos, pruebas y una regla de CLAUDE.md. Sin migraciones y sin cambio de
> comportamiento.

**INC-029 no fue un descuido aislado: fue una asimetría.** El saldo tenía dos definiciones
vigilándose —el `SUM` de PostgreSQL y `proyectarSaldos`— y el dinero tenía una sola, dentro de una
consulta, sin una prueba que dijera cuánto debía valer. D-16.201 cierra **la clase**:

1. la definición baja al dominio (`inventory/domain/agregados.ts`), pura y con la base apagada;
2. `casos-conocidos.md` gana **CC-010, CC-011 y CC-012** —`compras_del_mes`, `CONSUMO_REAL` y la
   valorización del inventario— sobre **un mismo mes con el vocabulario completo del libro**:
   compra, corrección, transferencia, producción, merma, ajuste y consumo por venta, con el
   resultado calculado a mano antes que el código;
3. una prueba de integración ata el `SUM` de producción al pliegue del dominio, el mismo criterio
   que P6 fijó para el saldo.

La varianza de CC-011 se desglosa sin residuo en el vocabulario del libro, y al hacerlo deja a la
vista **la duda abierta #16**: de 32,00 dólares, 28,00 son transferencia y producción — stock que
salió del local sin consumirse en él, que SPEC §16 cuenta como consumo porque en el Excel no existe.

Y CLAUDE.md §3 gana la regla que INC-007 pidió tres veces: **código generado desde Python, con raw
strings o con la herramienta de escritura; nunca `str.replace` sobre literales con barras
invertidas**.

---

## P16-G2 · El simulacro con libro y mes cerrado, y las cuatro cosas que encontró · 2026-09-20

> Tooling de operación, 2 migraciones sin cambio de datos, un check nuevo y documentación.

**El simulacro de P16-G decía «probado» y no lo estaba**: restauraba un tenant **sin libro**, que es
el caso que ningún cliente real tiene. Repetido sobre `ensayo-b` con tres movimientos y **agosto
cerrado** (D-16.198), encontró cuatro cosas, ninguna visible leyendo el código:

1. la catástrofe simulada apagaba tres guardianes por nombre y faltaba uno — ahora se usa el
   interruptor de sesión, local a su transacción;
2. `pg_dump --data-only` deja el `search_path` **vacío**, y el SQL escrito a mano que va entre dos
   volcados tiene que ir cualificado;
3. `costeo_app` **no tiene privilegio `TEMP`** — la lista de períodos a recerrar vive ahora en un
   parámetro de la transacción. La barrera no se baja para que el script funcione;
4. **INC-030**: tres guardas no fijaban su `search_path` y resolvían el nombre de la tabla que
   vigilan con el del llamante. Migración + check **M12** en `audit:migrations`.

Y una pared que exigió decisión: un mes cerrado arrastra un conteo **confirmado**, y sus líneas no
se pueden reinsertar. Se resolvió por **orden** —las líneas antes que su conteo, con la clave
foránea diferible solo en esa transacción— sin apagar el guardián ni aflojar ningún `CHECK`.

El runbook ya puede decir **probado**: 24 filas en 22 tablas, agosto otra vez CERRADO, saldo
idéntico y el tenant de al lado intacto. Y gana la señal del respaldo nocturno: **por encima de 20
minutos**, la verificación pasa a semanal o a otra máquina.

---

## P16-H · Una importación que escribió en el libro se deshace COMO importación · 2026-09-20

> API, 1 migración, SPEC y documentación de API.

**Un archivo de movimientos mal armado dejaba cientos de filas en un libro que no se edita.** El mes
cambiado, la cantidad en la unidad que no era, el archivo de la otra sucursal: deshacerlo era
corregir movimiento por movimiento desde la pantalla, sabiendo cuáles eran, y si alguien se saltaba
uno el saldo quedaba mal para siempre sin que nada avisara.

Ahora cada movimiento importado sabe de qué archivo vino (`import_job_id`) y
`POST /importaciones/:id/anulacion` emite los de signo contrario **en una sola transacción** (R3),
dejando la importación en `ANULADA` — un estado, no un borrado. El mes cerrado sigue mandando: si
alguna de sus filas cae en uno, la anulación se detiene con **409** y su motivo. Reintentarla es
seguro: lo ya corregido se salta. `import.write`, el mismo permiso que escribir.

**Y destapó INC-029, que llevaba desde P6:** una compra corregida dejaba de contar en el saldo y
**seguía contando en el dinero**. `total_cost` es magnitud sin signo (ADR-009 §2), así que
`SUM(total_cost)` sumaba la compra y su corrección en vez de cancelarlas, e inflaba
`compras_del_mes` (SPEC §16) por el doble de lo corregido — la cifra que entra en el food cost real.
Las tres agregaciones de dinero restan ahora las correcciones, y la corrección de una compra
conserva su artículo para que la comparativa por presentación también cuadre.

---

## P16-F2 · El umbral del eje de IP se calibra para IPs compartidas · 2026-09-19

> API y documentación. Sin migraciones.

**Diez cuentas equivocándose en una hora no son un ataque: son un lunes.** El límite por IP del login
salió con ese umbral, y detrás de un CGNAT —o del wifi de un centro comercial— lo alcanza gente que
no ha hecho nada, quedándose fuera un cuarto de hora. Sube a **cincuenta cuentas distintas por hora**,
que es donde el tráfico legítimo compartido no llega y un barrido de contraseñas sí.

Y queda fijado por prueba que cuenta **cuentas, nunca intentos**: cuatrocientos fallos repartidos
entre diez correos siguen siendo diez cuentas.

---

## P16-G · Restaurar un solo cliente, y el respaldo que no cabía en memoria · 2026-09-17

> Herramientas de operación y documentación. Sin cambios en `apps/`.

**Un cliente que borra lo suyo ya no obliga a devolver a todos los demás al estado de ayer.**
`npm run restaurar:tenant` copia las filas de una sola company desde la copia de seguridad, y lo hace
**sin un solo filtro escrito a mano**: las dos conexiones entran con el tenant fijado, así que la
misma RLS que impide la fuga recorta el volcado y vuelve a comprobar cada fila al insertarla. No
vuelven las sesiones ni los correos pendientes, y los ajustes de costeo se comparan y se avisan en
vez de restaurarse en silencio.

**Y un fallo que llevaba tiempo esperando (INC-028):** `npm run respaldo` moría **sin mensaje** en
cuanto el volcado pasaba de 512 MiB — es decir, el día en que el cliente ya tiene datos que perder.
Ahora el volcado va del proceso al archivo por un descriptor, sin tope. Probado sobre una base de
10 GB.

Simulacro completo sobre la company sintética `ensayo-b`, con la otra company intacta.

---

## P16-F · El eje de IP del login limita, no bloquea · 2026-09-17

> API y documentación. Una migración: un tipo de evento de auditoría.

**Veinticinco fallos de una sola cuenta dejaban fuera del login a toda su IP, hasta una hora.** En un
restaurante eso es el personal entero con sus credenciales buenas mirando la pantalla; con CGNAT, gente
que ni siquiera es cliente. Y cualquiera podía dispararlo desde la acera sin acertar una contraseña.

Desde este commit el eje de IP **cuenta cuentas distintas** —que es la firma del rociado de
contraseñas— y responde con un **429 de quince minutos fijos**, sin escalada y sin bloquear ninguna
cuenta. El bloqueo por cuenta, que es el que protege la credencial, no cambia. ADR-028 · INC-027.

---

## P16 · Verificación multi-tenant — dos companies en el entorno sintético · 2026-09-17

> Sin pantallas nuevas. `apps/api` y documentación.

**El entorno de verificación pasa a tener dos restaurantes**, con los mismos nombres de datos y
cifras distintas: lo que distingue a uno del otro en la pantalla es el id, no el texto. Las pantallas
1–14 quedan comprobadas contra la company de al lado —ningún listado trae filas ajenas, y toda ficha
con un id ajeno responde «no existe en tu company» en sitio, nunca un 500—, y así se verificará cada
pantalla nueva.

**Corregido de paso:** crear un producto con un nombre repetido devolvía 400 donde la documentación
decía 409 —ahora es 409, y el conflicto es **por company**: dos clientes pueden tener los dos su
«Arroz marinero»—, y cinco mensajes visibles de sesión y ubicación recuperan sus tildes.

---

## P16 · Pantalla 14 — Escribir la receta · 2026-09-14

> Decimoquinto commit de pantallas. Sin cambios en `apps/api`.

**La receta de un plato o de una preparación, en la sucursal elegida.** Cada línea dice qué insumo, cuánto
en su unidad y si se mide **tal como se compra o ya limpio**; una línea se puede excluir sin borrarla.
Guardar crea una versión nueva desde la fecha elegida —la anterior queda en el historial— y la ficha del
plato enseña enseguida el costo nuevo. Si alguien guardó otra versión mientras tanto, se ofrece verla.

---

## P16 · Pantalla 13 — Los componentes de un combo · 2026-09-14

> Decimocuarto commit de pantallas. Sin cambios en `apps/api`.

**Un combo se arma desde su ficha**: qué productos con receta lleva y cuántos de cada uno. Se editan en una
página propia y se guarda la lista entera; si algo no vale —un producto repetido, el propio combo— la API
dice por qué, y si otra persona cambió el combo mientras tanto, se ofrece ver la versión actual. Un combo
sin componentes dice que le faltan componentes, no que le falta receta.

---

## P16 · Pantalla 12 — Lo que cuesta un plato, y a cuánto venderlo · 2026-09-14

> Decimotercer commit de pantallas. Sin cambios en `apps/api`.

**La ficha del producto se vuelve la página de trabajo del plato.** En la sucursal elegida: lo que cuesta
por porción —con la provisión de merma y el empaque—, lo que deja al PVP actual con el semáforo del food
cost, un **simulador** para probar otro precio sin guardarlo y el **desglose** de la receta con el peso de
cada insumo. Quien administra fija ahí si se vende, el PVP y las porciones por lote, y el empaque; si otra
persona guardó antes, la ficha lo dice y ofrece ver la versión actual.

**Arreglado antes de salir (INC-026):** tras guardar, la ficha enseñaba el costo viejo al lado del nuevo.

---

## P16 · Pantalla 11 — Los productos de la carta · 2026-09-14

> Duodécimo commit de pantallas. Sin cambios en `apps/api`.

**La carta de la empresa, vista desde la sucursal elegida**: cada producto dice si ahí se vende, no se vende
o todavía no está configurado, y a qué PVP. Alta de productos —la porción, no el plato— y su ficha, con
dónde se vende. La navegación gana el grupo «Carta».

**Pendiente, y dicho (duda #14):** la API no permite renombrar ni archivar un producto.

---

## P16 · Pantalla 10 — Sugerir un precio · 2026-09-14

> Undécimo commit de pantallas. Sin cambios en `apps/api`.

**Un precio nuevo, desde la ficha del insumo o desde la bandeja**, con el vigente de hoy a la vista. Para un
insumo comprado: la presentación, el precio de la factura con IVA y, si esa factura no lleva la tarifa de
siempre, la suya (`0` si fue exenta). Para una preparación: su costo estándar por unidad de uso, sin IVA.
Nace por confirmar y la pantalla lleva a la bandeja.

**Arreglado de paso:** el costo estándar de una preparación salía `0.00` en la bandeja y en el historial de
la ficha; y un desplegable con opciones largas desbordaba la página en el teléfono.

---

## P16 · Pantalla 9 — La bandeja de precios por confirmar · 2026-09-14

> Décimo commit de pantallas. Sin cambios en `apps/api`.

**R5 con pantalla: ningún precio se mueve solo.** La bandeja enseña cada precio sugerido junto al que manda
hoy —«de 54.00 a 3.10» y no un «3.10» suelto—, con su presentación, fecha, nota y tarifa de IVA. Quien tiene
`pricing.confirm` lo confirma o lo rechaza ahí; quien solo puede leer ve la bandeja sin botones. Si otra
persona ya lo decidió, la fila lo dice con el mensaje de la API.

---

## P16 · Pantalla 8 — Las presentaciones de compra de un insumo · 2026-09-14

> Noveno commit de pantallas. Sin cambios en `apps/api`.

**Alta y edición de presentaciones desde la ficha del insumo.** Cuánto trae y en qué unidad; el factor de
conversión solo cuando la física no lo da —«un limón pesa 80 g»—; y la **tarifa de IVA de la factura,
obligatoria**, precargada con la del grupo si la define. Al editar, la presentación y su factor se ven y
no se tocan, y la tarifa sí se corrige: es donde se arregla la semilla 0.15 de los artículos anteriores a
P16-A1.

---

## P16 · Pantalla 7 — Grupos y la tarifa de IVA que heredan · 2026-09-14

> Octavo commit de pantallas. Sin cambios en `apps/api`.

**`/grupos`.** La lista de grupos con su tarifa de IVA de compra —«No define» cuando no la fija, que no es
0 %—, el alta y la edición. La tarifa se escribe en porcentaje y vacía viaja como `null`: entonces manda la
del artículo. Un id que no existe en la empresa enseña su estado, no un formulario vacío.

---

## P16 · Pantalla 6 — La ficha del insumo: lo que cuesta, su historia, editarlo y archivarlo · 2026-09-14

> Séptimo commit de pantallas. Sin cambios en `apps/api`.

**`/insumos/[id]`.** Los datos del insumo, **lo que cuesta** por unidad de uso (neto, bruto, sobrecosto de
merma y desde cuándo) o que todavía no tiene precio confirmado, sus presentaciones de compra y la historia
de su precio con el vigente marcado por la API. Archivar y reactivar con confirmación en línea. `BODEGA`
la ve sin precios ni botones.

**`/insumos/[id]/editar`.** Nombre, rendimiento, grupo, origen del precio y lote; tipo y unidad a la
vista como no editables. **Si otra persona guardó mientras tanto**, la API responde 409 y «Ver la
versión actual» trae lo suyo en vez de pisarlo — verificado con un cambio ajeno a mitad de edición.

---

## P16 · Pantalla 5 — Dar de alta un insumo desde la aplicación · 2026-09-14

> Sexto commit de pantallas. Sin cambios en `apps/api`.

**`/insumos/nuevo`.** Por primera vez un dueño puede dar de alta un insumo sin importar un CSV: nombre,
tipo, unidad de uso elegida de la lista, rendimiento **en porcentaje** —«92,5» viaja como `0.925` exacto,
corriendo la coma sobre el texto—, grupo y origen del precio; «¿se produce en lote?» aparece solo en una
preparación. La ayuda avisa antes de guardar que el tipo y la unidad no se podrán cambiar. Un nombre
repetido o un rendimiento imposible se explican con el mensaje de la API. Solo con `catalog.create`.

---

## P16 · Pantalla 4 — Insumos: el catálogo con su costo por unidad de uso · 2026-09-14

> Quinto commit de pantallas. Sin cambios en `apps/api`.

**`/insumos`.** El catálogo con grupo, rendimiento y lo que cuesta cada insumo por unidad de uso —«Sin
precio» cuando no hay precio confirmado, nunca un cero—. `BODEGA` lo ve para contar, **sin la columna de
costo y sin pedirla**. Búsqueda sin tildes, filtro por grupo e «Incluir archivados». Un costo por gramo se
enseña con los decimales que necesita (`0.0012 / g`) y uno por kilo como un importe (`8.70 / kg`).

---

## P16 · Pantalla 3 — Ventas deja de costear la carta para saber qué hay · 2026-09-14

> Cuarto commit de pantallas. Sin cambios en `apps/api`.

**La rejilla de ventas lee la carta de `GET /productos/ubicaciones`** en vez de pedir `GET /costeo` —la
carta entera costeada, el cálculo más caro de la API— para pintar una columna de nombres. Y **a 360 px
ya cabe**: la casilla editable baja a 5rem en el teléfono. La versión de la carga del mes, la referencia
del mes anterior y el guardado de todas las filas con valor ya estaban.

---

## P16 · Pantalla 1b — Olvidé mi contraseña, y la respuesta vacía que la rompía · 2026-09-14

> Tercer commit de pantallas. Una incidencia nueva (INC-025). Sin cambios en `apps/api`.

**`/olvide` y `/restablecer`.** Pedir el enlace dice **siempre la misma frase**, exista o no la cuenta.
Restablecer comprueba el largo y la repetición **antes** de enviar, porque la API gasta el token antes de
mirar la contraseña; cualquier rechazo ofrece pedir otro enlace, y un límite de tasa deja reintentar.
Verificado de punta a punta en el navegador con el enlace leído del outbox: un solo uso, sesiones
cerradas, entrar con la nueva. «¿Olvidaste tu contraseña?» en `/entrar`.

**La pantalla enseñaba «Unexpected end of JSON input»** tras pedir un enlace que sí se había encolado
(INC-025): el cliente solo trataba como vacío el 204, y `olvido` responde 202 sin cuerpo. Arreglado, y
**el transporte tiene pruebas** —11, con `fetch` simulado—, que fijan también INC-023.
`erasableSyntaxOnly` en el web.

---

## P16 · Inicio (pantalla 2) — El mes de un vistazo, y las primeras pruebas del web · 2026-09-14

> Segundo commit de pantallas. **ADR-027**, una incidencia nueva (INC-024). Sin cambios en `apps/api`.

**Inicio (U2).** La primera pantalla tras entrar. Quien lee analítica ve el mes de la sucursal en nueve
indicadores —venta neta, food cost real con el teórico al lado, brecha, utilidad con su margen de
seguridad, prime cost, varianza, cobertura del conteo, ítems por reponer y sin costo—, cada uno con el
color que decidió la API. `BODEGA` ve qué reponer, lo pendiente primero y sin una sola cantidad. `/` y
la elección de sucursal llevan ahí.

**Un margen negativo se enseñaba como `100.00`** (INC-024). `comoImporte` y `comoPorcentaje` trataban el
signo como un dígito: con acarreo desaparecía, y un −7,5 % salía `-007,5 %`. La pantalla de menú ya lo
usaba con el margen de contribución. Arreglado, y con **las primeras pruebas de `apps/web`**: 20, con el
ejecutor de Node y sin dependencias (ADR-027), corridas por `audit:tests`.

---

## P16-D — El costeo dice «sin receta» en vez de cero · 2026-09-14

> Paquete de API corto, abierto por decisión del usuario (duda #12, opción (a)). Sin migraciones ni
> dependencias. Cinco guardianes.

**Un plato sin receta en la sucursal ya no cuesta «0.00».** `GET /costeo` y `GET /costeo/:id` devuelven
`sinReceta: true` cuando el producto no tiene ninguna línea activa en esa ubicación —no hay receta,
está vacía o toda excluida— o, en un combo, ningún componente; y el semáforo del food cost es
`SIN_DATO`, también con un PVP simulado. Hasta ahora la dueña miraba la bodega y leía «0.00 · 0.00 ·
0.00» con un food cost del 0 % en verde. La pantalla de costeo lo pinta como estado en la fila entera.
**Ningún número del motor cambia**: la marca sale del dominio y no entra en ninguna fórmula.

**Pendiente:** duda #13 —qué hacen la ingeniería de menú, el food cost real y el consolidado con un
plato vendido sin receta—.

---

## P16 · Armazón (pantalla 1) — La aplicación gana su esqueleto, y entrar vuelve a funcionar · 2026-09-13

> Primer commit de pantallas de la pasada. Sin cambios en `apps/api`. **ADR-020** y **ADR-022**, una
> incidencia nueva (INC-023) y dos recurrencias con su prevención automatizada (INC-015 → 1 en
> `doctor`; INC-007 → 13 en `typecheck` y `audit:complexity`).

**El armazón (U1).** Un grupo de rutas `(app)` envuelve la aplicación autenticada con una cabecera
—marca, sucursal, mes, salir— y una barra lateral por grupos, «Análisis» y «Operación diaria». Los
permisos salen de `GET /auth/sesion` una vez y **cerrados por defecto**: la barra empieza vacía y se
llena, y cada sección declara el suyo en una línea (`seccion('costing.read')`). Sin permiso, la
sección lo dice en sitio, también si se escribe la URL a mano. **El mes vive en la URL** y es el de
Ecuador, no el de UTC. En el teléfono la navegación va detrás de «Menú» y la cabecera ocupa tres
filas.

**El kit (ADR-022).** `useLectura`/`useCarga` —una respuesta de otra lectura ya no puede pisar a la
actual—, `Vista` con los cuatro estados en orden y el vacío obligatorio, `useEnvio`, la rejilla que se
recorre con el teclado y la casilla editable, una vez para ventas y conteo. Las cuatro pantallas y las
dos públicas, migradas y partidas: **`audit:complexity` mide desde hoy los `.tsx`**, y el árbol
anterior tenía diez incumplimientos que nadie veía.

**Lo que destapó entrar de verdad.** Se capturó la aplicación con tres roles a 1280 y 360 px, entrando
por el formulario, y salieron dos fallos que estaban en `main`: **desde P16-A2 nadie podía entrar
desde un navegador sin sesión** —el cliente pedía un token anti-CSRF antes del login, sin sesión eso es
401 y la pantalla decía «el correo o la contraseña no coinciden»— (INC-023), y **una fila ya guardada
de ventas o del conteo no se podía editar**, porque llegaba como `19.000000000000` a una casilla que
solo admite dígitos. Los dos, arreglados y comprobados guardando y recargando.

**Y los checks que no medían.** `typecheck` del web no comprobaba las rutas tipadas en un clon limpio
—CI nunca las validó—, y ahora genera sus tipos antes. `npm run doctor` sondea los puertos de la base:
tras un reinicio de Docker Desktop, el 5432 aceptaba y cortaba con la base sana. La base de desarrollo
se publica ahora en el **5442** (a pedido del usuario, solo en el `.env` local), y moverla destapó que
la guardia de «unitarias sin base» y la sonda de `audit:tests` estaban atadas al 5432: habrían vigilado
un puerto vacío. Leen las cadenas de conexión.

**Pendiente:** la duda #12 —costeo `0.00` sin receta—, que el usuario resolvió con la opción (a); la
conciliación con doce decimales (pantalla 23); `/ventas` leyendo `/costeo` entero (pantalla 3).

---

## P16-C — La carga del mes con testigo, la rejilla que borraba lo que no se tocaba, y lo que la pantalla de usuarios necesitaba · 2026-09-12

> Cuarto y último paquete de API de la pasada P16 → P20. Un commit, **una migración reversible**
> (`20260912205903_p16c_version_del_periodo`), ningún ADR nuevo —`period.version` es la decisión 5 de
> ADR-023—, una recurrencia (INC-017 a 2) con su regla automatizada, y **ocho guardianes**.

**La carga del mes, con testigo (D-16.121…D-16.123).** `period.version`, y las dos cargas por reemplazo
—unidades vendidas y costos fijos— la exigen: la condición va en el `WHERE` del `UPDATE period`, en la
misma transacción que borra y reescribe las filas, y responden **200 `{ version }`**; si otra carga del
mismo mes llegó antes, **409 `CONFLICTO_DE_VERSION`** y no se borra nada. Las dos comparten la versión, y
solo ellas la suben: un movimiento abre el mes sin dejar obsoleta ninguna rejilla, y un mes sin fila se
lee con `1`. Las lecturas pasan a `{ version, ventas }` y `{ version, costos }`. **Y la pantalla `/ventas`
tenía un fallo de pérdida de datos**: mandaba solo las filas cambiadas a un endpoint que reemplaza el mes
entero, así que guardar tres casillas borraba las demás ventas del mes. Ahora manda la versión y todas
las filas con valor, incluidas las de productos que ya no están activos.

**Lo que las pantallas 17, 19, 28 y 32 necesitaban.** `GET /inventario/movimientos/:id` —la fila del
libro que la corrección enseña, con alcance por su ubicación— y `?tipo=` en el libro. El consolidado
toma `estadoDelPeriodo` del **estado real del período**: hasta ahora lo deducía de si había conteo, y un
mes reabierto que conservaba su conteo salía `CERRADO`. **`GET /usuarios`** con roles, estado, caducidad
de la invitación y el **último** correo de invitación (`{ estado, error? }`), por alcance —un gerente solo
ve a quien tiene rol en su local— y sin `datos`, que el rol de la aplicación ni siquiera puede leer.
**`GET /roles`** con qué roles piden ubicación. **`PUT /ubicaciones/:id`** para nombre y tipo, con el
nombre repetido traducido a 409 en vez del 500 del índice.

**Un solo contrato para un id mal formado.** La deuda de P16-A2 decía «`ParseUUIDPipe` en los `@Param`»,
y aplicarlo tal cual habría cambiado el contrato: ese pipe responde `BAD_REQUEST`, y la API documenta
`ENTRADA_INVALIDA`. `IdentificadorDeRuta` lanza el error del dominio y cubre los **24** parámetros de la
aplicación, incluido el que ya usaba el de Nest.

**Lo que se destapó por el camino.** El comando del ensayo local del runbook —el paso que existe porque
encontró INC-018, 019 y 020— **no arrancaba desde P16-A1**: le faltaban `APP_URL`, `PROXY_DE_CONFIANZA` y
`MAIL_ADAPTER`. INC-017, recurrencia 2, y la regla `ensayo-local-con-las-variables-obligatorias` compara
desde ahora el paso 0 con las variables obligatorias del compose. Con las variables puestas, el override
de producción recreó la red y dejó **parada la base de desarrollo**: se recuperó y el runbook lo advierte.
Por eso **la prueba de `DELETE /usuarios/roles` a través de Caddy no se ejecutó** —exigía parar la pila
local en uso— y queda dicha para el ensayo previo al piloto. El mensaje del 409 decía «este receta»: ahora
cada agregado lleva su artículo.

**Números.** Unitarias: **891** (eran 889). Integración: **541 casos, 536 en verde y 5 saltadas con
motivo** en 33 archivos (eran 515 + 5). `audit:forbidden` **47 reglas sobre 483 archivos**;
`audit:arch` **390 módulos, 1751 dependencias**; **18** migraciones reversibles; **0 clones**;
`migrate:verify` 4/4 y el `down` probado sobre la base sembrada. Bundle: **126,9 KiB** de piso y 138,7 la
pantalla mayor. `npm run bench`, compilando antes: carta **100,3 ms** / 400, inventario **160,3** / 300, receta **81,5** / 150 y **el consolidado en 913,1 contra 800**, sin regresión (919,4 en P16-B). **Lo que queda dicho:** la hoja de conteo sigue siendo un reemplazo total
sin versión (duda para el usuario); ventas y costos fijos pueden darse un 409 espurio; `PUT /ubicaciones`
no archiva; y la prueba a través de Caddy está pendiente.

---

## P16-B — Dos personas ya no se pisan, los ceros dejan de ser 500, y el bench mide lo que dice medir · 2026-09-12

> Tercer paquete de código de la pasada P16 → P20. Un commit, **una migración reversible**
> (`20260912191330_p16b_versiones_y_ajustes`), **un ADR (023)**, ninguna incidencia nueva —dos
> recurrencias, INC-012 a 4 e INC-007 a 12, las dos con su prevención automatizada en el paquete— y
> **doce guardianes**, dos de los cuales encontraron pruebas que no medían lo que decían.

**Concurrencia optimista (D-16.11, ADR-023).** `product.version` e `item.version`, y las cuatro
escrituras de reemplazo total —`PUT /catalogo/items/:id`, `PUT /productos/:id/ubicaciones`,
`/empaque` y `/componentes`— exigen la versión leída y responden **200 `{ version }`**; si otro guardó
entre medias, **409 `CONFLICTO_DE_VERSION`** con `{ code, message }` y **sin el número dentro**, para
que reenviar no sea la salida fácil. La condición va **en el `WHERE` del `UPDATE`** y cero filas se
relee para distinguir 404 de 409, en ese orden. La versión es **del agregado**: un cambio de empaque
deja obsoleto el formulario de PVP abierto antes, y esa es también la deuda aceptada de D-16.20 entre
sucursales. **La receta no la hereda**: como cada guardado inserta una fila nueva y `recipes` no puede
escribir `item`, su testigo es `basadaEn` —el id de la **última versión creada** de ese destino en esa
ubicación, que `GET /recetas` publica ahora como `ultimaVersionId`— comprobado bajo
`pg_advisory_xact_lock`. Propagar, revertir y las cargas en lote sobrescriben sin testigo, pero pasan
por el candado o suben la versión, así que un formulario abierto se entera con un 409 en vez de pisarlas.

**Las lecturas que las pantallas 4 a 16 necesitaban.** `GET /precios/pendientes` —la bandeja de R5,
por cursor, con los nombres del ítem y del artículo y el **precio vigente al lado**—, `vigente` en el
historial de precios, `GET /precios/costos?fecha` con los ítems sin precio **aparte y no a cero**, la
ficha del producto con su versión, sus ubicaciones filtradas por alcance, la carta de una ubicación con
nombres, los componentes de un combo con lectura y **escritura** (`combo_component` tenía tabla desde P4
y ninguna ruta interactiva), las versiones de una receta y el historial de propagaciones para revertir.
En costeo: **`semaforoFoodCost` lo decide la API** con los umbrales de la company —el semáforo por
bandas se muda a `shared/domain` y la pantalla deja de comparar decimales en el navegador, que es lo que
fue INC-020—, `costos.lineas` trae el desglose de SPEC §13 **solo con `recipe.read`**, y
`GET /costeo/:id?pvp=` simula un precio con la misma `ladoDeVenta` del costeo real sin escribir nada.

**La cuarta recurrencia de INC-012, confirmada antes de arreglarla.** Cuatro `CHECK` estaban marcados
«lo filtra el esquema» y el esquema no los filtraba: `precio: "0"`, `pvp: "0"`,
`rendimientoPorciones: "0"` y una merma con `costoTotal: "-5"` salían como **500**. Diez expresiones
regulares repartidas en seis DTO, casi todas llamadas `decimal`, con signo en un archivo y sin él en
otro. La prevención es de construcción: **un vocabulario único** (`decimalConSigno`,
`decimalNoNegativo`, `decimalPositivo`, `fraccion`, `enteroNoNegativo`) donde cada esquema se llama
como lo que acepta, las guardas de dominio que faltaban, y la regla
**`regex-de-numero-solo-en-el-vocabulario`** de `audit:forbidden`, con su guardián. Siete filas de
`guardas-de-dominio.md` pasan a 🔴 **con su prueba citada**. Y las cinco consultas que P16-A2 dejó sin
esquema pasan a `.strict()`: `fecha=basura` deja de ser un 404 «sin precio» que mentía.

**Lo que destaparon los guardianes, y lo que destapó el bench.** Cada 🔴 se vio fallar rompiendo su
mecanismo con un script que muta, corre y restaura. **Dos siguieron en verde**: la presentación `"0"`
de un artículo, titulada «cuarta recurrencia», la paraba el dominio desde P2 (se retituló); y «diez
escrituras a la vez» con `Promise.all` pasaba igual con un leer-comparar-escribir, porque en local la
transacción no se solapa. Las carreras se rehicieron **deterministas** —otra conexión bloquea la fila,
se espera en `pg_locks` a que las N escrituras estén paradas y se suelta— y ahora el mismo sabotaje da
cinco 200 en vez de uno, y cinco 201 sin el candado. **El bench reventó** con un `toFixed` de
`undefined`, y la causa no estaba en el código medido: `bench.mjs` lanzaba `dist/bench.js` **sin
compilarlo**, y el archivo era de dos días antes. Desde este paquete compila siempre; los números de
P16-A1 y P16-A2 quedan dichos como no atribuibles con certeza a su commit (INC-007, caso 12). El
`EXPLAIN` de la bandeja pidió un índice: `reference_price(company_id, status)` pasa a
`(company_id, status, id)`, que convierte el recorrido de la clave primaria en un rango. Y se retira
`company_settings.iva_compra` (D-16.109), con un `down` que tuvo que escribirse a mano porque el
generado no se podía aplicar sobre una tabla con filas y el `up` habría soltado en silencio el `CHECK`
de los otros seis ratios.

**Números.** Unitarias: **889** (eran 870; +19, 65 archivos). Integración: **520 casos, 515 en verde y
5 saltadas con motivo** (INC-016) en **33** archivos (eran 460 + 5 en 32; +1 suite: `productos`).
`audit:forbidden` **46 reglas sobre 477 archivos** (eran 45 / 455); `audit:arch` **386 módulos, 1712
dependencias**, 0 violaciones; **17** migraciones reversibles; **0 clones**. `migrate:verify` 4/4.
Bundle de `apps/web`: **126,9 KiB gzip de piso** y 138,7 KiB la pantalla mayor. `npm run bench` sobre
el código del paquete: costeo de la carta **87,2 ms** / 400, inventario **161,0** / 300, guardar una
receta **83,7** / 150 con el candado dentro, y **el consolidado en 919,4 ms contra 800** — la misma deuda
abierta, sin regresión, y el umbral no se sube. **Lo que queda dicho:** la deuda de D-16.20 en
`product_location`; artículos y grupos sin versión; los **22 `@Param` sin `ParseUUIDPipe`**, que P16-A2
mandó a «P16-B/C» y este paquete no pagó; `GET /recetas` cambió de forma sin versión de API; y el bench
sigue fuera de CI.

---

## P16-A2 — El token que el servidor comprueba, la frontera que dejó de mentir, y las fichas que faltaban · 2026-09-10

> Segundo paquete de código de la pasada P16 → P20. Un commit, **una migración reversible**
> (`20260910202336_p16a2_csrf`), **un ADR (021, que supersede en parte a ADR-006)**, ninguna
> incidencia nueva —dos recurrencias registradas, INC-007 a 11 e INC-012 a 3—, y tres revisiones
> adversariales por etapa con **catorce hallazgos atendidos, cinco de ellos 🔴**.

**El token anti-CSRF, y por qué `SameSite=Strict` no bastaba (U4, ADR-021).** Toda mutación de los
**dos** procesos —app cliente y back office— exige la cabecera `X-CSRF-Token`, comparada con
`timingSafeEqual` sobre los SHA-256 de los dos lados (hashear iguala la longitud, que si no sería un
oráculo del tamaño del token); el fallo es **403 `CSRF_INVALIDO`**, con código propio porque un
`PERMISO_DENEGADO` manda al usuario al sitio contrario. El token es un **synchronizer**: 256 bits del
mismo CSPRNG, **no derivado** del de sesión, guardado **en claro** en `session.csrf_token` —no es una
credencial: sin la cookie no habilita nada, y hashearlo impediría recuperarlo— y entregado en el
**cuerpo** del login, nunca en una cookie, que es el canal del que defiende. `CsrfGuard` es global y
corre **entre** el de sesión y el de permisos. Aparece **`GET /auth/sesion`** →
`{ userId, permisos, alcance, csrf }`, sin `companyId` y con el `alcance` como unión discriminada:
es lo que permite recargar sin rotar el token, y lo que el armazón del frontend necesitaba.
**Las sesiones abiertas antes de la migración se invalidan (401), no se rellenan**: media sesión no
es una sesión, y a cambio `csrfToken` es `string` en todo el código de encima. `SameSite` sigue
puesto y sigue siendo la primera línea; lo que se dice ahora es por qué no puede ser la única —lo
aplica el navegador y mira el *sitio*, no el *origen*—, y los tres comentarios del árbol que
afirmaban lo contrario se **reescriben, no se borran**. La verificación de `Origin`/`Referer` que
SEGURIDAD.md §4.2 pide como capa extra **no se implementa**, con sus cuatro razones y su señal de
reapertura escritas (D-16.69).

**La frontera HTTP dejó de mentir en cuatro sitios.** Los tres errores de borde que salían como
`500 INTERNAL_ERROR` —identificador, unidad de uso y decimal— son **400 `ENTRADA_INVALIDA`** con un
mensaje que dice qué corregir, y la traducción va **en el dominio**, no en un `if` del filtro: el
`Record` exhaustivo de P0 ya mapeaba el código, solo faltaba que el dominio dijera de qué clase era
su error. `EscalaExcedidaError` **se queda en 500** a propósito —es un desbordamiento a mitad de
cálculo, no del usuario— y lo que se cierra es su camino de entrada. «Mes sin abrir» gana código
propio, **`PERIODO_SIN_DATOS`** (404, como antes), para que la pantalla distinga un estado normal del
producto de un enlace roto. Los **ocho** esquemas de consulta pasan a `.strict()`: hasta ahora un
`?companyId=<otra>` **se descartaba en silencio con un 200** y no quedaba rastro del intento. CORS
gana `DELETE` —`DELETE /usuarios/roles` existía desde P1 y era inalcanzable desde un navegador,
invisible porque `supertest` no hace preflight—, **declara** sus cabeceras en vez de reflejarlas,
expone `x-correlation-id` y `Retry-After`, y cachea el preflight 10 minutos. Y los DTO de ventas y
menu engineering publican el **nombre** del producto, lo que deja sin trabajo al rodeo del frontend
que costeaba la carta entera para traducir ids a texto.

**Las lecturas de catálogo que faltaban.** `GET /catalogo/unidades` —las diez, con nombre y
dimensión, ordenadas por tamaño y **sin el factor a base**, que es el interior del tipo decimal— y
las dos fichas, `GET /catalogo/items/:id` (con su grupo y sus artículos dentro) y
`GET /catalogo/articulos/:id` (con su ítem): la pertenencia va **en el WHERE** de cada lectura y un
recurso de otra company da **404 con el mismo texto** que uno inventado, comparado carácter a
carácter por una prueba. El alta suelta de ítem comprueba por fin que la unidad **exista** y no solo
que esté bien escrita —`"l"` está perfecto y no existe: el litro es `lt`— y las cuatro
comprobaciones de unidad del sistema comparten ya **un solo mensaje**, el que enumera las válidas.
Las tres escrituras que reventaban con un `P2002` sin traducir —renombrar un ítem, reimportar
artículos, la carrera de los dos lotes— salen ahora como **409** con el nombre que sobra dentro;
el rescate de la carrera relee **en una transacción nueva**, porque la que falló está abortada.

**Lo que destaparon las tres revisiones adversariales**, todo atendido y nada rebajado: **el token
salía en claro en el log de cada mutación** (la cabecera se introdujo sin tocar `redact`; ahora la
lista se deriva de `CABECERA_DE_CSRF` y su `.spec` la clava, y **C14 de `AUDITORIA.md`** pasa a
exigir que todo secreto nuevo entre ahí en el mismo paquete); **un `<form>` cruzado podía iniciar
sesión** —Nest monta `urlencoded` por defecto y el login lo analizaba: no se documentó como riesgo,
se cerró con `bodyParser: false` + `useBodyParser('json')` (D-16.74)—; **26 aserciones de 403
comprobaban solo el estado**, varias de ellas 🔴 de CLAUDE.md §7, y como `CsrfGuard` corre antes que
`PermisosGuard` les habría bastado el 403 equivocado (regla nueva de `audit:forbidden`,
`403-de-integracion-sin-su-code`, verificada por sabotaje); **el cliente web no sabía recuperarse de
un `CSRF_INVALIDO`** sin atacante de por medio (reintento único); **una 🔴 no medía lo que decía y
su afirmación era falsa** —volver a entrar no cierra la sesión anterior, y así se documenta
(D-16.73)—; **la prueba del preflight no distinguía lista declarada de reflejo** (se escribió la que
sí, y se vio en rojo); **`detalle` no lo leía nadie**, así que pasar los tres errores a 4xx borraba
su diagnóstico en vez de reubicarlo (ahora sale en nivel `debug`); **`.strict()` reabrió el eco que
`valorParaMensaje` acababa de cerrar** (el mensaje de Zod lleva los nombres de las claves verbatim);
**el 409 de reimportar artículos y el rescate de la carrera no tenían ni una prueba**; y
**`app-cliente.md` afirmaba que «todos» los esquemas de consulta son estrictos** cuando cinco
lecturas siguen tomando el parámetro suelto — ahora están nombradas una a una en el documento que
lee quien integra.

**Números.** Unitarias: **870** (eran 823; +47, 62 archivos). Integración: **465 casos, 460 en verde
y 5 saltadas con motivo** (INC-016) en **32** archivos (eran 400 en 30; +2 suites: `cors` y
`frontera-http`). `audit:forbidden` **45 reglas sobre 455 archivos** (eran 44 / 433);
`audit:arch` **368 módulos, 1608 dependencias**, 0 violaciones; **16** migraciones reversibles;
**0 clones**. `migrate:verify` 4/4. Bundle de `apps/web`: **126,9 KiB gzip de piso** y 138,7 KiB la
pantalla mayor, contra 200/350. `npm run bench`: tres de cuatro presupuestos en verde y **el
consolidado en 944,0 ms contra 800**, igual que en P16-A1 y sin regresión —normalizado al suelo del
entorno que el propio bench mide son **116,5 «suelos» frente a los 144,8 de P16-A1**—; el umbral no
se sube y la duda sigue abierta en `ESTADO.md`. **Lo que queda dicho:** `Origin`/`Referer` sin
implementar con su señal; los 16 `@Param` siguen sin `ParseUUIDPipe` (dan 400, pero dentro del
manejador); las cinco lecturas con `@Query` crudo no son estrictas; el back office conserva sus dos
analizadores de cuerpo (D-16.75); y el índice de ADR sigue saltando del 012 al 021.

---

## P16-A1 — El IVA en dos niveles, el correo que llega, y el límite que limita de verdad · 2026-09-10

> Primer paquete de código de la pasada P16 → P20. Un commit, dos migraciones reversibles
> (`20260910012847_p16a1_iva_de_compra`, `20260910042649_p16a1_correo_y_limite_de_tasa`), tres ADR
> (024, 025, 026), una incidencia (INC-022) y cuatro revisiones adversariales por etapa, con 19
> hallazgos atendidos, uno de ellos crítico.

**El libro ya sabe de IVA, y nunca asume 0.15 (ADR-024).** El bodeguero teclea el total de la
factura con IVA; la tarifa es del artículo de compra (`purchase_article.iva_tarifa`, obligatoria) o,
sin artículo, del grupo del ítem (`item_group.iva_tarifa`, opcional); la recuperabilidad sigue siendo
de la company (R13). Cada `COMPRA` nueva persiste los cuatro importes —bruto, tarifa aplicada,
recuperabilidad aplicada y `total_cost` como neto— con `desglose_conocido = true`; las anteriores
**no se rellenan** y quedan «sin desglose», con la discontinuidad de `compras_del_mes` dicha y no
escondida. Sin tarifa en ningún nivel, 400 con el sitio donde ponerla. `company_settings.iva_compra`
dejó de leerse (se retira en P16-B). La fórmula y la precedencia viven una sola vez en
`shared/domain/iva/`. Para poder corregir la semilla 0.15: `PUT /catalogo/articulos/:id` y
`PUT /catalogo/grupos/:id`; `ivaTarifa` en artículos, grupos, movimientos y en los CSV `ARTICULOS`,
`MOVIMIENTOS` y `PRECIOS` (una fila sin tarifa, o con un 15 donde va 0.15, se rechaza en el análisis
con su número). **Una preparación no lleva IVA de compra (D-16.51, pendiente de ratificar):** nacía
con la tarifa del grupo y su costo estándar —ya neto— se dividía otra vez entre 1.15.

**El correo transaccional (ADR-025).** La API **encola y no envía**: `email_outbox` se escribe en la
misma transacción que la invitación (también el reenvío, el restablecimiento y el aviso de bloqueo
del login, que en producción no existía). Entrega un **tercer binario**, el despachador
(`despachador.ts`, servicio `correo`, `npm run correo:despachar`), con su propio rol
`costeo_despachador` (`NOBYPASSRLS`, ve exactamente dos tablas; `npm run rol:despachador`;
`desplegar.sh` lo crea en el paso 5/8 antes de migrar) y tres adaptadores: `fake`, `consola` y
**`resend`** (HTTP, sin SDK, probado contra un `fetch` falso; en producción `fake` no arranca). Cola con
`FOR UPDATE SKIP LOCKED` **más una reserva** renovada fila a fila —el bloqueo de fila muere al
confirmar y el envío ocurre fuera—, reintentos 1 → 2 → 4 → 8 min y `FALLIDO` al quinto, `datos`
saneado al cerrar el correo, cierre ordenado sin `enableShutdownHooks()` (regla nueva de
`audit:forbidden`), purga de `rate_limit_hit`, latido como `healthcheck` y `GET /correo/salud` en el
back office. **Restablecimiento de contraseña sin sesión** (`POST /auth/password/olvido`, 202
siempre; `POST /auth/password/restablecimiento`, revoca todas las sesiones) por las **dos únicas
funciones `SECURITY DEFINER` que escriben**; `password_reset_token` invisible para la app. **El
token en claro vive solo en `email_outbox.datos` mientras el correo está en vuelo, y solo el
despachador puede leer esa columna** (`SELECT` por columnas para la app y el back office). Reenvío
de invitación (`POST /usuarios/:id/reenvio-de-invitacion`); enlaces `APP_URL/activacion?token=…` y
`APP_URL/restablecer?token=…`; `HORAS_DE_RESTABLECIMIENTO = 1`.

**El límite de tasa y la IP del cliente tras el proxy (ADR-026, INC-022).** Detrás de Caddy toda
petición llegaba con la IP de Caddy y el bloqueo por IP del login habría sido un bloqueo de
**todos**. Un solo camino, `ipDelCliente`: cree el último salto de `X-Forwarded-For` solo si el socket
está en `PROXY_DE_CONFIANZA` (vacía en desarrollo; la IP fija de Caddy `172.28.0.10` dentro de la
subred fija `172.28.0.0/24` en producción), y lo usan el login, el back office, el limitador global
(`LimitadorGlobalGuard`) y el límite nuevo. `LimitadorDeTasa` protege `/olvido` (IP 10/h ·
destinatario 3/h), `/restablecimiento` (IP 10/h), `POST /usuarios` y el reenvío (IP 30/h ·
destinatario 3/h) con la regla del login generalizada a `shared/domain/acceso` (sus 23 pruebas, sin
cambios); `rate_limit_hit` sin tenant como `login_attempt` (exención de ámbito, M6 sigue vacía),
claves `ip:` o `correo:<sha256>`, y el tercer 429 del sistema: `LIMITE_DE_SOLICITUDES` con
`Retry-After`. **Contar y anotar son una transacción por clave bajo `pg_advisory_xact_lock`**: la
primera versión dejaba pasar todas las peticiones simultáneas (30 de 30), y la 🔴 que lo fija las
lanza en paralelo.

**Lo que destaparon las cuatro revisiones adversariales**, todo atendido: `datos` legible por la app
y el back office; el «tiempo constante» de `/olvido` prometido y no medido (ahora reconocido, acotado
y medido por medianas); tres 🔴 ausentes (atomicidad en la otra dirección, token fuera de
`audit_log` leído con el rol que sí ve el log, privilegios negados a la app); `ci.yml` sin las
variables del back office **desde P11**; el aviso de bloqueo por `MailerPort` desde la API; el cierre
del despachador que mataba el proceso a media pasada; `enviar` y `marcarEnviado` en el mismo `try`;
la reserva que no cubría un lote grande; `desplegar.sh` sin crear los roles; el límite que no
limitaba bajo concurrencia (crítico); la lectura sin tope; un evento de auditoría por rechazo; y
`PROXY_DE_CONFIANZA` con la subred entera (pasarela y contenedores incluidos).

**Números.** Unitarias: **823** (eran 585, +238; 57 archivos). Integración: **400 casos, 395 en
verde y 5 saltadas con motivo** (INC-016) en 30 archivos (eran 313; +6 suites: `iva-de-compra`,
`correo-transaccional`, `correo-despachador`, `backoffice-correo`, `limite-de-tasa`,
`ip-tras-el-proxy`). `audit:forbidden` 44 reglas sobre 433 archivos (eran 40 / 361); `audit:arch`
351 módulos; 15 migraciones; 0 clones. `migrate:verify` 4/4 en las dos migraciones y `down` +
`deploy` sobre la base sembrada (16 M de movimientos). **Lo que queda dicho:** el envío real por
Resend no se ha ejercitado (depende de la cuenta y el dominio del usuario; runbook de puesta en
marcha, Paso 6b) y D-16.51 espera ratificación.

**Y `npm run bench`, que I8 exige en todo paquete que toque el camino de lectura, destapó tres
cosas al ejecutarse.** Llevaba **dos paquetes sin poder arrancar**: `volumen.sql` insertaba
`company.max_locations`, la columna que P11 borró al mover el límite a la tabla `plan`, y no lo veía
ningún check —no es TypeScript, no es una migración, y la regla de INC-017 solo comprueba que el
archivo del script exista. Es la **primera recurrencia de INC-017**, y lo que añade es que el SQL
suelto que acompaña a un script no lo verifica nadie: la única prevención es ejecutarlo. Además, su
informe de consultas estaba clavado en `docs/pasos/P15/` y la primera corrida **pisó evidencia ya
commiteada**; ahora es `--informe=<carpeta>` y sin la bandera no escribe nada.

Lo tercero es un número que hay que mirar: **el consolidado de diez ubicaciones da 940,9 ms contra su
presupuesto de 800**. No es regresión de este paquete —mismas consultas, mismos recuentos de llamada,
y normalizado al suelo del entorno que el propio bench mide cuesta 143,7 «suelos» frente a los 149,6
de P15— pero el umbral no se sube: queda como duda abierta en `ESTADO.md`, con la deuda que P9 ya
había diseñado (vistas materializadas, ADR-012 §7). Y queda dicho que **CI no ejecuta el bench**, que
es justo el riesgo que la fila I8 declaraba.

---

## P16 · commit 0 — Tooling de la pasada · 2026-09-09

**Empieza la pasada P16 → P20: la aplicación completa.** El backend tenía 36 escrituras y la
interfaz usaba 5 de 41 rutas, dos de ellas de escritura. Se construye todo, como Noctis Commerce y
con la referencia visual de `docs/Sistema ejemplo/`, con parada de entrega al piloto tras las
pantallas operativas. El plan aprobado (versión 6) vive en `docs/pasos/P16/PLAN.md`; las 47
decisiones cerradas —U1–U8 y D-16.1…D-16.39— en `ESTADO.md`, **registradas antes del primer commit
de código**, que es lo que la Fase 0 exigía.

**Tres reglas de `audit:forbidden` para `apps/web`, antes de la primera pantalla nueva:**
`no-fecha-a-medianoche` (INC-013: una fecha a `T00:00Z` del día 1 es del mes anterior en Ecuador),
`no-number-en-frontend` (cierra `parseInt`, `Number(variable)` y `.toNumber()`, que
`no-restricted-syntax` dejaba pasar) y `no-tipti` (D8). De 36 a 39 reglas —**40** con la de INC-021— sobre **361
archivos** (el +1 es el script nuevo, y el contador lo delata como pide INC-007), con guardián: cinco
líneas coladas, cinco infracciones, revertidas.

**`npm run medir-bundle`.** Lee el último build y suma por ruta el JavaScript que el navegador baja
para pintarla, en bruto y **en gzip, que es lo que viaja** (Next comprime por defecto; Caddy solo
reenvía). Hoy: piso 126,9 KiB, pantalla más cara 138,6. Presupuesto 200 / 350. Con el umbral bajado
a mano falla en cinco de siete rutas, y `AUDITORIA.md` I9 lo pide en todo commit que toque `apps/web`.

`docs/Sistema ejemplo/` queda fuera de git: es una app ajena que ya ponía `audit:forbidden` en rojo.

**Y `audit:deps` paró el commit, con razón:** cuatro CVE altos nuevos de `multer@2.2.0`, que
`@nestjs/platform-express` fija exacto y **sí** viaja a la imagen de producción, así que no se acepta:
 se fuerza `multer@2.3.0` con `overrides`. El arreglo costó 45 minutos porque npm ignora un override
nuevo cuando ya existe lockfile —dice «up to date» y deja la versión vieja—; es **INC-021**, y deja
una regla: todo `overrides` de la raíz tiene que verse reflejado en el lock, o el check falla.

---

## P14b — La cadena de despliegue del frontend, y los tres fallos que destapó el ensayo · 2026-09-08

**`apps/web` ya se despliega, y la pila entera se levantó y se recorrió en local antes de tocar
ningún servidor.** `Dockerfile` multi-stage con salida autocontenida de Next, servicio en
`docker-compose.prod.yml`, enrutado en Caddy y comprobación de recursos estáticos en `desplegar.sh`.

**Un solo origen, y es la decisión que más superficie ahorra.** Caddy sirve la interfaz en `/` y la
API en `/api/*` con `handle_path`, que quita el prefijo antes de reenviar. Con eso `CORS_ORIGENES` se
queda **vacío** —su valor más restrictivo—, la cookie de sesión sigue siendo `SameSite=Strict`, y no
hace falta un segundo certificado. El prefijo hace falta de verdad: la interfaz tiene una página en
`/costeo` y la API un endpoint en `/costeo`.

**Las fuentes se autoalojan y `NEXT_PUBLIC_API_URL` es una ruta relativa**, así que la misma imagen
sirve para cualquier dominio. Esa variable **se hornea en el paquete del navegador en tiempo de
build**: ponerla en `environment:` no hace nada, y está dicho donde se pone.

---

**El ensayo encontró tres fallos. Los tres llevaban días con los doce checks en verde encima, y
ninguno lo habría visto una revisión de código.**

**INC-018 — la imagen de la API llevaba dos días sin poder construirse, y el despliegue salía
`healthy`.** P10 creó `apps/api/parser/` y el `Dockerfile` nunca lo copió. Lo grave no es eso: es que
**`docker compose up -d --build` no aborta cuando el build falla** — deja el contenedor anterior
corriendo, su comprobación de salud sigue en verde, y sirve el código de dos días antes. Se descubrió
porque un endpoint devolvía menos campos de los que su DTO declara. Ahora se construye en un paso
propio, y `audit:forbidden` lo caza con `dockerfile-no-copia-lo-que-el-codigo-importa`.

**INC-019 — el respaldo volcaba una base vacía.** Regresión de P15: `jscpd` empujó a extraer
`conexionDeSuperusuario()` y la base de destino quedó fijada a `postgres`, que es lo que necesitaban
`bench` y `restaurar` pero no `respaldo`. Volcaba 1 KiB. Corregido, vuelca 343 MB y las cinco tablas
testigo cuadran sobre 13.475.504 movimientos. **Cuando `jscpd` empuje a extraer algo, la pregunta no
es si las copias son iguales: es si significan lo mismo.**

**INC-020 — el semáforo de food cost decidía al revés, desde la Fase C.** `localeCompare` con
`numeric: true` **no compara decimales**: compara tramos de dígitos, así que `"0.1673"` contra
`"0.28"` acaba comparando 1673 contra 28. En pantalla, un food cost del **16,7 % con el color de la
pérdida** y —lo peligroso— uno del **40 % en verde**. Sobrevivió porque con la misma cantidad de
decimales a los dos lados acierta: cualquier prueba con `0.30` contra `0.28` habría pasado. Lo
encontró mirar una captura con datos reales. Prevención: `no-comparar-decimales-con-localecompare`.

---

**Y lo que el ensayo confirmó que está bien:** el costeo del ceviche se rehízo a mano y con IVA de
compra recuperable al 15 % (D3/R13) da 1,4478 contra los 1,45 que reporta el motor; `mcTotal /
unidadesConMargen` reproduce exactamente el promedio ponderado que ADR-015 prometía; y la cadena de
respaldo restaura de verdad y compara recuentos.

**Además:** los decimales de presentación se centralizan en `apps/web/src/lib/decimales.ts` —el
multiplicador y el margen de referencia ya no salen con doce decimales—, el lote de ítems valida que
la unidad **exista en el catálogo** en vez de dejar que reviente como clave foránea (`fila 5: La
unidad "l" no está en el catálogo. Las válidas son: …`), y hay guía de puesta en marcha
(`docs/runbooks/puesta-en-marcha.md`) con plantilla de tenant.

Auditoría: OK · **36 reglas sobre 360 archivos** · 585 unitarias + 313 de integración.

---

## P14 — Capa visual · 2026-09-08

**La identidad de `docs/Manual de Marca/platise-brand-book.pdf` entra en `apps/web`, y ni una línea
de `apps/api` cambia.** El producto se llama **Platise**: el manual lo publica desde agosto, y con
eso se cierra D1, que llevaba desde P0 con «Costeo» como provisional y la nota «no inventar
branding». No se inventó: se abrió el archivo.

**Los valores se leyeron del PDF, no de una captura.** El manual está exportado desde Chromium, así
que sus colores viven como operadores `rg` con cuatro decimales y su tipografía como fuentes
incrustadas. La prueba de que la lectura es correcta no es que se parezca: **los seis ratios de
contraste que el manual publica se recalcularon uno a uno y dan sus mismas cifras**, hasta el
segundo decimal. Si un hex estuviera mal leído, alguno de los seis no cuadraría.

**El panel operativo va en claro, sin vidrio y sin sombra, y no lo decide el gusto.** El manual
publica una columna oscura de tokens y aun así dice, en su página de interfaz: «un panel oscuro con
vidrio gana en portafolio y pierde al chef en la cocina; esa es una decisión de producto, no de
estética». Y prohíbe el vidrio detrás de una tabla densa porque baja el contraste del texto pequeño.
Esta aplicación es tabla densa entera, así que no hay tokens de vidrio ni de sombra: enviarlos sería
código muerto.

**El semáforo de food cost usa los tres significados del manual, no un verde-ámbar-rojo.** Jade para
lo que sostiene, Persimmon **Profundo** para lo que pide atención y Oxblood —que el manual llama
literalmente «pérdida»— para lo que la produce. Persimmon vivo no se usa como texto: con 3,93:1
reprueba, y el manual lo dice antes de que a nadie se le ocurra. Su variante profunda da 5,64:1,
calculado aquí porque el manual no lo publica.

**El logotipo se extrajo de las curvas de Bézier del PDF, no se redibujó.** El manual da las
fórmulas del isotipo, y redibujar desde una fórmula es interpretar. La geometría extraída reproduce
su tabla de construcción sin que se le impusiera: caja de 61,803 × 100 (`H/φ`), trazo de 11,803,
panza de `rx` 26,75 y `ry` 25, y la rotura del arco a −21,25°, que es `−90 + 180/φ²`.

**Las fuentes se autoalojan.** Inter e IBM Plex Mono, subconjuntos latin y latin-ext, 185 kB. Sin
`next/font/google`: descarga en tiempo de build, y el frontend todavía no tiene cadena de despliegue
escrita — no conviene que nazca dependiendo de tener red para construir. Además, así el navegador de
un dueño de restaurante no le pide nada a un tercero. **Se verificó la licencia SIL OFL 1.1 de las
dos**, que el propio manual declaraba pendiente sin verificar.

**Fraunces no se sirve**, y es la decisión más discutible del paquete: el manual la asigna al nivel
Display, de 66 a 172 px, para «aperturas», y su página de interfaz no la usa en el panel operativo.
Traerla para usarla a 24 px sería inventar un tamaño que el manual no contempla. Reversible en diez
minutos si se prefiere lo contrario.

**Y `componentes/ui`, que §10 nombra desde P0 y no existía.** La capa visual vivía en 107 bloques
`style={{…}}` repartidos por las páginas: para cambiar el aspecto había que abrir los archivos que
traen los datos, o sea que la promesa de §10 no era cierta estructuralmente. Ahora quedan cero.

**Lo que la auditoría destapó, y es lo más importante del paquete:** después de añadir tres archivos
y borrar uno, `audit:forbidden` seguía diciendo «346 archivos». Los patrones decían
`apps/*/src/**/*.ts` y **ninguno `.tsx`**: las 34 reglas nunca habían examinado una sola de las 2.000
líneas del frontend. Corregido a `*.{ts,tsx}`, el contador se mueve a 359 y el guardián lo confirma.
Es la **décima** recurrencia de INC-007 — y la lección nueva es que un glob de extensión es un
alcance con fecha de caducidad, que solo delata un contador que no se mueve.

**Se revirtieron dos correcciones de CSS que no corregían nada.** Se añadieron contra un
desbordamiento horizontal deducido de una captura; medido, el desbordamiento no existía y la captura
era una maqueta sin `meta viewport`. Un comentario que dice «esto evita un fallo» cuando no lo evita
es peor que no tener comentario.

Pendiente: el margen de referencia se muestra con 12 decimales porque la API lo manda a escala de
almacenamiento sin el par `mostrar`/`exacto`. Arreglarlo bien es un cambio de la API, que el
criterio de aceptación de P14 prohíbe. **Auditoría: OK · 585 unitarias + 313 de integración, sin
modificar ninguna.**

---

## P13 — Frontend del back office · 2026-09-08

**La interfaz la sirve el propio proceso del back office (ADR-018).** Cuatro vistas —entrar,
cartera, ficha de una company y «quién ha mirado qué»— servidas por las mismas rutas que la API.

La alternativa era una segunda app de Next.js, y se descartó por lo que implica: el navegador
tendría que hablar con la API privilegiada **desde otro origen**, lo que obliga a habilitar CORS con
credenciales justo en el proceso que ve todos los tenants. Sirviéndola desde el mismo proceso no hay
petición cruzada que permitir, y lo que se despliega no cambia respecto de P11: un proceso, un
puerto, un túnel.

**Sin framework y sin empaquetado, pero con TypeScript estricto.** Un archivo en `src/navegador/`,
compilado por `tsconfig.ui.json` — **el único proyecto del repositorio con `lib: DOM`**, para que un
endpoint no pueda usar `document` y compilar. Y para que esa separación no deje un agujero de
verificación: `audit:types` compila los dos proyectos y `eslint.config.mjs` tiene un bloque propio
para esa carpeta. Antes de añadirlo, `audit:lint` fallaba con «was not found by the project service»
— la veía y no podía analizarla.

**El motivo es un campo permanente arriba, no un diálogo al pulsar.** Un motivo que se pide *después*
de decidir mirar se rellena para pasar el trámite; uno que está delante mientras se decide, se
piensa. Con contador de caracteres que faltan, y sin `localStorage`: el motivo muere con la pestaña.

**Nada en línea, y hay prueba que lo fija.** Con `script-src 'self'` sin nonce, un `<script>` con
cuerpo no se ejecutaría; el guion y los estilos van como recursos propios. Todo el DOM se construye
con `createElement`/`append`, que crea nodos de TEXTO: el nombre de una company no puede
interpretarse como marcado ni queriendo.

Tres cosas que costaron y quedan escritas: Nest **aborta el proceso** si un proveedor lanza al
construirse —lo que salía era un volcado nativo sin mensaje—; la ruta del guion difiere entre `dist`
y `src`; y **dos aplicaciones HTTP de Nest en el mismo worker de vitest revientan Node**.

Los doce checks en verde, **cero dependencias nuevas**. 585 unitarias + 313 de integración.

---

## P11 — Back office · 2026-09-08

**El rol que puentea RLS, con las cuatro condiciones que lo hacen gestionable (ADR-017).**

`costeo_backoffice` es el único rol del sistema con `BYPASSRLS`: una consulta suya ve todos los
tenants a la vez. SPEC §1 lo eligió a sabiendas por encima de la alternativa —una cuenta dentro de
cada tenant— y puso tres condiciones. Están las tres, más una cuarta:

1. **Vive solo en su proceso.** `src/backoffice.ts` es un segundo binario; `AppModule` no importa
   `BackofficeModule`. Montarlo dentro con un guard delante pondría la conexión sin filtro en el
   mismo contenedor que todos los controladores del cliente, y el guard sería lo único entre eso y
   una fuga total. Lo verifican 3 reglas de `audit:forbidden`, 2 de `audit:arch` y **una prueba que
   le pregunta al contenedor de `AppModule` ya construido si la tiene** — con su pareja, que
   comprueba que el back office **sí**, porque si no la primera pasaría aunque la clase no existiera.
2. **Pool separado.** Otro proceso, otro cliente, otra cadena, 4 conexiones, sin PgBouncer.
3. **Registro append-only con motivo obligatorio.** `CHECK` de 20 caracteres en la base, mensaje que
   dice cuántos faltan en el dominio, y **escrito ANTES de leer y en la misma transacción**: si el
   INSERT falla, la lectura se revierte. El puerto no tiene un `registrarAcceso()` suelto a
   propósito — sería una llamada que se puede olvidar.
4. **Privilegios tabla por tabla y mínimos.** Sin `DELETE` en ninguna, y **sin `SELECT` sobre
   recetas, precios ni movimientos**: contar ítems no es leer la receta de un cliente (§4.3).

**`audit_log` tiene por fin lector.** Se escribía desde P0 y ningún rol podía leerlo: diez paquetes
acumulando evidencia sin destinatario, cumpliendo la letra de SEGURIDAD.md §10 y no su propósito.

**D5 cerrada, y con los tres límites VERIFICADOS.** `plan` con `max_locations`, `max_items` y
`max_products`; `company.max_locations` desaparece. Los tres se hacen cumplir con candado sobre la
fila de `company` dentro de la transacción que inserta — contar fuera es un TOCTOU. Una columna de
límite que nadie comprueba aparenta una garantía que no existe, que es lo que le pasó a
`combo_component` durante seis paquetes.

**La migración se reordenó a mano.** Prisma emitía el `DROP COLUMN "max_locations"` en la primera
línea, antes de que existiera un plan al que mover el límite; el dato se habría perdido y la pérdida
habría sido silenciosa porque el valor por defecto coincide. Ahora se crea el plan, se siembra, se
mueve cada company al plan que de verdad la cubre —fallando en alto si ninguno lo hace— y solo
entonces se suelta la columna.

Los doce checks en verde, **cero dependencias nuevas**. 585 unitarias + 308 de integración.

---

## P15 — Endurecimiento · 2026-09-08

**Tres hallazgos, ninguno salido de leer código: los tres salieron de ejecutar algo que hasta ahora
no se ejecutaba.**

**Un pentest que ataca** (`test/integracion/pentest.spec.ts`, 21 pruebas con dos tenants vivos:
inyección SQL, IDOR, XSS almacenado, asignación masiva, sesión, fuga por error). Encontró dos
agujeros reales:

- **Un byte NUL convertía cualquier campo de texto en un 500.** PostgreSQL no puede guardarlo y su
  rechazo subía como `INTERNAL_ERROR`; era INC-012 otra vez, alcanzable desde cualquier campo por
  cualquier usuario autenticado. `EsquemaPipe` rechaza ahora los caracteres de control **antes** de
  Zod — nunca en un refinamiento de objeto, que es la trampa de INC-008 — y por punto de código, no
  con una regex que obligue a meterlos en el fuente.
- **`GET /costeo?locationId=<de otra company>` respondía 200.** Sin fuga —RLS aguantó y devolvía los
  productos del propio usuario— pero con **todos los costos a cero**: un número plausible y falso,
  que en este producto es peor que un error. `exigirUbicacionEnAlcance` salía temprano para los roles
  de company. La sesión lleva ahora las ubicaciones de la company (`session_lookup` con un LATERAL,
  cero consultas nuevas por petición) y los 27 llamantes heredaron la comprobación sin tocar ninguno.

**`npm run bench`, la deuda aplazada desde P9.** Base propia creada y borrada, `grants.sql` antes de
migrar, volumen sintético realista (219.000 movimientos, 14.000 líneas de receta, 5 companies para
que RLS filtre), p95 de 30 corridas sobre los casos de uso —no sobre HTTP, INC-016— con el suelo del
entorno medido al lado, y **salida con código 1** si un presupuesto se pasa.

En su primera corrida: **el consolidado tardaba 1.399 ms contra un límite de 800.** No por ninguna
consulta lenta, sino por leer cincuenta veces la tabla `item` y calcular veinte veces los mismos
costos. Se arregló el código, no el umbral: filtro cuadrático en `CostosDeItems` (→1.351), ámbito de
lecturas de company compartidas por operación (→844) y la carta leída una vez por ubicación en vez de
dos (→**677**). El inventario de una ubicación bajó de paso de 156 a 110 ms.

Los doce checks en verde. **578 unitarias + 298 de integración.**

---

## Sprint de salida a cliente — Fases A a D · 2026-09-07 y 08

**Objetivo:** que un restaurante pueda usar el sistema. Alcance recortado por decisión del usuario;
el estándar del motor, intacto.

### Fase A — P10, importación acotada

Escritura en lote en los cuatro módulos dueños (antes, 200 ítems eran 200 transacciones y la fila 150
mala dejaba escritas las 149 buenas). `combo_component` tiene por fin una ruta de escritura: llevaba
seis paquetes con lectura y sin escritura. **D4 cerrada** leyendo el Excel: `LNK` era el apaño con el
que la hoja armaba un combo (ADR-014). `npm run importar` con guarda de producción. Y el **MC de
referencia visible y reproducible** (ADR-015).

### Fase B — desplegar

**ADR-016 cierra D10**: un VPS en Hostinger con PostgreSQL propio, no gestionado. El hook `initdb`
que crea `costeo_migrator` y `costeo_app` solo existe si la base es nuestra. Lo que se pierde queda
escrito: sin failover, parches nuestros, respaldo nuestro. **Cadena de respaldo que restaura y
compara**, probada con 4.812.678 filas del libro. Cuatro runbooks completos.

### Fase C — cinco pantallas

`apps/web` con Next.js 16.3.4, React 19.2.8 y TypeScript. Sin librería de UI, sin gestor de estado,
sin cliente HTTP. Login y sucursal · costeo · ingeniería de menú con el MC de referencia · rejilla de
ventas navegable por teclado · inventario con la hoja **a ciegas** y la conciliación tras otro
permiso. CORS habilitado con lista blanca exacta.

### Fase D — la sesión

`docs/runbooks/sesion-con-el-cliente.md`: el guion en seis pasos, la comprobación previa, y **las
tres diferencias conocidas con las palabras exactas para explicarlas antes de que el cliente las
vea** — los céntimos frente a Excel, los ítems sin contar al teórico, y el MC ponderado.

### Lo que apareció al usar el sistema de verdad

Dos fallos serios que ninguna prueba vio: `SugerirPreciosEnLote` rechazaba todas las filas porque
`typeof x === 'string'` no discrimina cuando el éxito es un tipo marcado —que en ejecución es una
cadena—, y `combo_component` no tenía escritura. Y un tercero cazado por el linter del frontend: la
conversión a porcentaje truncaba, y `0.2799` salía «27,9 %» pintado de verde con el umbral en 28 %.

### Pendiente

Aprovisionar el VPS (necesita la cuenta de Hostinger), los datos del tenant real, y el destino de
`RESPALDO_COMANDO_SUBIDA`. Después, **P15**.

---

## P10b — El MC de referencia, visible y reproducible · 2026-09-07

**Objetivo:** cerrar la única contradicción encontrada entre el SPEC y el Excel del que sale, y que
el cliente pueda ver por qué su hoja da otro número.

### Decidido

**El MC promedio de menu engineering se queda PONDERADO** — `Σ(mc × unidades) / Σ(unidades)`—, como
dice SPEC §15 y como es el Kasavana-Smith canónico. El `AVERAGE` del Excel **es** la media simple, y
es el atajo que una hoja hace fácil: con cola larga desplaza el eje y convierte en «perros» a los
platos que sostienen el negocio. La implementación de P8 era correcta. **ADR-015**.

### Entregado

- `mcTotal` y `unidadesConMargen` en la respuesta, para que `mcTotal / unidadesConMargen = mcPromedio`
  se pueda rehacer a mano
- **`unidadesConMargen` no es `unidadesTotales`**, y hay una prueba que lo fija: un producto sin PVP
  no entra en ninguno de los dos lados de la división, así que dividir por el total daría otro número
  y el cliente tendría razón al decir que no cuadra
- `metodoMcPromedio: 'PONDERADO_POR_UNIDADES'` viajando pegado al número, no escrito en el frontend
- **La frase explicativa la escribe el frontend**, desde sus recursos (D11): la API da números
- Duda 7 de `ESTADO.md` cerrada

---

## P10 — Importación de catálogo, acotada a una migración operada · 2026-09-07

**Objetivo:** que el catálogo de un cliente entre sin digitarlo, y que entre entero o no entre.

**Alcance recortado por decisión del usuario, con fecha comercial encima.** No hay pantalla de
subida, ni previsualización en dos pasos, ni deduplicación asistida: es un comando que un operador
ejecuta con el archivo delante. Lo que sí se construyó entero es la pieza que no caduca.

### Entregado

- **Escritura EN LOTE en los cuatro módulos dueños**, una transacción por lote. Es lo que más vale
  del paquete: antes, cada método de repositorio abría su propia transacción, así que 200 ítems eran
  200 transacciones y **la fila 150 mala dejaba escritas las 149 buenas**. Y no se podía envolver
  desde fuera: `Prisma.TransactionClient` no expone `$transaction`
- **`combo_component` tiene por fin una ruta de escritura.** P4 creó la tabla, P5 la lee para
  costear, y **entre P4 y P10 nadie insertó una fila**: un combo se podía crear y jamás componer, y
  costaba cero. No lo destapó ninguna prueba — lo destapó preguntar qué representaba una columna de
  un Excel
- **D4 cerrada leyendo el archivo, no interpretándolo.** `LNK` no era un tipo de insumo: era el apaño
  con el que el Excel armaba un combo (`=INDEX(V_COSTEO!$H, MATCH(...))` sobre el costo por porción
  de un producto de venta). **ADR-014**
- Migración `p10_importaciones`: `import_job` + `import_job_status` con RLS deny-by-default y
  `FORCE`, ocho `CHECK` con sus guardas documentadas, y el permiso `import.write` **de nivel
  company** — `GERENTE_LOCAL` no lo recibe
- Descriptor `PRECIOS` nuevo, y `empaque` / `activo` en `PRODUCTOS`. Sin precio no hay costo, y sin
  costo la sesión con el cliente no demuestra nada
- **`npm run importar`**, ejecutando `dist/cli.js` (INC-017), con guarda de producción por bandera
  explícita y **sesión abierta por el mismo camino que el login** — no hay ninguna ruta nueva que
  fabrique una sesión sin credenciales
- **ADR-013**: el parser en `.mjs` fuera de `src/`, en proceso hijo sin variables de entorno, con
  plazo y techo de memoria. Y lo que **no** aporta: sin reintentos, sin DLQ, sin sandbox de sistema
- **835 pruebas**: 558 unitarias con la base apagada + 277 de integración

### Lo que la auditoría paró

Cuatro cosas reales, ninguna arreglada bajando un umbral. La que más vale: **knip destapó que los
topes de tamaño y de filas de `SEGURIDAD.md` §5.1 estaban escritos y no los aplicaba nadie.** Un
check de código muerto encontró un agujero de seguridad.

### Pendiente

- **`npm run bench` re-fechado a después del lanzamiento.** Se fijó para P9, no se pagó; se re-fechó
  a P10, tampoco. Dicho, no escondido
- Alias del dialecto real del cliente: cuando llegue su archivo. La pasada de análisis no escribe
- Prueba de similitud dominio ↔ `pg_trgm` (la diferencia de tildes)
- P11, P13, P14 y P15 **pospuestos**, con su motivo en `ESTADO.md`

---

## P9 — Consolidado de company y comparativa entre ubicaciones · 2026-09-06

**Objetivo:** ver la cadena completa y comparar locales.

### Entregado

- **Consolidado de company**: agrega ventas, márgenes, consumo, compras, inventario y costos fijos de todas las ubicaciones de un mes
- **Los porcentajes se recalculan sobre los totales, nunca se promedian.** Es la decisión que justifica el paquete: un local pequeño con food cost del 80 % y otro grande con el 30 % dan 30,1 % ponderado y 55 % en media simple, y **el segundo número es plausible en pantalla y falso**. Hay una prueba con los dos valores que cae si alguien sustituye la fórmula
- **Una ubicación sin datos del mes se aparta y se nombra**, no suma cero — la misma regla que ADR-010 §5 aplicó a un ítem sin contar
- **El consolidado dice el estado del período de cada ubicación**, porque el período es por ubicación (ADR-010 §1) y puede estar sumando meses cerrados con abiertos
- **Comparativa del mismo producto entre ubicaciones**: PVP, food cost, margen y unidades, con mínimo, máximo y brecha para ordenar por dispersión
- **Comparativa de precios de compra desde el LIBRO**, no desde `reference_price` —que es de company y daría el mismo número siempre—, agrupada también por artículo para poder responder «¿y es que compra otra marca?»
- **Permiso `analytics.consolidated.read`, de nivel company.** `GERENTE_LOCAL` **no** lo tiene: ver la cadena entera es la escalada horizontal que E18 prohíbe en la propagación de recetas. Tres pruebas de 403 y una cuarta que verifica que sigue viendo lo suyo
- **ADR-012** con las siete decisiones
- **727 pruebas**: 457 unitarias con la base apagada + 270 de integración

### Medido

| | mediana | p95 |
|---|---|---|
| Una ubicación | 69 ms | — |
| **Diez ubicaciones** | 616 ms | **734 ms** de 800 |

Cumple **al 92 %**, y escala lineal: **alrededor de doce ubicaciones se rompe**.

### Pendiente

- **Las vistas materializadas no se construyeron**, y no es un olvido: el criterio de aceptación se cumple sin ellas y una caché de números en este sistema es una fuente de números rancios. ADR-012 §7 deja el diseño y el umbral medido que las dispararía
- **`npm run bench` sigue sin existir.** Era la deuda que P8 dejó con fecha de pago en P9 y **no se pagó**: el presupuesto se midió a mano con la API en contenedor. La deuda sigue abierta

---

## P8 — Vistas analíticas · 2026-09-04

**Objetivo:** las seis vistas del Excel, por ubicación.

### Entregado

- **Food cost real y varianza** (SPEC §16) **con la conciliación R7**, que ahora corre sobre un **dataset completo** en cada build: catálogo, precios con vigencia, receta, motor de costeo, unidades vendidas y libro. Era el último criterio de aceptación pendiente desde P0
- **Menu engineering Kasavana-Smith** con los cuatro cuadrantes, más `SIN_DATOS` e `INACTIVO` que el SPEC también fija. **El índice se calcula con una sola división** para que el empate exacto en 1 sea determinista
- **Punto de equilibrio, prime cost y margen de seguridad** (SPEC §17) con **clasificación explícita** de T6 —`MANO_DE_OBRA` / `OTRO_FIJO` / `VARIABLE`—, que es lo que el propio SPEC pide en lugar del frágil prefijo «Sueldos*»
- **Inventario valorizado** con estados, días de cobertura y punto de reorden (SPEC §18)
- **Resumen gerencial** con semáforos por company (D3), y un cuarto estado —`SIN_DATO`— que existe para que ninguna interfaz pinte de verde la ausencia de medición
- **`product_sales`**: las unidades vendidas, que faltaban desde P6 y de las que dependen tres de las seis vistas. En lote y por reemplazo (D9), que es lo que la grilla de P12 necesita
- **`fixed_cost`** (T6) con su catálogo de clasificación
- **`BODEGA` no recibe ninguna vista**, solo el semáforo `REPONER`/`OK` **sin la cantidad**, servido desde su propio caso de uso y con su propio tipo
- **ADR-011** con las siete decisiones del paquete
- **702 pruebas**: 442 unitarias con la base apagada, 260 de integración

### Lo que se descubrió por el camino

**R7 destapó un fallo que llevaba dos paquetes en el código.** La receta es del **lote** y la venta es de **porciones**: vender 100 unidades de un producto que rinde 2 consume **50** lotes, no 100. P6 multiplicaba por las unidades sin dividir, así que con un rendimiento de 4 cada venta sacaba del inventario cuatro veces lo que sale de la bodega.

**Ninguna de las 596 pruebas de P0–P6 lo vio**, porque `rendimiento_porciones = 1` es el único valor con el que multiplicar y dividir dan lo mismo, y todos los productos de prueba lo tenían en 1. Lo encontró la conciliación de SPEC §16, que con rendimiento 2 daba **98,00** sobre un caso de 102 dólares.

Es la primera vez que R7 demuestra para qué existe, y la corrección vive en el punto único que P6 y P8 comparten: `totalConsumido`.

**El índice «exactamente 1» no salía exacto.** Escribiendo la fórmula del SPEC tal cual —tres operaciones, cada una redondeando a escala 12— el producto de la frontera daba `0.999999999999` y caía en `CABALLO` en vez de `ESTRELLA`. No es un error de presentación: es una recomendación de negocio invertida por un residuo en el decimal doce.

**El consumo se podía contar dos veces.** El Excel no tiene movimientos de consumo; este sistema sí puede tenerlos (P6). Sumarlos *y* restar el consumo teórico daba 40 kg de stock donde había 70 — un número perfectamente creíble que dice que falta mercancía que está en la estantería. El invariante que lo fija es una prueba: el stock teórico da lo mismo esté o no registrado el consumo por venta.

**`audit:arch` paró un ciclo real** entre `contexto.ts` y `vistas.ts`, y `audit:duplication` cazó la cuarta repetición del bloque de auditoría, que se extrajo a `shared/application`.

### Lo que el guardián 1 enseña

Volver al código de P6 deja **442 unitarias en verde, 246 de integración de P0–P7 en verde, y falla UNA sola** de las ~700 del proyecto. Esa prueba detecta que el consumo teórico es el doble de lo que debería.

La lección no es que faltara una prueba: es que **el caso de prueba tenía que tener rendimiento distinto de uno**. Con rendimiento 1 los dos caminos de R7 coinciden aunque uno esté mal, y el invariante verde tapa el desglose roto — la misma forma de fallo de P5, P6 y P7, por cuarta vez.

### Pendiente

- **El rendimiento del ÍTEM sigue sin confirmarse contra el Excel**, y ahora importa más: afecta al `consumo_teorico` que P8 ya publica
- **El coste de armar el contexto no tiene medición propia.** Es lo primero que P9 debería medir: el consolidado lo multiplica por el número de ubicaciones
- El **estado del período** en el consolidado de P9
- **Leer `audit_log`** — P11
- D4 (`LNK`) sigue en 🔴

---

## P7 — Períodos · conteo físico · 2026-09-04

**Objetivo:** poder cerrar un mes y compararlo con el siguiente.

### Entregado

- **El período es de una UBICACIÓN**, no de la company: el conteo se hace por ubicación (R2) y el cierre ocurre al cargarlo, así que un período de company obligaría a que las diez ubicaciones de una cadena contaran el mismo día
- **La frontera del mes se guarda como dos instantes**, resueltos una sola vez al abrirlo. `occurred_at` es absoluto y su mes depende de la zona horaria: las 02:00 UTC del 1 de abril son marzo en Guayaquil. Con la frontera escrita, cambiar la zona algún día **no mueve de mes movimientos ya cerrados**
- **La ausencia de fila es el estado abierto.** Exigir abrir el mes pararía el sistema solo el día 1 de cada mes
- **Un mes cerrado no admite movimientos, y la garantía está en la base**: trigger `BEFORE INSERT` sobre el libro, más la guarda `exigirLibroEscribible` que las cinco escrituras comparten. **Alcanza a la corrección**, que conserva la fecha del original (R3)
- **Reapertura solo del `OWNER`**, con motivo obligatorio y evento `period.reopened`
- **El conteo NO ajusta el libro.** Emitir un `AJUSTE` por la diferencia haría que `diferencia = conteo − teórico` (SPEC §18) diera cero siempre: el hallazgo desaparecería en el mismo acto de registrarlo
- **Conteo parcial (D7) con su cobertura**, medida sobre el **valor** y no sobre el número de ítems. **Un ítem sin contar vale su teórico, no cero** — valorarlo en cero equivaldría a declararlo consumido entero
- **Confirmar congela** el stock teórico y el costo de cada línea, y materializa una línea por cada ítem con saldo. La conciliación de un mes cerrado pasa a ser **una lectura**: 500 filas en 0,165 ms
- **`CONSUMO_REAL` de SPEC §16** —`inicial + compras − final físico`— encadenado mes a mes, con la cobertura pegada. Es la mitad física del food cost real; la otra necesita las unidades vendidas, que son de P8
- **`BODEGA` cuenta y no concilia**: `count.write` sí, `count.read` no. La hoja lista **todos** los ítems almacenables tengan saldo o no, para que el conteo sea ciego de verdad — que es lo que SPEC §4 pide y lo que mejora la calidad del dato
- **`shared/infrastructure/config/periods.ts`**: la zona horaria del calendario contable, como configuración versionada (D6, D11)
- **ADR-010** con las nueve decisiones que el SPEC no escribe
- **659 pruebas**: 413 unitarias con la base apagada, 246 de integración
- **El presupuesto medido**: `GET /conteos/:id` p95 **88,4 ms** contra 300, con 500 ítems; y `POST /inventario/movimientos` **52,3 ms** con 240 períodos cerrados en la tabla

### Lo que se descubrió por el camino

**INC-013, encontrada escribiendo una prueba del propio paquete.** Una compra fechada `2026-09-01T00:00:00Z` se rechazó por un período que nadie había cerrado: en Guayaquil eran las 19:00 del 31 de agosto. **Las cinco primeras horas UTC de cada día 1 pertenecen al mes anterior.** Es exactamente el fallo que P7 existe para prevenir, visto desde dentro. La prevención automatizada es una prueba de propiedad —doce meses en tres zonas horarias, una de ellas sin DST— y la del dato de prueba es una convención (`12:00Z`), porque una regla de `audit:forbidden` daría falsos positivos y se desactivaría en una semana.

**`migrate:verify` paró el `down.sql` el primer día.** No se puede soltar una función mientras un trigger vivo la use, y los triggers caen con sus tablas, que se borran **después** del bloque manual. No se registró como incidencia porque su prevención ya existía y funcionó.

**La siembra del test de rendimiento chocó contra su propia garantía**, ejecutando como dueño de la tabla: el trigger `physical_count_line_solo_en_borrador` no distingue roles. Hay que sembrar en `BORRADOR` y confirmar al final — el mismo orden que el repositorio se ve obligado a seguir.

**Nadie puede leer `audit_log`, ni siquiera el dueño de la tabla.** Se quiso comprobar que `period.reopened` guarda su motivo y no se pudo: `FORCE ROW LEVEL SECURITY` sin política de `SELECT` para ningún rol, que es lo que SEGURIDAD.md §10 pide. Los eventos de P0 a P7 se escriben y **su contenido no está verificado por ninguna prueba**. Queda con nombre para **P11**.

### Lo que el guardián 3 enseña

Valorar en **cero** lo que nadie contó rompe **3 pruebas de 659**. Sigue en verde la diferencia por línea, el cierre, los permisos, las cinco de confidencialidad — y, sobre todo, **la cobertura, que sigue diciendo 50 %**. El indicador que existe para avisar de que un conteo parcial no se lee como uno completo **no detecta esto**. Y el número que cambia es plausible: `consumo_real` pasa de −3,00 a +17,00.

Tercera vez que aparece la misma forma de fallo: P5 con R7, P6 con el saldo, P7 con la cobertura. **Un invariante agregado que se cumple tapando un desglose que no.**

### Pendiente

- **La tabla de unidades vendidas**, que P8 necesita para `venta_neta_mes` y con ella el food cost real completo
- El estado del período **en el consolidado de P9**: puede estar sumando meses cerrados con meses abiertos, y tiene que decirlo
- **Leer `audit_log`** — P11
- D4 (`LNK`) sigue en 🔴, y sigue sin bloquear nada

---

## P6 — Inventario · libro mayor append-only · 2026-09-04

**Objetivo:** saber cuánto hay y por qué, sin poder mentir.

### Entregado

- **`inventory_movement` append-only en tres capas** —privilegio, trigger de sentencia y `audit:forbidden`— con los **siete** tipos del SPEC §7. Extendido a `inventory_transfer` e `inventory_production`, que son cabeceras de hechos ya escritos
- **El saldo es `SUM(quantity)`, no un campo.** No existe `inventory_balance`, y era lo previsto: R3
- **La cantidad lleva signo, y lo garantiza la base.** `CHECK` que cruza dirección con signo, más **clave foránea compuesta `(type, direction)`** para que la dirección no pueda discrepar de su catálogo — sin ella, declarar `('COMPRA','SALIDA')` colaría una cantidad negativa
- **Transferencias como par atómico** que **suma cero por construcción**: la entrada es `salida.negated()`, no una comprobación que alguien pueda quitar
- **Producción con R10 entera**: el alta al costo **estándar**, el costo **real** del lote al lado, y la varianza. Efecto buscado: la suma de los importes de los movimientos `PRODUCCION` de un lote **es** la varianza
- **Corrección de signo contrario que CONSERVA el tipo**, para que `compras_del_mes` (SPEC §16) se cancele sola. Es la única excepción a la regla de signos, acotada en el `CHECK` a `reverses_movement_id IS NOT NULL`
- **El interruptor de stock, conmutable** (`llevaStock` en `catalog`): con stock propio se consume la preparación; sin él, al vender se explota su receta
- **`BODEGA` escribe el libro y no puede leerlo**: `inventory.read` no se le concede, y **ninguna escritura devuelve el saldo resultante** — con él despejaría la receta (§4.3)
- **`exigirUbicacionEnAlcance` se muda de `recipes` a `iam`**, que es su sitio: es autorización de sesión
- **El presupuesto medido**: p95 **60,8 ms** contra 300, con 500 ítems y 1,2 millones de movimientos en la tabla, y los planes verificados
- **ADR-009** con las cinco decisiones que el SPEC no escribe
- **596 pruebas**: 383 unitarias con la base apagada, 213 de integración

### Lo que se descubrió por el camino

**Novena recurrencia de INC-007, y la cazó la regla que dejó escrita la octava.** Al forzar el guardián de las dos reglas append-only nuevas, falló en **2 sitios cuando debía fallar en 4**. El glob `prisma/migrations/**/*.sql` está anclado a la raíz y las migraciones viven en `apps/api/prisma/...`: **desde P0, `no-select-star` y `append-only-sql-audit_log` no habían examinado una sola migración.** El contador del informe pasó de 189 a 203 archivos, que es la medida de que el arreglo hizo algo.

**La prueba del plan de ejecución no medía nada al principio.** Con una sola ubicación en la tabla, `Seq Scan` es la elección correcta —la tabla entera es el resultado— y la prueba fallaba por un motivo ajeno al índice. Se arregló sembrando 19 ubicaciones de ruido. Misma lección de INC-007, aplicada a un dato en vez de a un glob.

**El mismo número salía con dos formas:** `_sum` de Prisma devuelve `"8.5"` y leer la columna devuelve `"8.500000000000"`. Todo pasa ahora por la escala de almacenamiento, que además permite comparar el `SUM` de PostgreSQL con el pliegue del dominio sin normalizar nada.

**INC-012 no reapareció, aunque `ESTADO.md` la daba por segura en este paquete.** Los triggers append-only resultaron inalcanzables desde la API —no existe ruta que edite un movimiento, y lo sostiene `audit:forbidden`, no la disciplina de nadie— y **M11 paró la primera migración a la que se enfrentó**, obligando a clasificar las 18 restricciones antes del primer endpoint.

**El guardián 3 enseña más por lo que no rompe.** Emitiendo la corrección como `AJUSTE` fallan 3 pruebas de 74, y siguen en verde el saldo, la reconstrucción del libro y el criterio de aceptación de P6. Lo único que lo caza es la agregación por tipo. Es la misma forma de fallo que R7 en P5: un invariante que se cumple tapando uno que no.

### Pendiente

- **La tabla de unidades vendidas.** P6 registra la *consecuencia* de una venta sobre el stock, no la cifra de ventas: son datos distintos, con períodos distintos. La necesita P8
- **El semáforo `REPONER`/`OK` para `BODEGA`** llega en P8, con el punto de reorden de SPEC §18. Los permisos ya están repartidos para que sea el único dato que reciba
- **El rendimiento por lote de una subpreparación**: se decidió **no** añadir columna. La receta ya es por unidad de uso y producir 5 litros es `receta × 5`. Es aditiva si el usuario la quiere
- **La explosión del consumo no aplica el rendimiento**, siguiendo SPEC §4.3. Anotado como duda: afecta al stock teórico de P8

---

## P5 — Motor de costeo · 2026-09-04

**Objetivo:** el cálculo correcto, demostrable y sin base de datos.

### Entregado

- **El motor, en `costing/domain`**: costeo del producto (SPEC §14 entero), cascada de subpreparaciones y costo de combos. **45 pruebas con PostgreSQL apagado**
- **`docs/pruebas/casos-conocidos.md` completo**: CC-004 (AP frente a EP), CC-005 (cascada), CC-006 (combo), CC-007 (IVA no recuperable) y CC-009 (los cuatro bordes) — **escritos antes de tocar el motor**, como el plan exige
- **R6 cierta por construcción**: se divide una vez y el margen es el complemento, así `mc% + food_cost% = 1` no depende de que dos redondeos no caigan a la vez en un empate
- **R10, R12 y R14 activas** · **R4 aplicada** con los dos casos dando números distintos
- **R7 a través del motor**, no con valores transcritos: `0.00` con canario a `1e-6`
- **`GET /costeo`** y **`GET /costeo/:productId`**, con permiso `costing.read` que **`BODEGA` no tiene** (§4.3, comprobado sobre la respuesta cruda)
- **El empaque es un ítem** (`product.packaging_item_id`), no una tabla propia — **ADR-008**
- **El presupuesto de rendimiento, medido**: p95 **136,8 ms** sobre 200 productos y 1.600 líneas, contra 400 de presupuesto, con los planes de ejecución verificados
- **505 pruebas**: 343 unitarias con la base apagada, 162 de integración

### Lo que se descubrió por el camino

**R7 no detecta un costo equivocado.** Al invertir R4 fallan 12 pruebas y **ninguna es CC-R7**: la conciliación es una identidad algebraica y el costo aparece en sus dos lados. Detecta deriva y términos que faltan; no detecta un número mal calculado. Lo que caza eso son los casos conocidos, y por eso sus valores salen del Excel.

**Dos restricciones de la base salían como 500** — un producto activo sin PVP y un precio sin artículo. La base garantizaba; el dominio no explicaba. **INC-012**, con las dos guardas añadidas y **M11** en `audit:migrations` para que no vuelva.

**Octava recurrencia de INC-007, con el mismo carácter que la séptima.** La regla nueva marcaba 3 migraciones de 5 porque su `` era un retroceso literal. La destapó preguntarse **cuántas** deberían fallar, no si fallaba. Prevención: `sin-caracteres-de-control` en `audit:forbidden` — la primera de INC-007 que impide que el fallo se escriba.

**La documentación de API y del modelo de datos se había quedado en P2.** P3 y P4 dieron H4 por bueno sin estarlo. Los tres tramos se escribieron en este commit.

### Pendiente

| Qué | Cuándo |
|---|---|
| El rendimiento por lote de una subpreparación: hoy la receta va por unidad de uso | **P6.** Merece confirmarse antes |
| Menu engineering y las demás vistas (SPEC §15–§18) | P8 |
| R7 con dataset completo: compras reales y conteo físico | P8 |
| Previsualizar qué platos se mueven al confirmar un precio | P8 |

---

## P4 — Recetas, productos y combos · 2026-09-04

**Objetivo:** que un ciclo se rechace al guardar y que propagar entre locales sea una decisión con marcha atrás.

### Entregado

- **12 tablas**: `product`, `product_location`, `combo_component`, `recipe` versionada, `recipe_line`, el registro de propagación y cinco catálogos
- **R9 activa** — ciclos rechazados **al guardar**, directos y a tres niveles, con el camino (`mayonesa → salsa → mayonesa`) en el mensaje. Recorrido memorizado que corta al primer ciclo
- **R11 activa** — previsualización con cuántas ubicaciones perderían su receta, permiso separado de nivel company, registro de quién propagó qué, y **reversión por local que no borra nada**
- **R4 modelada y probada** — la base AP/EP con los dos casos dando resultados **distintos y conocidos**
- **E12 pasa a regla activa** — `BODEGA` no ve recetas, comprobado sobre la respuesta cruda
- **ADR-007** — propagación por copia frente a herencia
- **444 pruebas**: 298 unitarias con la base apagada, 146 de integración

### Lo que se descubrió por el camino

**Un error de dominio que no lo era.** `CicloEnRecetaError` extendía `Error` a secas y salía por el filtro como `INTERNAL_ERROR` 500 —un fallo del servidor— cuando lo que hay es una receta mal escrita. El `Record` exhaustivo de códigos hace su trabajo solo si el error entra por la puerta.

**Los parámetros de consulta entraban sin validar.** `GET /recetas` empezó con cinco `@Query` sueltos y `max-params` lo marcó. La solución no fue agruparlos: se les puso **esquema**, igual que a un cuerpo. Un parámetro de URL es entrada no confiable exactamente igual.

### Pendiente

| Qué | Cuándo |
|---|---|
| El cálculo del costo del producto (SPEC §14) | P5 |
| Componentes de combo por API | Sin paquete: la tabla y sus reglas existen, el endpoint no |
| Lista blanca de knip para `shared/domain/**` | P5, y **P5 no cierra con ella puesta** |

---

## P3 — Precios de referencia con vigencia · 2026-09-04

**Objetivo:** ningún precio se mueve solo.

### Entregado

- **`reference_price` con vigencia**, nunca sobrescritura (R5). El precio cuelga del **artículo de compra**, porque «2.30» no significa nada sin «el saco de 2 kg»
- **La cadena de costo del insumo de SPEC §12, completa y como dominio puro** — precio neto, costo bruto de uso, costo neto de uso y sobrecosto de merma, con las dos guardas de cero del SPEC. **P5 la puede usar tal cual**
- **Los parámetros de costeo de D3**, sembrados por un trigger al nacer la company. Ninguno está en el código
- **R5 hecha cumplir en cuatro capas**: el estado, dos permisos separados, un trigger que impide reescribir el importe, y la condición en el `WHERE` que cierra la carrera entre dos confirmaciones simultáneas
- **408 pruebas**: 277 unitarias con la base apagada, 131 de integración

### Los tres criterios, probados

**E8** — se confirma un precio de enero, se lee el costo de febrero, se confirma uno de marzo, y el costo de febrero es el mismo. **E9** — un precio sugerido existe, se ve, y el costo devuelve 404 hasta que alguien lo confirma. **E20/R13** — sin IVA recuperable el costo sube exactamente 1.15 veces, ni un dígito más.

### Lo que se descubrió por el camino

**`migrate:new` dependía de la base de desarrollo de cada quien.** `prisma migrate dev` es interactivo y se planta ante cualquier aviso —dos de ellos espurios en este paquete—, y peor: mira los **datos** de la base local para decidir si avisa. Se cambió a `migrate diff`, que produce el mismo SQL, no es interactivo y compara `prisma/migrations` con el modelo. La misma técnica que el paso del `down` ya usaba por la misma razón.

**Una prueba de la base pasaba sin tocar nada.** «Un precio confirmado no se puede reescribir» lanzaba el `UPDATE` sin tenant: RLS filtraba, cero filas, y `UPDATE 0` es un éxito — el trigger nunca se disparaba. Es INC-007 en otra forma. Ahora la escritura va por `TenantTransaction` y la afirmación es sobre el importe guardado, no sobre el mensaje que Prisma envuelve.

**La regla del catálogo escrita en P2 hizo su trabajo en P3.** `pricing` necesitaba el rendimiento del ítem y el primer intento consultó `tx.item` a mano; `tablas-de-catalogo-solo-en-catalog` lo marcó, y se resolvió como manda CLAUDE.md §2 — `catalog` exporta `LeerItem`.

### Una decisión que merece confirmación

**La tasa de IVA de compra se modeló en el PRECIO, no en la company.** El SPEC la nombra en la fórmula de §12 pero no dice dónde vive, y §11 solo trae «recuperable SI/NO». En Ecuador el alimento sin procesar es 0 % y el detergente 15 %: una única tasa por company estaría equivocada para uno de los dos. Se eligió el superconjunto — si la intención era una sola tasa, este modelo la expresa; al revés habría que migrar cada precio.

### Pendiente

| Qué | Cuándo |
|---|---|
| Sugerencia automática desde la compra real (`ULTIMA_COMPRA`) | P6, cuando exista el movimiento que la dispara |
| El rendimiento con vigencia | Sin paquete: hoy el costo histórico usa el rendimiento actual del ítem |
| Lista blanca de knip para `shared/domain/**` | P5, y P5 no cierra con ella puesta |

---

## P2 — Catálogo: ítems, artículos de compra, unidades · 2026-09-04

**Objetivo:** la fuente única de verdad del proyecto.

### Entregado

- **Ocho tablas**: `unit` (global, de solo lectura para la aplicación), sus catálogos, `item_group`, `item` y `purchase_article`, todas con RLS `ENABLE` + `FORCE`
- **El factor de conversión se CALCULA, no se captura** — se deriva cuando la presentación y la unidad de uso comparten dimensión, se exige cuando no, y se **rechaza** cuando es derivable
- **La fuente única de verdad, hecha cumplir por dos vías**: `audit:arch` impide importar la infraestructura de `catalog`, y `audit:forbidden` impide tocar sus tablas desde cualquier otro sitio
- **Índice GIN + `pg_trgm`** sobre `lower(name)` para la deduplicación de P10, como índice de expresión y no como columna generada
- **371 pruebas**: 253 unitarias con la base apagada, 118 de integración

### Deuda pagada

**La excepción `enmiendasAutorizadas`** de `sin-migracion-commiteada-modificada` está retirada, tal como se había escrito en P1. La lista está vacía y la regla sigue midiendo — con su prueba del guardián.

### Lo que se descubrió por el camino

**M10 marcaba un borrado legítimo.** El `down` de P2 retira las capacidades `catalog.*` de `permission`, a las que solo apunta `role_permission`, que se vacía en la sentencia de al lado. La primera versión marcaba **todo** borrado sobre una tabla que sobrevive, y eso habría empujado a abrir una lista de excepciones por migración — el patrón que INC-011 y `no-sql-interpolado` ya enseñaron que envejece mal. Ahora M10 **lee las claves foráneas** y solo marca cuando alguien que apunta a esa tabla no se vacía ni se suelta en el mismo archivo. Sigue cazando el caso original.

**El código de dominio `CONFLICTO` volvió**, retirado en P1 por no tener consumidor. El `Record` exhaustivo del filtro obligó a mapearlo antes de compilar, que es exactamente para lo que está.

### Desviación del plan, consciente

**No existe la tabla `unit_conversion`** que los entregables listaban. Entre unidades de la misma dimensión sus filas serían derivables del cociente de `factor_to_base`; entre dimensiones distintas —«un huevo pesa 50 g»— la conversión no es universal sino **del ítem**, y por eso vive en `purchase_article.conversion_factor`. Una tabla global entre `unid` y `g` afirmaría que todos los huevos pesan lo mismo.

### Pendiente

| Qué | Cuándo |
|---|---|
| Plegado de acentos en la deduplicación | P10, en la consulta |
| Unidades propias por company | Sin paquete; hoy se modelan como presentación del artículo |
| Lista blanca de knip para `shared/domain/**` | P5, y P5 no cierra con ella puesta |

---

## P1 — IAM · tenants · ubicaciones · roles · 2026-09-04

**Objetivo:** que el aislamiento funcione antes de que exista un dato de negocio.

### Entregado

- **Las tres barreras de CLAUDE.md §4.1, completas y probadas.** 14 tablas con RLS `ENABLE` + `FORCE` y 29 políticas; un envoltorio único de transacción-con-tenant; el tenant saliendo de la sesión y de ningún otro sitio
- **Login completo** — política anti fuerza bruta con dos ventanas y umbral distinto por eje, Argon2id con tiempo constante frente a correos inexistentes, sesión con token opaco de 256 bits hasheado en base, rotación al iniciar y revocación total al cambiar contraseña
- **Autorización deny-by-default** — guard global, capacidades en vez de roles rígidos, escalada vertical y horizontal probadas
- **Ubicaciones, invitación de usuario y asignación de roles**, con el límite del plan resuelto dentro de la transacción que inserta
- **Invitación de punta a punta sin una sola credencial real**, usando el adaptador falso de correo que P0 dejó cableado
- **`audit:deps`**, el duodécimo check: acepta avisos uno a uno con motivo y fecha de revisión, y rompe ante cualquiera que no esté en la lista
- **ADR-006** · **INC-010** e **INC-011** · modelo de datos, seguridad, configuración y superficie de API actualizados

### D12 cerrada del todo

**Las cuatro condiciones verificadas**, incluida la que podía obligar a reabrir la elección de ORM: PgBouncer 1.25.2 en modo transacción, con `default_pool_size = 1` para que la reutilización de conexión entre clientes sea segura y no probable. Detalle en ADR-006.

### Lo que se descubrió por el camino

**El repositorio de auditoría de P0 no había funcionado nunca** ([INC-010](incidencias/INC-010-returning-bajo-rls-exige-politica-de-select.md)). `create()` de Prisma emite `INSERT ... RETURNING`, y bajo RLS el `RETURNING` pasa por la política de `SELECT`. Se descubrió al escribirle su primera prueba de integración: **un repositorio sin prueba de integración no está verificado**, por evidente que parezca su código.

**Un `down.sql` que `migrate:verify` daba por bueno fallaba en la base real** ([INC-011](incidencias/INC-011-el-down-solo-se-probaba-en-base-vacia.md)), porque `migrate:verify` corre sobre bases **limpias** donde ninguna fila referencia nada. Y la guarda `NOT EXISTS` que se añadió para arreglarlo tampoco servía: bajo RLS, «no hay filas» y «no puedo verlas» son la misma respuesta. Prevención: comprobación **M10**.

**M10 entró en verde sin medir nada** — séptima recurrencia de [INC-007](incidencias/INC-007-un-check-pasa-en-verde-sin-medir-nada.md), cazada por la prueba del guardián en el mismo minuto.

**El limitador de peticiones no tenía ninguna prueba**, y P0 ya lo listaba como pendiente. Ahora la tiene — y hubo que escribirla dos veces, porque el primer intento acabó midiendo el **otro** mecanismo que devuelve 429: el bloqueo por fuerza bruta.

**El bloqueo por IP habría dejado fuera a restaurantes enteros.** Aplicando literalmente el umbral de SEGURIDAD.md §2.1 a los dos ejes, cinco errores repartidos entre cinco empleados detrás del mismo NAT bloquean el local completo durante una hora. Se separó: 5 por cuenta, 25 por IP.

También se **afinó** `no-sql-interpolado` en la dirección estricta: ahora distingue la plantilla etiquetada de Prisma —la forma segura, que antes marcaba— y **la única exención por archivo del repositorio desapareció**. Más `no-prisma-raw` para el único hueco que quedaba.

### Pendiente

| Qué | Cuándo |
|---|---|
| Refresh rotativo con detección de reuso (SEGURIDAD.md §2.2) | P12, cuando exista el cliente que pueda rotarlo |
| Limitador en memoria → Redis | P15 |
| Excepción `enmiendasAutorizadas` de `sin-migracion-commiteada-modificada` | P2 |
| Lista blanca de knip para `shared/domain/**` | P5, y P5 no cierra con ella puesta |
| Cesión de propiedad (`OWNER`) | Sin paquete asignado; la puerta está cerrada |
| `EXPLAIN ANALYZE` con volumen sintético realista | P5 |

**329 pruebas en verde** · 227 unitarias con la base apagada, 102 de integración.

---

## P0 — Fundación del repositorio · 2026-08-27

**Objetivo:** que escribir código malo sea difícil. P0 no implementa negocio: implementa las condiciones para que el negocio se escriba bien.

### Entregado

- **`npm run audit` con once verificaciones**, en CI y en pre-commit: tipos, lint, prohibiciones, capas, código muerto, complejidad, duplicación, migraciones, secretos, cabeceras de seguridad y pruebas
- **Tipos de dominio para dinero y cantidades** — `Money`, `Ratio`, `Count`, `Quantity` y `UnidadDeUso`, con marca nominal, `valueOf()` que lanza y API de comparación completa. 98 pruebas
- **Mini-conciliación R7** con tres productos reales del Excel de referencia. `ROUND(diff, 2) = 0.00`, con canario a `1e-6`
- **PostgreSQL 18.6 fijado por digest**, con dos roles separados: `costeo_migrator` (dueño) y `costeo_app` (sujeto a RLS, no superusuario). Verificado por 9 pruebas contra la base real
- **Migraciones reversibles** con `down.sql` generado y verificado por una escalera de cuatro pasos sobre bases reales
- **`audit_log` append-only en tres capas**, con RLS deny-by-default. 14 pruebas
- **Aplicación NestJS** — entorno validado por Zod, `correlation_id` por `AsyncLocalStorage`, `/health` y `/ready` separadas, cabeceras de SEGURIDAD.md §4.4 con nonce por respuesta, limitador, timeout, formato único de error y falsos de correo y almacenamiento
- **CI en GitHub Actions** con acciones fijadas por SHA, que levanta el stack completo y comprueba que responde **sin una sola credencial real**
- **ADR-001 a ADR-005** · **INC-001 a INC-009** · documentación de sistema, modelo de datos, configuración y despliegue

### Decisiones que cierran preguntas abiertas

- **D2 cerrada** (ADR-001): Node 24.20.0, PostgreSQL 18.6, NestJS 11.2.3, Prisma 7.10.0, Next.js 16.3.3, con sus fechas de fin de soporte verificadas en fuente oficial
- **D12 cerrada** (ADR-002): se mantiene Prisma. El RLS nativo existe solo en Prisma 8 RC y cubre la Barrera 1, **no la Barrera 2**

### Lo que se descubrió por el camino

**Seis checks pasaban en verde sin medir nada** — un parser ausente, un fixture en ruta excluida, un glob que dejaba fuera las pruebas, unos patrones de ignorar mal anclados, una clave de configuración que la herramienta ignora, y un guardián que solo cubría dos de las tres formas de abrir una conexión. Cuatro de los seis los encontró la prueba del guardián. Registrado en [INC-007](incidencias/INC-007-un-check-pasa-en-verde-sin-medir-nada.md).

**Una regla de seguridad fallaba abierto**: la comprobación de que `DATABASE_URL` usa el rol de la aplicación no se ejecutaba si otra variable era inválida. [INC-008](incidencias/INC-008-superrefine-no-corre-si-otro-campo-fallo.md), y la regla general está ahora en `CLAUDE.md` §3.

### Pendiente

| Qué | Cuándo |
|---|---|
| Prueba del limitador de peticiones — hoy no protege ninguna ruta | P1 |
| Barreras 2 y 3 del aislamiento | P1 |
| `CompanyId`, `LocationId`, `ItemId`, `ProductId` | P1–P4 |
| `UnitCost` | P3 |
| CC-004 (base AP frente a EP) — no se pudo extraer del Excel: las 293 líneas de T3 están todas en base EP | P5 |
| Generador `prisma-client-js` → `prisma-client` | Con la evaluación de Prisma 8 |
| Salto a Node 26 | Promueve a LTS el 2026-10-28 |

**174 pruebas en verde** · 128 unitarias con la base apagada, 46 de integración.
