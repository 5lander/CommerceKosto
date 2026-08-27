# MODO-AUTONOMO.md — Corrida larga sin intervención

> Variante del protocolo para construir varios paquetes seguidos sin esperar confirmación entre cada uno.
> Se activa cuando el usuario dice: **"modo autónomo hasta P{n}"**.
> Todo lo demás de `PROTOCOLO.md` y `AUDITORIA.md` sigue vigente **sin excepción**.

---

## Qué cambia respecto al protocolo normal

| Fase | Protocolo normal | Modo autónomo |
|---|---|---|
| PLAN | Espera aprobación del usuario | Se escribe en `ESTADO.md` y **se continúa** |
| CIERRE | Espera confirmación para el siguiente P | **Avanza solo** al siguiente paquete |
| Todo lo demás | Igual | **Igual** — recarga, auditoría completa, un commit por paquete, actualizar estado |

## Qué NO cambia nunca

1. **Releer `CLAUDE.md`, `ESTADO.md` y `DECISIONES.md` al inicio de cada paquete** — más importante aún en corridas largas, porque el contexto se compacta seguro
2. **Auditoría completa antes de cada commit** — ejecutar `npm run audit` (verificación automatizada) además de la checklist manual
3. **Un commit por paquete**, con el formato establecido
4. **Actualizar `ESTADO.md`** al cerrar cada paquete
5. **Nunca commitear en rojo**

---

## Cuándo SÍ debe detenerse (condiciones de parada)

El modo autónomo se detiene y espera al usuario **únicamente** si:

1. Una decisión necesaria **no está** en `DECISIONES.md` ni en el SPEC, y elegir mal sería caro de revertir
2. Una decisión marcada 🔴 en `DECISIONES.md` bloquea el paso actual
3. La auditoría falla y el arreglo **contradice** algo del SPEC (conflicto entre documentos)
4. Dos intentos de arreglar el mismo fallo de pruebas no lo resuelven (evitar bucles destructivos)
5. Haría falta una dependencia nueva no listada
6. Cualquier acción destruiría trabajo commiteado

Al detenerse: registrar en `ESTADO.md` **el punto exacto**, la razón, y las opciones con su recomendación. Luego avisar al usuario y esperar.

**Ante la duda entre detenerse o inventar: detenerse.** Una parada cuesta minutos; una invención mala cuesta paquetes enteros.

---

## Disciplina de contexto en corridas largas

- Tras cada compactación percibida: **releer `ESTADO.md` antes que nada** y declarar en qué punto se retoma
- No mantener "en la cabeza" nada importante: si una decisión se tomó, va a `ESTADO.md` **en el momento**, no al final
- Si el paquete es grande (P1, P6), actualizar `ESTADO.md` también **a mitad** del paquete (fase de implementación alcanzada, archivos creados)
- Preferir varios archivos pequeños y verificables a pocos archivos gigantes

---

## Servicios externos: SIEMPRE tras adaptador falso

Para que la corrida no se atasque por falta de credenciales:

- **Todo servicio externo** (correo transaccional, almacenamiento de archivos) se implementa **primero como adaptador falso** que cumple el puerto: respuestas realistas, latencia simulada, escenarios de error activables
- El adaptador real se selecciona por variable de entorno (`WHATSAPP_ADAPTER=fake|real`)
- **El sistema completo debe poder levantarse y probarse de punta a punta sin una sola credencial real**
- Los fakes viven en `infrastructure/fakes/` y son parte del código mantenido, no descartables: son la base de las pruebas de integración

---

## Al terminar la corrida

Presentar el resumen completo:

```
CORRIDA AUTÓNOMA COMPLETADA — P{inicio} → P{fin}

Por paquete:
  P{n}: commit {hash} · {n} pruebas · auditoría OK
  ...

Decisiones tomadas con valor provisional: {lista}
Dudas registradas para el usuario: {lista}
Paradas ocurridas y su resolución: {lista}
Estado de ESTADO.md: actualizado

Siguiente paso sugerido: {…}
```
