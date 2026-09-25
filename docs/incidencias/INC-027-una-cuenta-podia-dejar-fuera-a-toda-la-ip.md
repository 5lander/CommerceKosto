# INC-027 — Una sola cuenta podía dejar fuera del login a toda su IP

| Campo | Valor |
|---|---|
| **Fecha** | 2026-09-17 |
| **Paquete** | P16-F (revisión pedida por D-16.196) |
| **Área** | seguridad · arquitectura |
| **Tiempo perdido** | ~30 min (la revisión; el síntoma llevaba meses a la vista) |
| **Recurrencias** | 0 |

> **El síntoma estaba escrito en el repositorio desde P1 y nadie lo leyó como lo que era.** La suite
> de integración borra `login_attempt` antes de empezar, con este comentario: «los fallos deliberados
> de una corrida se acumulan y a la enésima corrida **bloquean la IP entera**, con lo que la suite
> empieza a fallar por una razón que no tiene que ver con lo que mide».

## Síntoma

Nadie puede entrar desde el local, con las credenciales correctas, y no hay ninguna cuenta bloqueada
que lo explique. Pasa después de que **una** persona insista con una contraseña vieja, o de que
alguien pruebe a propósito contra **un** correo conocido.

En desarrollo, la misma cara: una suite de pruebas que empieza a fallar en sitios que no había
tocado nadie.

## Contexto

El login contaba fallos en dos ejes, cuenta e IP, y **los dos abrían el mismo bloqueo escalonado**
(1 → 5 → 15 → 60 minutos) con umbrales distintos: 5 y 25. El eje de IP estaba pensado contra el
rociado de contraseñas.

## Causa raíz

**El eje de IP contaba fallos, no cuentas.** Veinticinco fallos de la misma cuenta desde una IP
llegaban al umbral igual que veinticinco correos distintos, y la escalada dejaba la dirección fuera
hasta una hora. Es un ataque de denegación de servicio que cualquiera dispara sin acertar una sola
contraseña: desde el wifi del local, o contra el correo de la dueña.

Con CGNAT es peor: detrás de esa IP no hay un restaurante, hay cientos de abonados del mismo
operador que no tienen nada que ver.

## Solución

D-16.196 / **ADR-028**: el eje de cuenta se queda; el de IP **limita en vez de bloquear**, cuenta
**cuentas distintas** (10 en una hora) y responde **429 con `Retry-After` de 15 minutos fijos**, sin
escalada. Una sola cuenta, falle mil veces, no toca ese eje — la bloquea el suyo.

## Prevención

- [x] **🔴 en los tres niveles**, y son el guardián: si alguien vuelve a contar fallos en el eje de
  IP, «mil fallos de UNA cuenta no limitan la IP» se pone en rojo en el dominio, en el caso de uso y
  por HTTP.
- [x] **🔴 «y NO escala»**: cuarenta cuentas esperan lo mismo que diez. Devolver la escalada al eje de
  IP lo pone en rojo.
- [x] **La regla queda en el dominio** (`evaluarRociadoPorIp`), no en el adaptador: se prueba sin base
  de datos y sin reloj.
- [x] **Las pruebas del límite viven en una IP que no es de nadie** (`limite-de-ip-en-login.spec.ts`,
  con proxy de confianza y `X-Forwarded-For` de RFC 5737). La primera versión las metió en la suite de
  autenticación, desde `127.0.0.1`, y puso en rojo tres archivos ajenos: el 429 les caía encima o el
  borrado de `login_attempt` les quitaba los fallos que contaban. **Fue esta misma incidencia vista
  desde el banco de pruebas**, y la regla que deja es: una prueba que limita por IP no puede compartir
  la IP con las demás.
- [ ] **Lo que no se automatiza**: que la suite de autenticación ya no necesite borrar
  `login_attempt`. Se deja el borrado —las pruebas siguen generando fallos por cuenta— pero el motivo
  escrito en su comentario ya no es cierto, y el comentario lo dice.

## Referencias

- ADR-028 · ADR-026 · INC-022 · `politica-de-intentos.ts` → `evaluarRociadoPorIp`.
