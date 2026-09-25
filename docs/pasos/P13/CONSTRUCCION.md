# P13 — Frontend del back office

**Fecha:** 2026-09-08 · **Paquete:** P13 — Frontend del back office
**Decisión de fondo:** ADR-018 — la interfaz la sirve el propio proceso del back office

---

## 1. Qué se entregó

Cuatro vistas, servidas por el mismo proceso que la API del back office:

| Vista | Qué hace |
|---|---|
| **Entrar** | Correo y contraseña del operador. Dice, antes de entrar, que el panel ve los datos de todos los clientes |
| **Cartera** | Todas las companies con su plan, estado, ubicaciones y fecha de alta |
| **Ficha** | Los recuentos contra los límites del plan, cambio de plan, cambio de estado, y la auditoría de ese cliente |
| **Quién ha mirado qué** | El registro del propio back office: operador, acción, company y **motivo** |

Y una pieza que no es una vista pero es la que importa: **la caja del motivo,
permanente y arriba**, con el contador de caracteres que faltan.

---

## 2. Dónde vive, y por qué ahí

Está razonado entero en **ADR-018**. En una frase: una segunda app de Next.js
habría obligado al navegador a hablar con la API privilegiada **desde otro
origen**, y eso significa habilitar CORS con credenciales justo en el proceso que
ve todos los tenants. Sirviéndola desde el mismo proceso, no hay petición cruzada
que permitir.

El código de navegador vive en `src/navegador/` y se compila con
`tsconfig.ui.json`, **el único proyecto del repositorio con `lib: DOM`**. Si
viviera junto al resto de `apps/api`, un endpoint podría usar `document` y
compilaría. Y para que esa separación no deje un agujero de verificación:

- `audit:types` compila **los dos** proyectos.
- `eslint.config.mjs` tiene un bloque propio para esa carpeta, con las mismas
  reglas estrictas y `globals.browser`. Sin él, eslint la habría dado por no
  analizada — que es la forma exacta en que un check se queda verde sin mirar
  nada (INC-007).
- `dependency-cruiser` la exceptúa de «módulos huérfanos», porque nadie la
  importa: la carga una etiqueta `<script>`.

---

## 3. El motivo, como decisión de interfaz

La API exige `X-Motivo` en toda operación cross-tenant (P11). Lo que P13 decide
es **cómo se pide**, y no es un detalle:

**Es un campo permanente arriba, no un diálogo al pulsar.** Un motivo que se pide
*después* de haber decidido mirar se rellena para pasar el trámite; uno que está
delante mientras se decide, se piensa. El contador dice cuántos caracteres faltan
y, cuando ya llega, cambia a «este texto se guarda junto a cada consulta, con tu
nombre y la hora» — que es lo que de verdad pasa.

**No se guarda en `localStorage`.** Ni el motivo ni nada. Es lo que impide que el
motivo de ayer acompañe al acceso de hoy.

**Y no se valida aquí de verdad.** El contador no decide nada: el servidor vuelve
a comprobarlo y por debajo está el `CHECK` de la base. Contar caracteres para
avisar es lo único que este código hace con un número.

---

## 4. Cero lógica de negocio, y se nota en el código

CLAUDE.md §10 lo exige y aquí sale gratis: la interfaz **pinta lo que la API
devuelve y manda lo que el operador escribe**. No hay una sola fórmula, ni un
`parseFloat`, ni un decimal manipulado — los únicos números son recuentos
enteros, y viajan como enteros.

**Y no se concatena HTML en ningún sitio.** Todo se construye con
`document.createElement` y `append`, que crea nodos de **texto**: el nombre de una
company no puede interpretarse como marcado ni queriendo. Es la misma propiedad
que el pentest de P15 comprobó en la API, sostenida aquí por construcción.

---

## 5. Los tokens

El bloque `:root` de `pagina.ts` es el único sitio con un color o un tamaño; todo
lo demás los referencia (CLAUDE.md §10). **No se aplica el manual de marca**: eso
es P14 y es para la app cliente. El back office es interno y sobrio a propósito.

---

## 6. Tres cosas que costaron y quedan escritas

**Nest aborta el proceso si un proveedor lanza al construirse.** Leer el guion en
un campo de clase producía, cuando la ruta era incorrecta, un volcado nativo de
V8 sin mensaje. Ahora se lee perezosamente y quien falla en alto es el proceso,
comprobándolo **antes de escuchar**.

**La ruta del guion difiere entre `dist` y `src`.** `__dirname` apunta a un sitio
compilado y a otro bajo las pruebas; cinco niveles arriba es `apps/api` en los
dos casos.

**Dos aplicaciones HTTP de Nest en el mismo worker de vitest revientan Node.** Por
eso las pruebas de la interfaz están en su propio archivo, y está dicho en la
cabecera de los dos.

---

## 7. Ficheros

| Fichero | Qué |
|---|---|
| `apps/api/tsconfig.ui.json` | El único proyecto con `lib: DOM` |
| `apps/api/src/navegador/backoffice.ts` | La interfaz entera |
| `apps/api/src/modules/backoffice/infrastructure/http/pagina.ts` | Armazón HTML y tokens |
| `apps/api/test/integracion/backoffice-interfaz.spec.ts` | Las 5 de la superficie HTTP |
| `docs/decisiones/ADR-018-…` | Las tres opciones y por qué esta |
