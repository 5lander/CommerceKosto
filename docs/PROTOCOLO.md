# PROTOCOLO.md — Ritual obligatorio por paquete

> Este protocolo se ejecuta **completo** en cada paquete (P0, P1, P2…), sin excepciones y sin saltarse pasos.
> Si el contexto se compactó y no recuerdas dónde estabas: **lee `ESTADO.md`**. Ahí está la verdad.

---

## Fase 1 — RECARGA (siempre, al inicio de cada paquete)

Ejecuta **en este orden**, aunque creas recordar el contenido. Después de una compactación tu memoria del detalle es poco fiable.

1. Lee `CLAUDE.md` **completo**
2. Lee `ESTADO.md` para saber en qué paquete vas y qué decisiones ya se tomaron
3. Lee la sección de `docs/PLAN-IMPLEMENTACION.md` del paquete actual
4. Lee las secciones de `docs/SPEC.md` que ese paquete referencia
5. **Lee el índice de `docs/incidencias/README.md`** — problemas ya resueltos, para no volver a diagnosticarlos
6. Revisa el código de los paquetes anteriores que vayas a tocar o extender

**Declara al usuario:**
> "Recargado. Vamos con **P{n} — {nombre}**. Leí CLAUDE.md, ESTADO.md, el plan, el índice de incidencias y las secciones {x, y} del SPEC."

---

## Fase 2 — PLAN (antes de escribir una sola línea)

Presenta al usuario, **y espera su aprobación**:

- Archivos que vas a crear, agrupados por capa (`domain` → `application` → `infrastructure`)
- Entidades y value objects del dominio
- Puertos (interfaces) que define la capa de aplicación
- Migraciones e índices que vas a añadir
- Pruebas que vas a escribir
- **Dudas o ambigüedades detectadas** en el SPEC
- **Decisiones abiertas** (sección 11 de CLAUDE.md) que este paquete toca

**No escribas código hasta que el usuario apruebe el plan** (en modo autónomo: hasta dejarlo registrado).

**Al aprobar el plan**: crea `docs/pasos/P{n}/CONSTRUCCION.md` desde la plantilla, con el plan vaciado en su sección. Se irá completando durante la construcción — no al final, cuando ya se olvidó el detalle.

Si detectas que el paquete depende de una decisión abierta: **pregunta, no inventes**.

---

## Fase 3 — IMPLEMENTACIÓN (por capas, en orden)

1. **Dominio primero** — entidades, value objects, reglas puras, errores tipados
2. **Pruebas del dominio** — en el mismo paso, no después
3. **Casos de uso** + puertos
4. **Pruebas de casos de uso** con dobles de prueba
5. **Infraestructura** — repositorios, migraciones, controladores, clientes externos
6. **Pruebas de integración**

Reglas durante la implementación:
- Si una función pasa de 20 líneas o 3 niveles de indentación → refactoriza **antes** de seguir
- Si necesitas una dependencia nueva → **pregunta primero**
- Si te ves tentado a usar `any`, `@ts-ignore` o `eslint-disable` → **detente y avisa**

---

## Fase 4 — AUDITORÍA (obligatoria antes del commit)

Ejecuta la checklist completa de `docs/AUDITORIA.md` y **presenta el resultado punto por punto**.

**Si algún punto falla: arréglalo antes del commit.** No se documenta como deuda técnica, se corrige.

El resultado completo, con evidencia por check, se escribe en `docs/pasos/P{n}/AUDITORIA-RESULTADO.md` desde la plantilla. **Sin ese archivo no hay commit.**

---

## Fase 5 — COMMIT

Un commit por paquete, con este formato:

```
P{n}: {nombre del paquete}

- {entregable 1}
- {entregable 2}
- {entregable 3}

Auditoría: OK
Pruebas: {n} pasando
Decisiones: {las que se tomaron, o "ninguna"}
Pendiente: {dudas abiertas, o "ninguna"}
```

Ejemplo:
```
P2: Catálogo · ítems · artículos · unidades

- Dominio de ítems COMPRADO/PRODUCIDO con unidad de uso y rendimiento
- Artículos de compra: N marcas apuntan a un ítem, con factor de conversión
- Unidades y conversiones como catálogo, no como cadenas de texto
- Campo confianza_precio (el tipo SUP del Excel)
- Migración con índice GIN + pg_trgm sobre nombre normalizado
- RLS deny-by-default y FORCE en las cuatro tablas nuevas

Auditoría: OK
Pruebas: 47 pasando
Decisiones: la conversión kg → unidades sin factor se rechaza en el dominio, no en la base
Pendiente: el catálogo semilla de unidades depende del ítem B3 de FASE0-CHECKLIST
```

**Nunca hacer commit con pruebas en rojo o auditoría fallida.**

---

## Fase 6 — DOCUMENTAR + ACTUALIZAR ESTADO

### 6a. Documentación viva (obligatoria — ver árbol completo en CLAUDE.md §12)
1. **`docs/pasos/P{n}/CONSTRUCCION.md`** — completar todas sus secciones (decisiones, consultas con EXPLAIN, problemas, cómo probar)
2. **`docs/sistema/FUNCIONAMIENTO.md`** — apartado del módulo + diagramas Mermaid
3. **`docs/sistema/modelo-datos.md`** — si hubo migraciones
4. **`docs/apis/*.md`** — cada endpoint nuevo con la plantilla API-ENDPOINT
5. **`docs/decisiones/ADR-*.md`** — por cada decisión técnica relevante del paquete
6. **`docs/runbooks/*.md`** — si el paquete introdujo algo operable
7. **`docs/incidencias/`** — una ficha por cada problema del paquete que cumpla el criterio de `docs/incidencias/README.md`, con su fila en el índice. **Si la ficha se puede convertir en una verificación de `npm run audit` o en una prueba, hazlo en este mismo paquete**
8. **`docs/CHANGELOG.md`** — la entrada del paquete

**El commit del paquete incluye toda esta documentación.** Código sin documentar = paquete incompleto.

### 6b. Estado

Edita `ESTADO.md`:
- Marca el paquete como completado, con la fecha y el hash del commit
- Registra las decisiones tomadas
- Registra las dudas pendientes
- Anota el siguiente paquete
- Añade cualquier contexto que un "tú" futuro sin memoria necesitaría saber

**Este archivo es lo único que sobrevive a una compactación. Escríbelo pensando en alguien que no vivió la sesión.**

### 6c. Verificación de la fase
- `FUNCIONAMIENTO.md` refleja el sistema real (no promesas)
- Los diagramas Mermaid renderizan sin error
- `ESTADO.md` actualizado

---

## Fase 7 — CIERRE

Presenta al usuario:

> **P{n} completado.**
> - Commit: `{hash}` — {mensaje corto}
> - Pruebas: {n} pasando
> - Auditoría: todos los puntos en verde
> - Decisiones tomadas: {…}
> - Dudas para ti: {…}
> - **Siguiente: P{n+1} — {nombre}**
>
> ¿Continúo con P{n+1} o prefieres revisar antes?

**Espera confirmación del usuario antes de arrancar el siguiente paquete.**

---

## Si el contexto se compactó a mitad de un paquete

1. Lee `ESTADO.md` — indica el paquete en curso y hasta dónde se llegó
2. Lee `CLAUDE.md` completo otra vez
3. Revisa `git status` y `git diff` para ver el trabajo sin commitear
4. **Lee `docs/incidencias/README.md`** — si estabas peleando con un error antes de la compactación, es probable que ya esté registrado ahí
5. Declara: *"Reanudando P{n}. Según ESTADO.md iba en {fase}. El diff muestra {…}."*
5. Continúa desde ahí — **no reinicies el paquete desde cero**
