# ADR-019 — La capa visual sale del manual, y el panel operativo va en claro

**Fecha:** 2026-09-08 · **Paquete:** P14 · **Estado:** aceptada

---

## Contexto

`CLAUDE.md` §10 declara `docs/Manual de Marca/platise-brand-book.pdf` **fuente
única** de la identidad visual, y es tajante sobre cómo se usa:

> Ningún color, tipografía, logo ni tratamiento gráfico se inventa, se
> «aproxima» ni se saca de otra referencia: sale del manual. […] **Si un valor
> no está en el manual, pregunta**; no lo deduzcas del resto de la paleta.

Hasta P14, `tokens.css` llevaba valores neutros a propósito —grises de Tailwind,
`system-ui`— para probar que la capa visual se podía reemplazar sin tocar
lógica. P14 es el paquete que la reemplaza.

El manual resultó ser mucho más específico de lo que el plan suponía. No es una
paleta con un logo: publica una tabla de **tokens** con columna clara y oscura,
una escala de espaciado de Fibonacci con el uso de cada término, cuatro niveles
tipográficos con tamaño e interlínea, **seis ratios de contraste calculados**, y
una página entera dedicada a qué lleva el panel operativo del producto.

---

## Cómo se leyeron los valores, y por qué importa

**No se leyeron de una captura de pantalla.** El PDF está exportado desde
Chromium, así que sus colores viven como operadores `rg` con cuatro decimales y
su tipografía como fuentes incrustadas con su `ToUnicode`. Se extrajeron los
flujos del archivo y se decodificaron.

La comprobación de que la lectura es correcta no es que «se parezca»: **los seis
ratios de contraste que el manual publica se recalcularon uno a uno y dan sus
mismas cifras**, hasta el segundo decimal.

| Combinación | Manual | Recalculado |
|---|---|---|
| Pizarra sobre Cloud Dancer | 14,58:1 | 14,58:1 |
| Jade sobre Cloud Dancer | 7,01:1 | 7,01:1 |
| Salvia sobre Cloud Dancer | 6,32:1 | 6,32:1 |
| Oxblood sobre Cloud Dancer | 7,14:1 | 7,14:1 |
| Cloud Dancer sobre Persimmon Profundo | 5,64:1 | 5,64:1 |
| Persimmon sobre Cloud Dancer | 3,93:1 | 3,93:1 |

Si un hex estuviera mal leído, alguno de esos seis no cuadraría.

---

## Decisión 1 — El panel operativo va en CLARO, y no lo decide el gusto

El manual publica una columna oscura de tokens **y aun así** dice esto en su
página de interfaz (p. 30):

> El panel operativo del producto va en modo claro: el usuario trabaja de pie,
> con reflejo y las manos ocupadas. Cuerpo de 16 px, área táctil de 44 px y
> contraste de 14,58:1. **Un panel oscuro con vidrio gana en portafolio y pierde
> al chef en la cocina. Esa es una decisión de producto, no de estética.**

Consecuencias, todas verificables en el diff:

- **No hay `prefers-color-scheme`.** La columna oscura es para la web y las
  piezas de marca. Enviarla como CSS que nadie activa sería código muerto.
- **No hay tokens de vidrio ni de sombra.** El manual acota el vidrio a «malla
  de gradientes» y **prohíbe** ponerlo detrás de una tabla densa porque baja el
  contraste del texto pequeño (p. 20). Esta aplicación es tabla densa entera.
- `color-scheme: light` está declarado, para que el navegador no oscurezca por
  su cuenta los controles nativos.

---

## Decisión 2 — El semáforo de food cost usa los tres significados del manual

`SPEC` §13 pide tres estados. El manual **no tiene verde-ámbar-rojo**, y eso no
es una carencia: tiene tres significados con su color.

| Estado | Color | Por qué, y su ratio |
|---|---|---|
| bien | Jade Ahumado `#1E5A4E` | Es el color de marca. 7,01:1 sobre el fondo |
| atención | Persimmon **Profundo** `#A8391A` | Persimmon significa «margen, alerta o extremo» (p. 25) |
| mal | Oxblood `#8C2F39` | El manual lo llama literalmente «pérdida». 7,14:1 |

**El detalle que decide esto es que Persimmon vivo NO es color de texto.** Con
3,93:1 reprueba, y el manual lo dice antes de que a nadie se le ocurra usarlo:

> Los que reprueban son la regla, no el error: Persimmon es color de señal, no
> de texto. Y **el color de la pérdida nunca es el color del botón**.

El manual no publica el ratio de Persimmon Profundo, que es la variante que este
sistema necesitaba para texto. **Se calculó: 5,64:1 sobre Cloud Dancer y 6,43:1
sobre blanco, AA en los dos casos.** Persimmon vivo se usa solo como señal —la
cinta de 3 px al costado de una fila—, nunca como texto.

Y la advertencia se respeta: la pérdida es Oxblood y el botón es Persimmon
Profundo. Son colores distintos y lo siguen siendo.

---

## Decisión 3 — Fraunces NO se sirve en la aplicación

El manual asigna tres familias, y las tres son SIL OFL. La aplicación sirve dos.

Fraunces es el nivel **Display**, cuyo uso declarado es «Aperturas» con tamaños
de **66 a 172 px**. La página de interfaz, que es la que dice qué lleva el panel
operativo, no la usa: fija cuerpo Inter de 16 px y cifras en Plex Mono. Los
cuatro niveles del manual —Display, Cuerpo, Cifra, Etiqueta— no tienen un nivel
para «título de pantalla de trabajo», así que el título cae en Cuerpo.

Traerla para usarla a 24 px sería **inventar un tamaño que el manual no
contempla**, que es exactamente lo que §10 prohíbe. Y son 124 kB en una conexión
que el propio manual describe como mala.

**Es reversible en diez minutos** si el usuario prefiere lo contrario: es
añadir una familia al generador de `tipografia.css` y una regla al título.

---

## Decisión 4 — Las fuentes se autoalojan, no se piden a Google

`next/font/google` no era una dependencia nueva —viene con Next— y aun así se
descartó:

1. **Descarga en tiempo de build.** El frontend todavía no tiene cadena de
   despliegue escrita; no conviene que nazca dependiendo de tener salida a
   internet para construir.
2. **El navegador del cliente no le pide nada a un tercero.** La CSP se queda en
   `self` y nadie fuera ve quién entra al sistema. En un proyecto con un
   `docs/SEGURIDAD.md` entero, mandar la IP de un dueño de restaurante a un CDN
   por una tipografía es una fuga pequeña y evitable.

Van los subconjuntos `latin` y `latin-ext`, que es lo que el español necesita:
**185 kB en total, de los que un navegador español baja unos 90**.

**Se verificaron las licencias que el propio manual declara como pendientes**
(p. 36: «Fraunces, Inter e IBM Plex Mono bajo SIL Open Font License. **No
verificado a esta fecha**»). Las dos que se sirven llevan su OFL 1.1 completa
junto a los archivos, descargada del repositorio oficial de cada familia, con la
cabecera comprobada. Está en `apps/web/public/fuentes/LICENCIAS.md`.

---

## Decisión 5 — El logotipo se EXTRAJO del PDF, no se redibujó

El manual dice que el logotipo «no se compone con una fuente: se dibuja con las
reglas del isotipo», y publica esas reglas como fórmulas. Redibujarlo a partir
de las fórmulas habría sido una interpretación, y una interpretación de un logo
es un logo distinto.

En vez de eso se sacaron **las curvas de Bézier del propio PDF**. La prueba de
que la extracción es fiel es que la geometría reproduce la tabla de construcción
del manual sin que se le impusiera:

| Medida del manual | Fórmula | Valor | En el trazado extraído |
|---|---|---|---|
| Ancho total | `H / φ` | 61,803 | caja de 61,803 × 100 |
| Grosor de trazo | `R − R/φ` | 11,803 | `/LW 11.8030005` en el estado gráfico |
| Radio vertical | `(H/φ − t)/2` | 25,000 | `ry` de la panza |
| Radio horizontal | `ry × 1,07` | 26,750 | `rx` de la panza |
| Ángulo de rotura | `−90 + 180/φ²` | −21,25° | punto medio del hueco: −21,24° |
| Remates | redondos | — | `/LC 1 /LJ 1` |

También salió de ahí un dato que ninguna prosa dice: **el punto de la `i` va
relleno, no trazado** — el archivo cambia de estado gráfico justo antes de
dibujarlo.

Se sirven como `.svg` estáticos, no en línea, para que el navegador los cachee
una vez y no viajen dentro del HTML de cada pantalla.

---

## Decisión 6 — El nombre del producto es Platise, y cierra D1

`DECISIONES.md` D1 llevaba desde P0 con el valor provisional «Costeo» y este
motivo: *«No hay nombre comercial definido. No inventar branding.»*

El manual se titula **Manual de marca PLATISE** y cierra con «PLATISE · MANUAL DE
MARCA V3.0 · AGOSTO 2026». El nombre estaba definido desde antes de que
empezara este proyecto; lo que faltaba era abrir el archivo. Usarlo no es
inventar branding: es leerlo, que es lo que §10 manda.

---

## Lo que cuesta, dicho sin adornos

- **La retícula del manual es de LÁMINA, no de aplicación.** `--f6` (144 px) es
  su «margen lateral», pensado para una lámina de 1600 × 900. Aplicado a la
  barra de una aplicación a 1280 px, deja la navegación sin sitio y **la parte en
  dos filas** — se vio en una captura. La lámina usa `--f3`. La regla del manual
  («toda medida sale de la serie de Fibonacci») se respeta; el término se elige
  según el lienzo.
- **El manual no publica color de borde ni radio de esquina**, porque sus piezas
  son láminas y no tienen ni una cosa ni la otra. El borde fino es Salvia al
  16 %, que es la opacidad que el manual sí publica (tramas del 10 al 16 %,
  borde de vidrio al 16 %); los radios son los dos términos de Fibonacci
  anteriores al primero que publica. **Las dos derivaciones están escritas al
  lado del token**, para que la próxima persona sepa de dónde salieron.
- **No hay pruebas automatizadas de la capa visual.** Lo que hubo fue medición
  con navegador: se rasterizó el logotipo, se capturaron las pantallas y se midió
  `scrollWidth` contra `clientWidth` a 320 px. Es lo que encontró el problema de
  la barra en dos filas, y es lo que descartó un desbordamiento que parecía real
  y no lo era.
