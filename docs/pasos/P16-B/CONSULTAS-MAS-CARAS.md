# Las diez consultas mas caras del volumen sintetico

> Generado por `npm run bench` desde `pg_stat_statements`, ordenado por
> tiempo TOTAL: una consulta de 3 ms que corre mil veces pesa mas que una
> de 200 ms que corre una. Los parametros salen como `$1` porque
> `pg_stat_statements` normaliza, que es justo lo que permite agrupar.

### 1. 1139 ms totales, 396 llamadas, 2.88 ms de media

```sql
SELECT "public"."recipe_line"."id", "public"."recipe_line"."item_id", "public"."recipe_line"."cantidad", "public"."recipe_line"."base", "public"."recipe_line"."estado", "public"."recipe_line"."orden", "public"."recipe_line"."recipe_id" FROM "public"."recipe_line" WHERE "public"."recipe_line"."recipe_id" IN ($1 /*, ... */) ORDER BY "public"."recipe_line"."orden" ASC OFFSET $2
```

### 2. 1125 ms totales, 561 llamadas, 2.01 ms de media

```sql
SELECT "public"."item"."id", "public"."item"."name", "public"."item"."type", "public"."item"."unit_of_use", "public"."item"."yield", "public"."item"."group_id", "public"."item"."status", "public"."item"."price_confidence", "public"."item"."keeps_stock", "public"."item"."version" FROM "public"."item" WHERE "public"."item"."company_id" = $1 ORDER BY "public"."item"."name" ASC OFFSET $2
```

### 3. 312 ms totales, 99 llamadas, 3.16 ms de media

```sql
SELECT "public"."purchase_article"."id", "public"."purchase_article"."item_id", "public"."purchase_article"."name", "public"."purchase_article"."brand", "public"."purchase_article"."supplier", "public"."purchase_article"."presentation_amount", "public"."purchase_article"."presentation_unit", "public"."purchase_article"."conversion_factor", "public"."purchase_article"."iva_tarifa", "public"."purchase_article"."status" FROM "public"."purchase_article" WHERE "public"."purchase_article"."company_id" = $1 ORDER BY "public"."purchase_article"."name" ASC OFFSET $2
```

### 4. 297 ms totales, 396 llamadas, 0.75 ms de media

```sql
SELECT "public"."product"."id", "public"."product"."name", "public"."product"."type", "public"."product"."category", "public"."product"."status", "public"."product"."packaging_item_id", "public"."product"."version" FROM "public"."product" WHERE "public"."product"."company_id" = $1 ORDER BY "public"."product"."name" ASC OFFSET $2
```

### 5. 248 ms totales, 363 llamadas, 0.68 ms de media

```sql
SELECT SUM("public"."inventory_movement"."quantity") AS "_sum$quantity", SUM("public"."inventory_movement"."total_cost") AS "_sum$total_cost", "public"."inventory_movement"."item_id", "public"."inventory_movement"."type" FROM "public"."inventory_movement" WHERE ("public"."inventory_movement"."company_id" = $1 AND "public"."inventory_movement"."location_id" = $2 AND "public"."inventory_movement"."occurred_at" >= $3 AND "public"."inventory_movement"."occurred_at" < $4 AND "public"."inventory_movement"."type" <> $5) GROUP BY "public"."inventory_movement"."item_id", "public"."inventory_movement"."type" OFFSET $6
```

### 6. 209 ms totales, 363 llamadas, 0.57 ms de media

```sql
SELECT "public"."product_sales"."id", "public"."product_sales"."product_id", "public"."product_sales"."units" FROM "public"."product_sales" WHERE ("public"."product_sales"."company_id" = $1 AND "public"."product_sales"."period_id" = $2) OFFSET $3
```

### 7. 192 ms totales, 396 llamadas, 0.49 ms de media

```sql
SELECT "public"."recipe"."id", "public"."recipe"."location_id", "public"."recipe"."status", "public"."recipe"."valid_from", "public"."recipe"."note", "public"."recipe"."product_id", "public"."recipe"."item_id" FROM "public"."recipe" WHERE ("public"."recipe"."company_id" = $1 AND "public"."recipe"."location_id" = $2 AND "public"."recipe"."valid_from" <= $3) ORDER BY "public"."recipe"."valid_from" DESC, "public"."recipe"."created_at" DESC OFFSET $4
```

### 8. 145 ms totales, 396 llamadas, 0.37 ms de media

```sql
SELECT "public"."product_location"."product_id", "public"."product_location"."location_id", "public"."product_location"."activo", "public"."product_location"."pvp", "public"."product_location"."rendimiento_porciones" FROM "public"."product_location" WHERE ("public"."product_location"."company_id" = $1 AND "public"."product_location"."location_id" = $2) OFFSET $3
```

### 9. 144 ms totales, 99 llamadas, 1.45 ms de media

```sql
SELECT "public"."reference_price"."id", "public"."reference_price"."item_id", "public"."reference_price"."purchase_article_id", "public"."reference_price"."price", "public"."reference_price"."iva_compra", "public"."reference_price"."origin", "public"."reference_price"."status", "public"."reference_price"."valid_from", "public"."reference_price"."created_at", "public"."reference_price"."note" FROM "public"."reference_price" WHERE ("public"."reference_price"."company_id" = $1 AND "public"."reference_price"."status" = $2 AND "public"."reference_price"."valid_from" <= $3) ORDER BY "public"."reference_price"."item_id" ASC, "public"."reference_price"."valid_from" DESC, "public"."reference_price"."created_at" DESC OFFSET $4
```

### 10. 63 ms totales, 5449 llamadas, 0.01 ms de media

```sql
SELECT set_config($1, $2, $3)
```
