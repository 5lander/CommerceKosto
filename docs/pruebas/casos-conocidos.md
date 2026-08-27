# Casos conocidos del dominio

> **Se llenan a mano, desde el Excel original, ANTES de escribir el motor de costeo.**
> Cada caso incluye entradas completas y el resultado esperado calculado manualmente.
> Es el insumo de P5 y el ítem B2 de `docs/FASE0-CHECKLIST.md`.

## Formato de cada caso

```
### CC-00X — {nombre descriptivo}

**Qué prueba:** {la regla o el borde que cubre}

**Entradas**
- Parámetros: iva_venta, iva_recuperable, merma_no_atribuible, ...
- Ítems: id, unidad de uso, precio de compra, iva, factor de conversión, rendimiento
- Líneas de receta: ítem, cantidad, base (AP/EP), estado
- Producto: rendimiento en porciones, empaque, PVP con IVA
- Unidades vendidas

**Resultado esperado** (calculado a mano)
- costo_bruto_lote = ...
- costo_neto_lote = ...
- costo_por_porcion = ...
- costo_con_merma = ...
- costo_total_unidad = ...
- venta_neta = ...
- margen_contribucion = ...
- food_cost_pct = ...
- suma_control = 1
```

## Cobertura mínima exigida antes de implementar P5

| Caso | Qué debe cubrir |
|---|---|
| CC-001 | Producto simple, un solo ítem, base EP, rendimiento 1.0 |
| CC-002 | **El mismo ítem en base AP y en base EP** — resultados distintos, ambos correctos (R4) |
| CC-003 | Ítem con rendimiento < 1 (ej. 0.65): verificar que el costo neto **sube** respecto del bruto |
| CC-004 | Producto con línea `EXCLUIDA`: no debe sumar al costo |
| CC-005 | Producto con rendimiento por lote > 1 porción |
| CC-006 | **Subpreparación anidada**: un ítem PRODUCIDO usado dentro de otra receta |
| CC-007 | **Combo**: dos productos simples con porciones reducidas |
| CC-008 | `iva_recuperable = false`: el costo debe subir exactamente el porcentaje del IVA |
| CC-009 | Cuadrante de menu engineering con índice de popularidad **exactamente 1** |
| CC-010 | Dataset completo donde la **conciliación da 0** (R7) |

<!-- Los casos se escriben aquí abajo. -->
