# ADR-020 — El armazón de la aplicación cliente: grupo de rutas, permisos que no se adivinan y el mes en la URL

> Architecture Decision Record. Vive en `docs/decisiones/ADR-020-el-armazon-de-la-aplicacion-cliente.md`. **Inmutable una vez aceptado**: si la decisión cambia, se escribe un ADR nuevo que lo reemplaza.

**Fecha:** 2026-09-13 · **Paquete:** P16 · Armazón (pantalla 1) · **Estado:** aceptada · **Decisores:** Usuario (U1, U2) / Claude Code (D-16.5, D-16.6, D-16.131…D-16.144)

---

## Contexto

Hasta el armazón, `apps/web` eran cinco páginas sueltas con una barra de enlaces fija, y cada una
comprobaba por su cuenta si había sucursal, leía el mes con `getUTCMonth()` y repetía el mismo
`useCallback` + `useEffect` + tres `useState`. Por delante hay treinta pantallas más (U1: «como
Commerce»: barra lateral por grupos, sección por entidad, listado → alta → ficha → edición).

Lo que había que decidir antes de la primera pantalla nueva, porque cambiarlo después es tocar las
treinta:

1. dónde vive lo que comparten todas las pantallas autenticadas y lo que no comparten las públicas;
2. de dónde sale lo que un usuario puede ver, y qué se pinta mientras no se sabe;
3. dónde vive el mes que se está mirando;
4. qué forma tiene la navegación en un teléfono, que es donde se cuenta y se cargan ventas.

---

## Decisión 1 — Un grupo de rutas `(app)` con su propio `layout`

`src/app/(app)/layout.tsx` envuelve **toda** la aplicación autenticada: `ProveedorDePermisos` →
`Suspense` → `Armazon` (cabecera, barra lateral y lámina). Las rutas públicas —`/entrar`,
`/sucursal`, y las que vendrán: `/activacion`, `/olvide`, `/restablecer`— quedan **fuera** del grupo,
y ahí no se pide la sesión ni se pinta la barra.

El paréntesis no aparece en la URL: `/costeo` sigue siendo `/costeo`. Las cuatro páginas existentes
se movieron con `git mv` para conservar su historia.

**`Suspense` no es opcional.** El mes se lee con `useSearchParams`, y en una página que Next genera
estática eso exige un límite de suspensión o `next build` falla.

| Alternativa | Por qué no |
|---|---|
| Un `Marco` que cada página pinta, como hasta ahora | Es la copia que ya existía: la guardia de sucursal, la barra y «salir» en cada página. La trigésima que lo olvide no tiene barra |
| Middleware de Next que redirija sin sesión | La sesión es una cookie `HttpOnly` que valida la API, no Next. Un middleware tendría que llamar a la API en cada navegación o fiarse de la mera presencia de la cookie, que no dice nada |

## Decisión 2 — Los permisos salen de `GET /auth/sesion`, una vez, y cerrados por defecto

`ProveedorDePermisos` pide `GET /auth/sesion` al montar el armazón y guarda en memoria el conjunto de
`permisos` (y, de paso, el token anti-CSRF). **Nada se deduce del rol**: el frontend no sabe qué
puede un `GERENTE_LOCAL`, sabe qué capacidades trae la sesión.

- **Mientras no han llegado, `tiene()` responde que no** (D-16.6, fail-closed): la barra empieza
  vacía y se llena; nunca empieza llena y se recorta.
- **Cada sección declara su permiso en su `layout.tsx`, en una línea**:
  `export default seccion('costing.read')`. La fábrica `seccion` existe para no escribir treinta
  componentes de ocho líneas idénticos, que es el clon que `audit:duplication` para.
- **Sin permiso, un estado en sitio, no una redirección**: quien abre un enlace que no puede ver
  entiende por qué no ve nada. Mandarlo a otra pantalla le quita el contexto.
- **Mientras los permisos cargan, la sección no se pinta**, así que ninguna pantalla lanza su
  lectura antes de saber si puede.

**Y esto refleja la autorización, no la implementa** (CLAUDE.md §10). La frontera es el 403 de la
API; esconder un enlace no protege nada, y una URL escrita a mano recibe el mismo estado en sitio.
Capturado con el rol `BODEGA`: la barra solo tiene «Inventario y conteo», y `/costeo`, `/menu` y
`/ventas` escritas a mano enseñan «Tu usuario no tiene acceso a esta pantalla».

| Sección | Permiso | Grupo |
|---|---|---|
| `/costeo` | `costing.read` | Análisis |
| `/menu` | `analytics.read` | Análisis |
| `/ventas` | `sales.read` | Operación diaria |
| `/inventario` | `count.write` | Operación diaria |

El registro vive en `componentes/armazon/navegacion.ts`: la barra lateral y la cabecera leen de ahí
qué secciones hay, en qué grupo y cuáles trabajan sobre un mes.

## Decisión 3 — La sesión que se cae a mitad de uso manda a entrar, desde un solo sitio

`lib/api.ts` avisa cuando una respuesta trae `SESION_INVALIDA` —y solo ese código: el login fallido
también es 401 (`CREDENCIALES_INVALIDAS`) y mandar a entrar a quien está entrando sería un bucle—.
Quien sabe navegar registra qué hacer con `useEntrarAlCaducar()`: el armazón, y `/sucursal`, que
vive fuera de él.

`alCaducarSesion(manejador)` **devuelve cómo quitarlo, y solo quita el suyo**: al pasar de
`/sucursal` al armazón, el que se desmonta no debe borrar el que acaba de registrar el otro.

## Decisión 4 — El mes vive en la URL, con dos `select`

`?anio=2026&mes=9` (D-16.5), leído por `usePeriodo()`. Sin parámetros —o con unos que no tienen forma
de mes— es **el mes en curso en Ecuador**, no en UTC (`lib/fechas.ts`, D-16.4: a partir de las 19:00
del último día, en UTC ya es el mes siguiente, y la rejilla de ventas se abría en él).

- **Un enlace a «la ingeniería de menú de agosto» se comparte**, se guarda en marcadores y vuelve
  atrás con el navegador; dos pestañas miran meses distintos sin pisarse. `localStorage` no da
  ninguna de las tres.
- **Cambiar de mes hace `replace`, no `push`**: no es una navegación a la que haga falta volver
  doce veces con «atrás».
- **Los enlaces de la barra lateral llevan el mes** de las secciones que trabajan sobre uno: quien
  mira agosto en el menú y pasa a ventas sigue en agosto.
- **El selector solo aparece en esas secciones** (`conMes` en el registro): en el costeo no
  significaría nada, y un control que no hace nada confunde.
- **Dos `select` y no `<input type="month">`**: Firefox de escritorio no lo implementa y lo degrada a
  un campo de texto donde hay que escribir `2026-09`. Los años son los cinco últimos más el de la
  URL si viene de otro, para que un enlace guardado a un mes antiguo se siga mostrando tal cual.
- **El cliente no limita el rango.** Un mes que nadie ha trabajado no es un error de la URL: la API
  responde `PERIODO_SIN_DATOS` (D-16.2) y la pantalla lo pinta como mes sin abrir.

`router.replace(\`${ruta}?${consulta}\` as Route)`: `typedRoutes` no puede tipar un `pathname` que
llega de `usePathname()` en tiempo de ejecución, y la ruta es por construcción una de las del grupo.
Es el único `as Route` del armazón.

## Decisión 5 — En el teléfono, la navegación detrás de «Menú»

El corte es el mismo `60rem` que ya usaban la lámina y la barra (P14). Por debajo, la barra lateral
se esconde tras el botón «Menú» (`aria-expanded`, `aria-controls`) y se cierra sola al navegar; la
lámina ocupa el ancho entero porque en un teléfono, de pie en la bodega, el ancho es de la hoja de
conteo. Sucursal y mes bajan a su propia fila con la etiqueta oculta **a la vista, no al lector de
pantalla**. Por encima de `60rem`, la barra se queda al costado y se estira con la ventana.

Dos cosas se ajustaron **mirando capturas, no deduciendo** (la lección de P14):

- en escritorio, con una sección corta, el fondo de la barra lateral acababa a media pantalla;
- en el teléfono, con las cuatro cosas en fila, la cabecera ocupaba cuatro renglones —215 px de 780—.
  Queda en tres.

**Sin `position: sticky`** en la lateral: con cuatro entradas no hace falta, y con treinta no cabría
en el alto de la ventana. Se decide cuando la navegación exista entera.

**Sin icono en el botón «Menú».** El manual trae la iconografía en la página 25, que en este equipo no
se pudo leer (no hay `poppler`); CLAUDE.md §10 prohíbe deducir lo que no está leído. El botón dice
«Menú» con texto, que además es más claro. La primitiva `Icono` llega con su primer consumidor y la
página leída.

---

## Consecuencias

- Las treinta pantallas que faltan son una carpeta en `(app)/` con un `layout.tsx` de una línea y una
  entrada en `navegacion.ts`. La barra, la guardia de sucursal, los permisos y el mes ya están.
- `/` sigue mandando a `/costeo` y `/sucursal` también, hasta el commit «Inicio»: con `typedRoutes`,
  un `redirect('/inicio')` no compila mientras la ruta no exista.
- **Ninguna pantalla decide permisos**: si la matriz de roles cambia en la API, el frontend no se
  entera ni hace falta.

## Referencias

- U1, U2, D-16.4, D-16.5, D-16.6 y D-16.131…D-16.144 en `ESTADO.md`.
- ADR-019 (la capa visual y el corte de `60rem`) · ADR-021 (el token anti-CSRF) · **ADR-022** (cómo
  leen y escriben las pantallas).
- INC-013 (el instante UTC del día 1).
