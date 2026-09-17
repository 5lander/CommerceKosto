# ADR-028 — El eje de IP del login limita, no bloquea

| | |
|---|---|
| **Fecha** | 2026-09-17 |
| **Estado** | Aceptada |
| **Paquete** | P16-F |
| **Decisión del usuario** | D-16.196 |
| **Sustituye en parte a** | los umbrales por eje del login (cuenta 5 / IP 25, misma escalada), que vivían en `iam/domain/politica-de-intentos.ts` desde P1 |
| **Relacionadas** | ADR-026 (límite de tasa e IP tras el proxy) · INC-022 (la IP del proxy) · INC-027 (esto) |

## Contexto

El login contaba fallos en **dos ejes** y los dos abrían el mismo bloqueo escalonado —1 → 5 → 15 → 60
minutos—, con umbrales distintos: **5 por cuenta, 25 por IP**. El eje de IP existía para cortar el
**rociado de contraseñas**: una IP probando `Verano2026` contra cien correos, donde ninguna cuenta
llega a cinco fallos y sin ese eje el barrido pasa entero.

La revisión de D-16.196 —«que el bloqueo por IP no pueda dejar fuera a toda una IP por los fallos de
una sola cuenta»— encontró que **sí podía**:

- Veinticinco fallos **de la misma cuenta** desde una IP bloqueaban esa IP. El cocinero que insiste
  con la contraseña vieja dejaba fuera al resto del personal, con credenciales buenas, hasta una
  hora. Su cuenta ya estaba bloqueada al quinto fallo: el eje de IP solo añadía víctimas.
- Cualquiera podía dispararlo **a propósito** desde la acera con el wifi del sitio, o contra el
  correo de la dueña, sin acertar una sola contraseña.
- Con **CGNAT** el operador mete cientos de abonados detrás de la misma dirección pública: la IP no
  identifica a un cliente, y bloquearla castiga a desconocidos que no comparten ni el negocio.

La propia suite de integración lo sufría y lo decía por escrito: borra `login_attempt` antes de
empezar porque «a la enésima corrida bloquean la IP entera».

## Decisión

**El eje de cuenta se queda como está** (5 fallos / 15 min, escalada 1 → 5 → 15 → 60, aviso al
titular en la transición). Bloquea una credencial por sus propios fallos y no alcanza a nadie más.

**El eje de IP deja de bloquear y pasa a limitar**, con tres cambios:

| | Antes | Ahora |
|---|---|---|
| Qué cuenta | fallos desde la IP | **cuentas distintas** tanteadas desde la IP |
| Umbral | 25 en 60 min | **10 cuentas distintas** en 60 min |
| Respuesta | `ACCESO_BLOQUEADO`, escalando a 60 min | **429 `LIMITE_DE_SOLICITUDES`** con `Retry-After`, **15 min fijos** desde el último fallo |

Contar cuentas distintas es contar **la firma del rociado**, no el síntoma: un barrido son muchos
correos, no muchos intentos. Con eso, una sola cuenta —mil fallos— no toca nunca el eje de IP.

La duración fija es lo que impide que el límite se convierta en la denegación de servicio que quería
evitar: insistir alarga la espera (el enfriamiento cuenta desde el último fallo) pero nunca la
agrava, y una IP compartida no se queda fuera más de un cuarto de hora por lo que hagan otros.

**Los dos salen como 429, y aun así son distintos.** `ACCESO_BLOQUEADO` dice «esta cuenta está
cerrada»; `LIMITE_DE_SOLICITUDES` dice «esta dirección tiene que esperar», y detrás puede no haber
nadie culpable. Por eso son dos errores —`AccesoBloqueadoError` y `RociadoDeContrasenasError`— con
dos códigos y dos eventos de auditoría: `auth.login.blocked` y `auth.login.ip_limited` (migración
`p16f_limite_de_ip_en_login`). Quien recibe uno u otro no hace lo mismo: pedir una contraseña nueva
no arregla un límite de IP, y esperar no desbloquea una cuenta.

## Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| **Subir el umbral de fallos por IP** (25 → 200) | No arregla nada: sigue siendo una cuenta la que puede llegar sola al techo, solo tarda más. Y para el rociado sigue midiendo lo que no es |
| **Descontar del eje de IP los fallos de cuentas ya bloqueadas** | Arregla el caso de la cuenta única y deja abierto el de dos, y necesita saber en el eje de IP el estado de cada cuenta: más máquina para una regla peor |
| **Quitar el eje de IP** | Deja pasar el rociado entero, que es lo único que el eje sí cortaba |
| **CAPTCHA a partir del tercer fallo** (SEGURIDAD.md §2.1) | Es otra decisión, con proveedor y coste; y no sustituye al límite, lo acompaña. Sigue pendiente |

## Consecuencias

- Un rociado de **nueve** cuentas por hora y por IP ya no se corta por este eje. Es el precio: se
  eligió no castigar a terceros. Lo que sí sigue protegiendo a cada cuenta es su propio bloqueo, y a
  todas, la política de contraseñas y el hash Argon2id.
- `login_attempt` se lee ahora con el correo además de la fecha en el eje de IP; el índice
  `(ip, at)` sigue sirviendo.
- La tabla de SEGURIDAD.md §2.1 —«5 intentos / 15 min por cuenta **y** por IP»— queda apartada en su
  segunda mitad, y la sección lo dice.

## Verificación

🔴 en `politica-de-intentos.spec.ts` (dominio), `iniciar-sesion.spec.ts` (caso de uso) y
`autenticacion-y-autorizacion.spec.ts` (HTTP):

- mil fallos de **una** cuenta desde una IP **no** limitan esa IP, y otra cuenta entra con sus
  credenciales;
- **diez cuentas distintas** sí: 429 `LIMITE_DE_SOLICITUDES` con `Retry-After` ≤ 15 min;
- **no escala**: cuarenta cuentas esperan lo mismo que diez;
- el enfriamiento son 15 minutos desde el último fallo, y a los 16 se pasa;
- fuera de la ventana de una hora, las cuentas ya no cuentan;
- limitado por IP **tampoco gasta un hash**: el Argon2id no se toca.
