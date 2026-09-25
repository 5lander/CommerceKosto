# ESTRATEGIA de pruebas

## Principio

El producto es la exactitud del número. Un fallo de UI se ve; un fallo de cálculo no. Por eso el peso de las pruebas está en el dominio, no en los controladores.

## Pirámide de este proyecto

| Nivel | Qué cubre | Sin base de datos |
|---|---|---|
| **Unitarias de dominio** (mayoría) | Motor de costeo, validación de ciclos, proyección del libro, cascada de subpreparaciones | ✅ Sí, obligatorio |
| **Integración** | Aislamiento entre companies y ubicaciones, confidencialidad por rol, conciliación, transacciones | ❌ Con base real |
| **Unitarias de `apps/web/src/lib`** *(desde Inicio)* | Funciones puras del cliente: cómo se enseña un número (`decimales`), qué mes se mira (`fechas`); y el transporte (`api`) con `fetch` simulado en `globalThis`: cuerpos vacíos, token anti-CSRF, reintento único, sesión caída. Con `node --test`, sin dependencias (ADR-027) | ✅ Sí |
| **Extremo a extremo** (mínimas) | Los tres flujos que si se rompen el cliente no puede trabajar: cargar una receta, registrar una compra, hacer un conteo | ❌ |

## Reglas duras

- **El motor de costeo se prueba con la base de datos apagada.** Si no se puede, las capas están mal
- **Los casos conocidos se calculan a mano ANTES de escribir el código**, desde el Excel original. Ver `casos-conocidos.md`
- Un caso conocido que cambia de resultado es un **fallo**, hasta que se demuestre que el Excel estaba mal y se documente por qué
- Cada endpoint que devuelva datos de inventario o costeo tiene su test de confidencialidad frente a `BODEGA`, verificado sobre la **respuesta cruda**
- Volumen sintético realista para las pruebas de rendimiento. Nunca 20 filas
- **Nunca datos reales de clientes** en desarrollo ni en staging

- **Lo que el cliente formatea se prueba con negativos, ceros y bordes de redondeo.** Dos fallos del
  mismo archivo —INC-020 e INC-024— daban números plausibles y falsos
- **Las pantallas se verifican entrando de verdad**: login por el formulario, los roles, 1280 y 360 px,
  guardar y recargar. Es lo que encontró INC-023 y las filas no editables del armazón

## Lo que no se prueba

Getters, mapeos triviales y componentes de UI sin lógica. Cobertura alta por sí sola no es un objetivo: cubrir un mapeo no protege de nada.

---

## Verificación multi-tenant de las pantallas (D-16.193)

**El aislamiento entre companies se prueba en la API con dos tenants desde P1** (🔴
`aislamiento-entre-companies.spec.ts` y los casos de cada módulo). Lo que faltaba era probarlo
**donde el cliente lo ve**: la pantalla. Una fuga no se manifiesta como un 200 en un log, sino como
una fila de otro restaurante en un listado.

### El entorno

Dos companies sintéticas, sembradas con `npm run seed:tenant` y pobladas por la API:

| | «ensayo» | «ensayo-b» |
|---|---|---|
| Company | `Ensayo de Despliegue (sintetico)` | `Ensayo B (sintetico)` |
| Dueña | `duena@ensayo.invalid` | `duena@ensayo-b.invalid` |
| Ubicaciones | Local Centro · Bodega Norte | **Local Centro · Bodega Norte** |
| Insumo | Arroz (kg) a **54.00** la funda de 5 kg | Arroz (kg) a **60.00** |
| Producto | **Arroz marinero**, PVP **7.90** | **Arroz marinero**, PVP **9.90** |

**Los nombres se repiten a propósito.** Si lo que distingue a las dos companies en la pantalla fuera
el texto, la prueba no probaría nada: un listado que mezclara las dos se leería como uno solo. Lo que
distingue es el **id**, y por eso la comprobación se hace sobre ids. Las cifras distintas son la
segunda red: una fuga que se colara por otra vía se ve como un 54.00 donde debería haber un 60.00.

> Ningún dato de cliente entra aquí. Dominio `.invalid`, contraseñas de ensayo, cifras inventadas
> (CLAUDE.md §7).

### Las dos comprobaciones, por pantalla

Como **dueña de ensayo-b**, y además de lo que ya se verifica por rol:

1. **El listado no contiene ninguna fila de ensayo.** Se recogen antes todos los ids de ensayo
   —ítems, artículos, grupos, productos, ubicaciones, precios pendientes— y se comprueba que ninguno
   aparece en el HTML de la pantalla, y que no aparece ninguna de sus cifras.
2. **La URL de una ficha con un id de ensayo responde «no encontrado» en sitio.** No la ficha, no un
   500, no una página en blanco: el mensaje del backend dentro del marco de la pantalla, sin tabla y
   sin formulario. Y con la **sucursal** de ensayo metida a mano en el almacenamiento del navegador,
   lo mismo: «Esa ubicación no está en tu alcance».

El id ajeno **sí** aparece en la página: en el `href` del «← Volver» que se construye con el
parámetro de la URL. Eso no es una fuga —lo puso el navegador, no el servidor—, y la comprobación lo
distingue: cuenta el id en el **texto** y en los **enlaces** por separado.

### Cuándo se corre

En la verificación en el navegador de cada pantalla nueva, y se anota en su fila de `ESTADO.md` como
«tenant cruzado ✓». Las pantallas 1–14 se verificaron juntas en el commit de esta sección.
