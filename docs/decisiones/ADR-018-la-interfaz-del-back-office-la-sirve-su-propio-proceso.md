# ADR-018 — La interfaz del back office la sirve su propio proceso

**Fecha:** 2026-09-08 · **Paquete:** P13 · **Estado:** aceptada

---

## Contexto

P11 dejó el back office con API y sin interfaz: se opera con `curl` por el túnel
SSH. P13 tiene que darle pantalla, y la pregunta es dónde vive esa pantalla.

Las restricciones que ya existían y no se negocian:

- El proceso del back office **escucha solo en loopback** y se llega por túnel
  SSH (ADR-017). No se publica a internet.
- Su conexión puentea RLS. Es el proceso más peligroso del sistema.
- CLAUDE.md §10: el back office es **interno, de escritorio, sin requisitos
  estéticos y con requisitos de trazabilidad**.
- CLAUDE.md §1: TypeScript en modo estricto máximo, en todo el proyecto.

---

## Las tres opciones

### A · Una segunda app Next.js (`apps/backoffice`)

Consistente con `apps/web`, TypeScript, mismos idiomas. Y **cero dependencias
nuevas**: reutilizaría las que el workspace ya tiene.

Descartada por lo que implica en el despliegue: otro proceso, otro puerto, otro
artefacto que construir y mantener sincronizado, y —lo decisivo— **el navegador
tendría que hablar con la API privilegiada desde otro origen**, lo que obliga a
habilitar CORS con credenciales justo en el proceso que ve todos los tenants.
Evitarlo exigiría un proxy en el servidor de Next, que es una capa más que
escribir y mantener para no ganar nada.

Para cuatro vistas que usa una persona, es mucha maquinaria.

### B · Un `<script>` en línea y HTML a mano

La opción más corta. Descartada por dos motivos:

1. **La CSP no la permite.** El proceso emite `script-src 'self' 'nonce-…'`; un
   `<script>` con cuerpo no se ejecutaría sin repartir el nonce por la plantilla.
2. **No estaría tipada.** JavaScript escrito a mano y servido a un navegador es
   exactamente lo que CLAUDE.md §1 no permite en ningún sitio.

### C · La sirve el propio proceso, compilada aparte ← **elegida**

Un archivo TypeScript en `src/navegador/`, compilado por `tsconfig.ui.json` a
`dist/ui/backoffice.js`, servido por tres rutas del mismo controlador junto con
el armazón HTML y la hoja de estilos.

---

## Decisión y sus consecuencias

| Qué se gana | Por qué importa aquí |
|---|---|
| **Cero CORS** | El navegador y la API son el mismo origen. El proceso privilegiado no habilita ninguna petición cruzada |
| **Un proceso, un puerto, un túnel** | Lo que se despliega y se opera no cambia respecto de P11 |
| **TypeScript estricto** | `tsconfig.ui.json` lo compila y `audit:types` lo comprueba; hay un bloque propio en `eslint.config.mjs` para que `audit:lint` también lo mire |
| **Sin framework ni empaquetado** | Un archivo, un módulo ES, `tsc`. Ningún árbol de dependencias nuevo en el proceso más peligroso del sistema |

### El proyecto de TypeScript aparte no es burocracia

`tsconfig.ui.json` es el **único** del repositorio con `lib: DOM`. Si el código
de navegador viviera junto al resto de `apps/api`, un endpoint podría usar
`document` o `localStorage` y compilaría sin que nada protestara. La separación
es lo que hace que eso sea imposible.

Y por eso los dos `tsconfig` principales **excluyen** `src/navegador`, `eslint`
tiene un bloque propio para esa carpeta, y `dependency-cruiser` exceptúa el
archivo de la regla de módulos huérfanos: nadie lo importa porque lo carga una
etiqueta `<script>`.

### Lo que cuesta, dicho sin adornos

- **Hay un segundo proyecto de compilación.** `npm run build` ejecuta dos `tsc`,
  el `Dockerfile` copia un tsconfig más, y `audit:types` comprueba dos proyectos.
  Son cuatro líneas repartidas, y cada una está comentada donde está.
- **No hay reactividad ni router.** La página se repinta entera al cambiar de
  vista. Con cuatro vistas y un operador, es lo correcto; con veinte, no lo
  sería, y entonces la opción A vuelve a estar sobre la mesa.
- **No hay pruebas de navegador.** Lo que se comprueba es la superficie HTTP:
  que los tres recursos se sirven, que el guion es el compilado y no un archivo
  vacío, que la página no lleva nada en línea y que todo lo que trae datos sigue
  exigiendo sesión. La interacción se probó a mano contra el proceso levantado.

---

## Dos detalles que costaron y quedan escritos

**Nest aborta el proceso si un proveedor lanza al construirse.** La primera
versión leía el guion en un campo de clase; cuando la ruta era incorrecta, lo que
salía era un volcado nativo de V8 sin mensaje, y entender ese volcado cuesta más
que el problema que lo causa. Ahora se lee **perezosamente**, en la primera
petición, y quien falla en alto es el proceso: `backoffice.ts` comprueba que el
guion está **antes de escuchar**. Servir una página en blanco porque nadie
compiló es peor que no arrancar.

**La ruta del guion sube a `apps/api` y baja a `dist`.** `__dirname` apunta a
`dist/…` compilado y a `src/…` bajo las pruebas; cinco niveles arriba es
`apps/api` en los dos casos. Calcularla solo para `dist` hacía que las pruebas
leyeran una ruta inexistente.

**Y una tercera, de vitest:** dos aplicaciones HTTP de Nest en el mismo worker
hacen que Node reviente con un fallo nativo. Por eso las pruebas de la interfaz
viven en su propio archivo — cada archivo es un worker — y está dicho en la
cabecera de los dos.

---

## Las cabeceras de seguridad son del módulo, no del lanzador

Estaban en `backoffice.ts` y funcionaban. Se movieron a `BackofficeModule` como
middleware porque una prueba que monta el módulo no las veía, y un segundo
lanzador podría olvidarlas. Ahora viajan con el módulo allá donde se monte, y la
prueba mide exactamente lo que sirve el proceso.
