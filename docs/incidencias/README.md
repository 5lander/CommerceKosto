# Incidencias de desarrollo — índice

> **Qué es esto.** El registro de problemas que ya costaron tiempo resolver una vez, para que no vuelvan a costarlo.
> **Qué NO es.** No es `docs/runbooks/incidentes.md`, que trata incidentes operativos en producción. Aquí van los problemas de construcción: errores de build, migraciones que fallan, tipos que no cuadran, pruebas que se rompen sin razón aparente.

## Cómo se usa

**Al empezar cualquier diagnóstico**, antes de investigar: buscá el síntoma en la tabla de abajo. Si está, seguí la solución registrada. Si el mensaje de error se parece pero no es idéntico, abrí igual la incidencia: la causa raíz suele ser la misma.

**Al resolver un problema que costó tiempo**, registralo. Copiá `docs/plantillas/INCIDENCIA.md` a `INC-{NNN}-{slug}.md`, llenala y añadí la fila al índice.

**Si un problema ya registrado vuelve a pasar**, no crees una incidencia nueva: subí el contador de recurrencias en la existente y agregá lo que aprendiste. Una incidencia con tres recurrencias es una señal de que la prevención no se hizo.

## Qué merece registrarse

Solo esto. El objetivo es un índice que se pueda leer entero en dos minutos; si se llena de ruido, nadie lo consulta y deja de servir.

| Sí | No |
|---|---|
| Costó más de ~20 minutos diagnosticar | Un typo o un import olvidado |
| La causa no era evidente desde el mensaje de error | Un error cuyo mensaje decía exactamente qué hacer |
| El mensaje de error apuntaba al lugar equivocado | Algo que ya está cubierto por `npm run audit` |
| Ya pasó dos veces | Una decisión de diseño (eso es un **ADR**) |
| Hubo que buscar fuera del proyecto para resolverlo | Un requisito nuevo (eso es el **SPEC**) |
| Involucró comportamiento raro de una herramienta o del pool de conexiones | |

## Regla de oro

**Una incidencia que se puede convertir en verificación automática, se convierte.** Documentar un problema que `npm run audit` podría detectar es aceptar que va a volver a pasar. La sección "Prevención" de la plantilla no es opcional.

---

## Índice

Ordenado por área. **Buscá por síntoma, no por causa.**

| # | Síntoma | Área | Paquete | Recurrencias |
|---|---|---|---|---|
| — | *(vacío: aún no hay incidencias registradas)* | — | — | — |

---

## Áreas frecuentes en este proyecto

Anticipando dónde es más probable que aparezcan, según las decisiones ya tomadas:

| Área | Por qué es probable |
|---|---|
| **RLS y contexto de tenant** | El `SET LOCAL` fuera de transacción no persiste entre conexiones del pool. Síntoma típico: consultas que devuelven cero filas sin razón aparente, o peor, filas de otro tenant |
| **PgBouncer en modo transacción** | Prepared statements de Prisma. Síntoma: errores intermitentes que no se reproducen en local |
| **Reglas de capa** | `dependency-cruiser` rompiendo el build por un import que parecía inocente |
| **Aritmética decimal** | Un `number` que se cuela en un cálculo de dinero y produce un centavo de diferencia en la conciliación |
| **Cascada de subpreparaciones** | Orden topológico y memorización. Síntoma: costo que cambia entre dos corridas idénticas |
| **Migraciones reversibles** | Un `down` que no deshace realmente lo que hizo el `up` |
