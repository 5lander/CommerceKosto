# Modelo de datos

> Esqueleto. Se completa en cada paquete que cree tablas, **en el mismo commit**, con el diagrama de entidades actualizado.

## Reglas transversales

- `company_id` en **toda** tabla de negocio, sin excepción
- RLS deny-by-default; políticas creadas antes de la primera fila
- UUID v7 como clave pública · `numeric` para dinero y cantidades · `timestamptz` para fechas
- Enums en tabla de catálogo, no en tipo nativo
- Sin borrado físico en entidades auditables
- **La tabla de movimientos de inventario es append-only**: sin `UPDATE`, sin `DELETE`

## Entidades por paquete

| Paquete | Entidades |
|---|---|
| P1 | `company`, `company_settings`, `user`, `session`, `role`, `permission`, `location`, `access_log` |
| P2 | `item`, `purchase_article`, `unit`, `unit_conversion`, `item_group` |
| P3 | `reference_price` |
| P4 | `product`, `product_location`, `recipe`, `recipe_line`, `combo_component`, `recipe_propagation_log` |
| P6 | `inventory_movement`, `inventory_balance` (proyección), `production_batch` |
| P7 | `period`, `physical_count`, `physical_count_line` |
| P8 | vistas materializadas de período cerrado |
| P10 | `import_job`, `import_row` |
| P11 | `plan`, `subscription`, `cross_tenant_access_log` |

<!-- El diagrama entidad-relación se agrega y actualiza aquí. -->
