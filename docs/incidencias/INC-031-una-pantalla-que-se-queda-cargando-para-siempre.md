# INC-031 — Una pantalla que se queda «Cargando…» para siempre

| Campo | Valor |
|---|---|
| **Fecha** | 2026-09-21 |
| **Paquete** | Pantalla 18 (registrar movimiento) |
| **Área** | frontend |
| **Tiempo perdido** | ~10 min |
| **Recurrencias** | 0 |

> La pantalla compila, pasa el linter, no lanza ningún error en consola y **no llega nunca** a
> enseñar sus campos.

## Síntoma

`/movimientos/nuevo` se quedaba en «Cargando…» indefinidamente. En la captura sin cabeza,
`document.querySelectorAll('input[name=total]').length` daba **0** con el formulario supuestamente
montado, y la red mostraba `GET /catalogo/items` repitiéndose sin parar.

Los cinco checks del modo cierre —tipos, lint, prohibiciones, complejidad, duplicación— estaban en
**verde**.

## Causa raíz

`useCarga` recibía la función de lectura **escrita en el sitio de la llamada**:

```tsx
// MAL
function useCatalogo(): Lectura<DatosDelFormulario> {
  return useCarga(async () => {
    const [insumos, articulos] = await Promise.all([...]);
    return { insumos, articulos };
  });
}
```

Cada render crea una función nueva. Para `useCarga` eso **es una lectura distinta**: su `useEffect`
depende de `leer`, así que vuelve a pedir; al llegar la respuesta cambia el estado, que provoca otro
render, que crea otra función, que dispara otra lectura. Y como el resultado guarda de qué lectura
vino (`resultado.origen === leer`), el que llega **nunca** coincide con la función actual: los datos
se descartan siempre y la pantalla no sale de «cargando».

Lo peor no es el bucle: es que **la documentación ya lo decía**. `apps/web/src/lib/useLectura.ts`
lleva escrito desde el armazón «**`leer` tiene que ser estable** (`useMemo`/`useCallback`): cada
función nueva es una lectura nueva». Las otras seis pantallas que usan `useCarga` lo cumplen. Esta
no, y nada avisó.

## Solución

```tsx
// BIEN
const leer = useCallback(async (): Promise<DatosDelFormulario> => { … }, []);
return useCarga(leer);
```

## Prevención — la regla, no la nota

Un comentario en la cabecera de `useLectura.ts` ya existía y no impidió nada, así que la prevención
no podía ser otro comentario. **`audit:forbidden` gana la regla `lectura-con-funcion-estable`**
(`tools/audit/rules/frontend.rules.mjs`), que marca `useCarga(` seguido de `async`, de `(` o de
`function`: es decir, una función escrita en la propia llamada. `useCarga(leer)` pasa.

Comprobada contra los cinco casos, tres que debe cazar y dos que no. El contador de
`audit:forbidden` pasa de **47 a 48 reglas**, que es como se ve que una regla entró de verdad
(`ESTADO.md`, notas de contexto).

## La lección, que no es sobre React

**Hay una clase de fallo que solo aparece abriendo la pantalla.** Los cinco checks del modo cierre
miran el código quieto; este error solo existe cuando el código corre. Es la misma lección que dejó
el ensayo de despliegue de P14b con INC-018, INC-019 e INC-020, y la razón por la que la
verificación por pantalla —roles, 360 px, tenant cruzado, importes contra la API— **no es opcional
ni aunque la auditoría esté verde**. Aquí la encontró justamente eso.
