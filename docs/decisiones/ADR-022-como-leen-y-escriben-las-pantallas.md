# ADR-022 — Cómo leen y escriben las pantallas: `useCarga`, `Vista`, `useEnvio` y la mutación sin sesión

> Architecture Decision Record. Vive en `docs/decisiones/ADR-022-como-leen-y-escriben-las-pantallas.md`. **Inmutable una vez aceptado**: si la decisión cambia, se escribe un ADR nuevo que lo reemplaza.

**Fecha:** 2026-09-13 · **Paquete:** P16 · Armazón (pantalla 1) · **Estado:** aceptada · **Decisores:** Claude Code (D-16.2, D-16.131, D-16.132, D-16.137, D-16.139, D-16.140)

---

## Contexto

Las cinco páginas de antes del armazón repetían lo mismo con otros nombres: tres `useState` (datos,
error, cargando), un `useCallback` que llama a la API y un `useEffect` que lo dispara. `jscpd` no lo
cazaba porque los nombres cambiaban. Con treinta pantallas por delante, era un clon seguro y, peor,
treinta sitios donde olvidar el estado vacío que CLAUDE.md §10 exige en toda vista.

Y al montar el armazón y **capturar las pantallas con datos y con los tres roles**, salieron dos
fallos que llevaban en `main` con la auditoría en verde:

1. **«Entrar» no funcionaba desde un navegador sin sesión** desde P16-A2 (INC-023).
2. **Una fila ya guardada no se podía editar** ni en la rejilla de ventas ni en la hoja de conteo:
   la API devuelve `19.000000000000` y la casilla solo admite dígitos.

Y el armazón trae un riesgo nuevo que antes no existía: con el mes elegible, **la respuesta de una
lectura vieja puede pisar a la nueva** si se cambia de mes dos veces seguidas.

---

## Decisión 1 — `useCarga(leer)` y `useLectura(ruta)`

```ts
useLectura<T>(ruta: string | null): Lectura<T>          // una ruta
useCarga<T>(leer: (() => Promise<T>) | null): Lectura<T> // varias en paralelo, o una que depende de otra
Lectura<T> = { datos, error, codigo, recargar }
```

- **`null` no lee nada**: «todavía no se sabe qué pedir» —la sucursal aún no se leyó—, no un error.
- **`leer` tiene que ser estable** (`useMemo`): cada función nueva es una lectura nueva.
- **El resultado recuerda qué lectura lo produjo.** Si la sucursal o el mes cambian, la pantalla
  vuelve a «cargando» **en el mismo render** en que cambian, y la respuesta que llegue tarde se
  descarta. Sin eso, podía quedar la cifra de agosto debajo del selector en septiembre.
- **`recargar` no borra lo que se ve**: tras guardar un conteo, la hoja sigue en pantalla hasta que
  llega la nueva, en vez de parpadear a «cargando» y perder la posición.
- **`codigo`** es el código de dominio del fallo, para distinguir `PERIODO_SIN_DATOS` sin mirar el
  estado HTTP.

Ventas lee tres cosas en paralelo; inventario, una cadena (busca el conteo del mes, lo abre si no
hay, lee la hoja y, si el permiso lo deja, la conciliación). Las dos son un `useMemo` sobre
`useCarga`, no un caso especial del hook.

## Decisión 2 — `Vista`: los cuatro estados, siempre en el mismo orden

```tsx
<Vista lectura={lectura} esVacio={(d) => …} vacio={{ titulo, ayuda }}>
  {(datos) => …}
</Vista>
```

Mes sin abrir → error con «volver a intentar» → cargando → vacío → datos. **Un mes sin abrir no se
pinta como error** (D-16.2): la API lo devuelve 404 con `PERIODO_SIN_DATOS`, y lo que corresponde no
es una cinta roja sino decir que ese mes todavía no tiene datos. Una pantalla ya no puede olvidar el
estado vacío: `esVacio` y `vacio` son obligatorios.

## Decisión 3 — `useEnvio`: una escritura con su estado

`enviar(accion)` pone `ocupado`, **captura el fallo para enseñarlo** con el mensaje del backend —no
para esconderlo— y devuelve si salió bien, para que quien llama decida qué hacer después (recargar,
confirmar) sin un segundo `try`. **Lo que se estaba capturando no se pierde al fallar**: ese estado
vive en la pantalla, no en el hook, y un 409 o una red caída dejan la hoja como estaba.

**El estado editable se monta con los datos ya leídos** (`RejillaDeVentas`, `ConteoAbierto`): se
inicializa una vez con lo que llegó y, al cambiar de mes, `Vista` desmonta y vuelve a montar. Por eso
los botones de guardar viven dentro de la lámina y no en las `acciones` de `Marco`: el botón necesita
el estado que solo existe cuando los datos llegaron.

La rejilla se recorre con el teclado desde un solo sitio, `useRejilla()` (Enter y ↓ bajan, ↑ sube;
Tab es del navegador), y la casilla es `CeldaEditable`: texto con `inputMode`, nunca
`type="number"`, que acepta `1e3` y cambia el valor con la rueda del ratón.

## Decisión 4 — Sin sesión, la mutación sale sin token y decide la API

`lib/api.ts` pedía el token anti-CSRF con `GET /auth/sesion` antes de **toda** mutación. Sin cookie
esa lectura da 401, el error subía, y el `POST /auth/login` **no llegaba a salir**: la pantalla lo
pintaba como «el correo o la contraseña no coinciden» (INC-023). Desde P16-A2 nadie podía entrar
desde un navegador limpio; se descubrió al capturar el armazón con tres usuarios.

Ahora, **si `GET /auth/sesion` responde `SESION_INVALIDA`, la mutación sale sin cabecera** y la API
decide: las cuatro rutas `@Publico()` —login, activación, olvido, restablecimiento— no piden token
(ADR-021: nace con la sesión), y una ruta protegida contesta `SESION_INVALIDA`, que es el error
verdadero y manda a entrar.

| Alternativa | Por qué no |
|---|---|
| Un flag `sinSesion: true` en las llamadas públicas | Es una lista en el cliente, y la quinta ruta pública es la que alguien olvida. Arreglaba el login y dejaba armado el mismo fallo en `/olvide`, `/restablecer` y `/activacion`, que llegan en la pantalla 1b |
| Mandar un token vacío o inventado | La API lo compara y responde 403 `CSRF_INVALIDO` en las rutas protegidas: un error de CSRF donde el verdadero es que no hay sesión, y que manda a recargar una página que va a volver a fallar |

**No abre nada.** Sin sesión no hay credencial que un sitio cruzado pueda usar; el login CSRF lo
cierra que la API solo analice `application/json` (ADR-021), no el token. El reintento único ante
`CSRF_INVALIDO` sigue igual.

## Decisión 5 — Las casillas editables se precargan sin ceros de sobra

La API manda unidades y cantidades a escala de almacenamiento. `sinCerosDeSobra` quita los ceros de
la derecha de la parte decimal **sobre el texto**: `19.000000000000` → `19`, `1.500000000000` →
`1.5`, y un entero sin coma se devuelve igual. No redondea —a diferencia de `comoImporte`, que es para
leer—, no pasa por `Number` y no cambia el número: lo que se guarda después es lo que la persona ve.

Verificado en el navegador: tras guardar 29 unidades y recargar, la casilla dice `29` y admite
escribir `297`; tras anotar `1,5` y recargar, dice `1.5` y admite borrar un carácter.

---

## Consecuencias

- Toda pantalla nueva lee con `useLectura`/`useCarga` + `Vista` y escribe con `useEnvio`. Las
  primitivas llegan con su primer consumidor y son obligatorias desde el segundo (plan de P16).
- Las pantallas públicas que faltan (1b, activación) funcionan sin nada especial en `llamar`.
- **Queda sin prueba automatizada del cliente**: `apps/web` no tiene ejecutor de pruebas, ni para la
  capa visual (deuda #8 de `ESTADO.md`) ni para `lib/`. Lo que cazó los dos fallos fue ejecutar la aplicación como se usa —login real, tres
  roles, dos anchos, guardar y recargar—, y ese recorrido se repite en cada commit de pantalla.

## Referencias

- D-16.2, D-16.131…D-16.144 en `ESTADO.md` · ADR-020 (el armazón) · ADR-021 (el token anti-CSRF).
- INC-023.
