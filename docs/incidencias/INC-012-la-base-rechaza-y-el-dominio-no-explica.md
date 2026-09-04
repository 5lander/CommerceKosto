# INC-012 — Un `CHECK` o un trigger sale como `INTERNAL_ERROR 500`

| Campo | Valor |
|---|---|
| **Síntoma** | Una petición con datos incoherentes devuelve **500 `INTERNAL_ERROR`** en vez de 400. En el log hay un `23514` (check_violation) o un `P0001` (raise de trigger) del driver de PostgreSQL |
| **Área** | arquitectura · base de datos |
| **Paquete** | P5 (las dos reglas eran de P3 y P4) |
| **Recurrencias** | 2, las dos en el mismo paquete |
| **Estado** | ✅ resuelto |

---

## Síntoma exacto

Dos peticiones perfectamente razonables desde el punto de vista del usuario:

```
PUT /productos/{id}/ubicaciones   { activo: true, pvp: null, ... }   -> 500
POST /precios                     { itemId: <COMPRADO>, purchaseArticleId: null } -> 500
```

El cuerpo de la respuesta es `{ "code": "INTERNAL_ERROR", "message": "..." }`, que es lo que el filtro de errores devuelve ante cualquier excepción que **no** sea un `ErrorDeDominio`.

## Qué estaba pasando

Las dos reglas existen y funcionan. Están en la base, que es donde CLAUDE.md §5 quiere que estén:

```sql
-- P4
ALTER TABLE "product_location"
  ADD CONSTRAINT "product_location_activo_tiene_pvp"
  CHECK ("activo" = false OR "pvp" IS NOT NULL);

-- P3
IF tipo = 'COMPRADO' AND NEW."purchase_article_id" IS NULL THEN
  RAISE EXCEPTION '...';
```

Lo que faltaba era la otra mitad de la regla de CLAUDE.md §3: **la base garantiza, el dominio explica.** Sin la guarda de dominio, el error del driver sube sin traducir, el filtro no lo reconoce como error de dominio y lo convierte en 500 — «un fallo del servidor» cuando lo que hay es un formulario a medio llenar.

**Y un 500 no es solo un código feo.** Dispara alertas de operación, se cuenta como caída en cualquier métrica de disponibilidad, y no le dice al usuario qué corregir.

## Por qué costó verlo

**Porque las pruebas de P3 y P4 nunca montaron esos casos.** Las dos reglas se probaron por el lado que funciona: un producto activo **con** PVP, un precio **con** artículo. El caso incoherente no se probó porque no era el criterio de aceptación de ningún paquete.

Los dos aparecieron el mismo día, al montar los bordes de **CC-009** —un producto sin PVP— y al poner un precio nuevo a un ítem ya existente en la prueba de E8. Es decir: los encontró un paquete posterior, escribiendo pruebas de otra cosa.

## Solución aplicada

Una guarda de dominio por regla, delante de la base, con el mensaje que el usuario necesita:

```ts
// ConfigurarProductoEnUbicacion
if (datos.activo && datos.pvp === null) {
  throw new RecetaInvalidaError(
    'Un producto activo necesita PVP: sin él se podría vender sin saber a cuánto, ' +
    'y su margen saldría indefinido.',
  );
}
```

```ts
// SugerirPrecio.exigirArticuloCoherente
if (item.tipo === 'COMPRADO' && datos.purchaseArticleId === null) { ... }
if (item.tipo === 'PRODUCIDO' && datos.purchaseArticleId !== null) { ... }
```

**La restricción de la base NO se toca.** Sigue siendo la garantía; la guarda es la explicación. Quitar el `CHECK` para «arreglar» el 500 sería exactamente el error inverso.

## Prevención

**Automatizada — la que de verdad cierra el caso.** `audit:migrations` gana la comprobación **M11**: toda migración que añada un `CHECK` o una función de trigger que haga `RAISE EXCEPTION` tiene que declarar, en un comentario `-- GUARDA:` junto a la restricción, dónde está su guarda de dominio. Es una línea por restricción y falla el build si falta; no comprueba que la guarda sea correcta —eso no es automatizable— pero sí que alguien se hizo la pregunta.

**Manual, en la checklist.** `docs/AUDITORIA.md` gana **D14**: «toda restricción o trigger nuevo tiene su guarda de dominio, con mensaje, y una prueba que comprueba que sale como 4xx y no como 500».

## Dónde volverá a aparecer

**P6 es el candidato claro.** El libro de inventario es append-only en tres capas, dos de ellas triggers y `REVOKE`. Un `UPDATE` sobre `inventory_movement` tiene que salir como un error de dominio con un mensaje que diga «un error se corrige con un movimiento de signo contrario», no como un 500.

## Relacionadas

- **INC-007** — un check que pasa en verde sin medir nada. Es el mismo patrón visto desde el otro lado: aquí la regla **sí** medía, y lo que faltaba era la traducción de su fallo.
- **INC-010** — `RETURNING` bajo RLS. También un error del motor que llega al usuario sin traducir.
