# INC-026 — Tras guardar, la ficha del producto enseña dos costos y el siguiente guardado no hace nada

| Campo | Valor |
|---|---|
| **Fecha** | 2026-09-14 |
| **Paquete** | P16 · pantalla 12 |
| **Área** | frontend |
| **Tiempo perdido** | ~20 min |
| **Recurrencias** | 0 |

> **Ni un error en consola, ni en la API.** El `PUT` salía bien, la tabla de sucursales enseñaba el PVP
> nuevo, y la pantalla seguía mostrando el margen del PVP viejo.

## Síntoma

En `/productos/[id]`, al guardar el PVP de la sucursal:

- la tabla «En las sucursales» sí cambia (8.20);
- la venta neta, el margen y el food cost **no** (siguen con 7.90);
- el campo PVP conserva lo tecleado («8,20») en vez de la cifra releída («8.2»);
- un segundo guardado, o el del empaque, **no llega a la API** y no enseña error.

Contando los bloques del DOM aparece la causa visible: **dos secciones «Lo que cuesta y deja…»**, una con
el PVP viejo y otra con el nuevo.

## Contexto

La ficha monta tres bloques que dependen de la `version` del producto —costo, configuración y empaque— y
los vuelve a montar tras cada escritura usando la versión como `key` (ADR-023: un formulario no puede
quedarse con la versión vieja).

## Causa raíz

Los tres hermanos llevaban **la misma clave**:

```tsx
const clave = `${sucursal}-${version}`;
<CostoDelProducto key={clave} … />
<ConfiguracionEnSucursal key={clave} … />
<EmpaqueDelProducto key={clave} … />
```

Con claves repetidas entre hermanos React no puede emparejar lo viejo con lo nuevo: al cambiar la versión
**no desmontó los bloques anteriores y añadió los nuevos al lado**. El formulario que la prueba encontraba
primero era el viejo, con la versión anterior, y su envío se perdía entre los dos. El aviso de React por
claves duplicadas **solo sale en desarrollo**; la verificación corre contra el build de producción.

## Solución

Una clave por bloque: `costo-${clave}`, `configuracion-${clave}`, `empaque-${clave}`, con el porqué en un
comentario junto a la constante.

## Prevención

- [ ] **¿Verificación automática?** No sin dependencia nueva: `apps/web` no tiene pruebas de componentes
  (ADR-027 prueba `lib/` con `node --test`), y `react/jsx-key` exige que haya clave, no que sea única entre
  hermanos construidos con la misma variable.
- [x] **En la verificación en el navegador de cada pantalla que remonta bloques tras guardar**, se cuenta
  cuántas veces aparece cada sección **después** de la escritura, no solo antes (la de la pantalla 12
  comprueba `secciones: 1` tras guardar).
- [x] **Regla para las pantallas siguientes** (receta, versiones, conteos): nunca una clave compartida entre
  hermanos; la clave de un bloque empieza por el nombre del bloque.

## Referencias

- ADR-023 · `apps/web/src/app/(app)/productos/[id]/page.tsx` → `Bloques`.
