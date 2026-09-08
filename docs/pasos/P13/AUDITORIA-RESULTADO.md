# P13 — Resultado de la auditoría

**Fecha:** 2026-09-08 · **Paquete:** P13 — Frontend del back office
**Veredicto:** los doce checks en verde. `npm run audit` termina con código **0**.

---

## Los doce checks

| Check | Estado | Evidencia |
|---|---|---|
| `audit:types` | ✅ | **Cuatro proyectos**: `apps/api`, **`apps/api/tsconfig.ui.json`**, `tools` y `apps/web` |
| `audit:lint` | ✅ | `--max-warnings=0 --no-inline-config`, con bloque propio para `src/navegador` |
| `audit:forbidden` | ✅ | 34 reglas sobre **346 archivos** (eran 343 en P11) |
| `audit:arch` | ✅ | 291 módulos, 1284 dependencias, sin violaciones |
| `audit:deadcode` | ✅ | knip, con `src/navegador/backoffice.ts` declarado como entrada |
| `audit:complexity` | ✅ | ≤10, ≤3 de profundidad, ≤40 líneas, ≤3 parámetros |
| `audit:duplication` | ✅ | **0 clones** |
| `audit:migrations` | ✅ | 13 migraciones. **P13 no añade ninguna** |
| `audit:secrets` | ✅ | |
| `audit:deps` | ✅ | **Cero dependencias nuevas** |
| `audit:sec-headers` | ✅ | 19 pruebas (una más: la página del back office) |
| `audit:tests` | ✅ | **585 unitarias** + **313 de integración**; 5 saltadas con motivo (INC-016) |

Crecimiento respecto de P11: **+5 de integración**, todas de la superficie HTTP
de la interfaz. **Cero unitarias nuevas**, y es correcto: la interfaz no calcula
nada que probar en aislamiento — lo único que hace con un número es contar
caracteres para avisar, y la decisión la toman el servidor y la base.

---

## Que los checks nuevos miran de verdad

La interfaz es un proyecto de TypeScript aparte, y eso abre la puerta a que
`audit:types` y `audit:lint` la den por analizada sin mirarla (INC-007). Se
comprobó provocando el fallo:

- **Antes** de añadir el bloque de eslint para `src/navegador`, `audit:lint`
  fallaba con *«was not found by the project service»* — es decir, la veía y no
  podía analizarla. Con el bloque, la analiza.
- `audit:types` ejecuta `tsc -p apps/api/tsconfig.ui.json --noEmit` como paso
  propio, encadenado con `&&`: si falla, la auditoría entera falla.

Y la prueba que impide el caso peor: **`el guion servido es el COMPILADO, no un
archivo vacío`**. Sin ella, la prueba de que `/ui/app.js` responde 200 pasaría
con un `dist/ui/` de cero bytes y el back office serviría una página en blanco.

---

## Comprobado contra el proceso levantado, no solo en pruebas

```
HTML 200 text/html; charset=utf-8
CSS  200 text/css; charset=utf-8
JS   200 text/javascript; charset=utf-8   (15.055 bytes)
companies sin sesion: 401
```

Y el fallo en alto, provocando la ausencia del guion:

```
No está compilada la interfaz del back office (…/dist/ui/backoffice.js).
Ejecuta `npm run build --workspace @costeo/api`.
```

El recorrido completo —entrar, listar, abrir una ficha, leer sus planes, leer su
auditoría, cambiar el plan— se ejecutó contra el proceso real, y las seis
acciones dejaron su línea en `backoffice_access_log` con el motivo tecleado.

---

## Checklist manual de `docs/AUDITORIA.md`

| Sección | Comprobado |
|---|---|
| **A · Arquitectura** | La interfaz no importa nada del dominio: habla con la API por HTTP. `dependency-cruiser` la exceptúa de huérfanos porque la carga un `<script>`, no un módulo |
| **B · Clean Code** | Cero `any`, cero `@ts-ignore`, cero `eslint-disable`. `vistaFicha` se partió en tres al pasar de 40 líneas |
| **C · Seguridad** | **Nada en línea**, y hay una prueba que lo fija: con `script-src 'self'` sin nonce, un `<script>` con cuerpo no se ejecutaría. Todo el DOM se construye con `createElement`/`append`, que crea nodos de texto: el nombre de una company no puede interpretarse como marcado |
| **D · Base de datos** | P13 no la toca |
| **E · Reglas de negocio** | Intactas: la interfaz no calcula nada (§10) |
| **F · Frontend** | Tokens en un solo bloque `:root`. Estados de carga, error y vacío en las cuatro vistas. Un 401 devuelve a la pantalla de entrada en vez de dejar la página a medias — la sesión dura ocho horas y caduca mientras alguien trabaja. **No se aplica la marca**: eso es P14 |
| **G · Pruebas** | Las 5 de la superficie HTTP, incluida la que impide el `dist/ui/` vacío |
| **H · Documentación** | ADR-018, `CONSTRUCCION.md`, este archivo, `CHANGELOG`, `ESTADO.md` |

---

## Lo que queda dicho, no escondido

- **No hay pruebas de navegador.** Lo que se prueba es la superficie HTTP; la
  interacción se verificó a mano contra el proceso levantado. Montar un runner de
  navegador para cuatro vistas que usa una persona sería más maquinaria que
  cobertura.
- **La página se repinta entera al cambiar de vista.** Con cuatro vistas es lo
  correcto; con veinte no lo sería, y ADR-018 deja dicho qué hacer entonces.
- **`npm run bench` no se volvió a correr.** P13 no toca ninguna consulta.
