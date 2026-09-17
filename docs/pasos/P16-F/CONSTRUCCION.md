# P16-F — El eje de IP del login limita, no bloquea

> **Decisión del usuario D-16.196**: «el límite por destinatario es el principal; el de IP se calibra
> para IPs compartidas (CGNAT): umbral alto y solo 429, nunca bloqueo escalonado por IP sola. Revisar
> que el bloqueo del login por IP no pueda dejar fuera a toda una IP por los fallos de una sola
> cuenta; si puede, la escalada por IP se relaja y se registra como INC».
>
> **Podía.** Y el síntoma llevaba meses escrito en el repositorio, en el comentario que explica por
> qué la suite de integración borra `login_attempt` antes de empezar.

## 1 · Lo que se encontró

`iam/domain/politica-de-intentos.ts` contaba **fallos** en dos ejes y los dos abrían el **mismo
bloqueo escalonado** (1 → 5 → 15 → 60 min), con umbrales 5 (cuenta) y 25 (IP). Con eso:

- **25 fallos de una sola cuenta bloqueaban la IP entera.** La cuenta ya estaba bloqueada al quinto;
  el eje de IP solo sumaba víctimas: el resto del personal del local, con credenciales buenas.
- Se podía disparar **a propósito** desde el wifi del sitio, o contra el correo de la dueña, sin
  acertar una contraseña.
- Con **CGNAT**, las víctimas ni siquiera comparten negocio: son abonados del mismo operador.

## 2 · Lo que se construyó

| Archivo | Qué |
|---|---|
| `iam/domain/politica-de-intentos.ts` | `POLITICA_DE_LOGIN` deja de ser un registro por eje y es la del **eje de cuenta**, intacta. Nuevo `evaluarRociadoPorIp(fallos, ahora)`: cuenta **cuentas distintas** en 60 min, umbral **10**, y devuelve un enfriamiento **fijo de 15 min** desde el último fallo |
| `iam/domain/errores.ts` | `RociadoDeContrasenasError` (`LIMITE_DE_SOLICITUDES`, con `reintentarEnSegundos` para el `Retry-After`) |
| `iam/application/.../iniciar-sesion.ts` | `exigirNoBloqueado` evalúa solo el eje de cuenta; `exigirSinRociado` mira el de IP **después del bloqueo y antes del hash** |
| `repositorio-de-autenticacion.port.ts` · `prisma-autenticacion.repositorio.ts` | `porIp` pasa de `Date[]` a `{ at, email }[]`: para contar cuentas hay que saber cuáles |
| `migrations/20260917135821_p16f_limite_de_ip_en_login` | un tipo de evento: `auth.login.ip_limited`. El `down` **no borra la semilla** (M10/INC-011): el log es append-only |
| `docs/` | **ADR-028**, **INC-027**, `SEGURIDAD.md §2.1` (la tabla queda apartada en su segunda mitad, y lo dice), `docs/sistema/seguridad.md`, `app-cliente.md` (los dos 429 y en qué se diferencian) |

## 3 · Los números, y por qué

| | Antes | Ahora |
|---|---|---|
| Qué cuenta el eje de IP | fallos | **cuentas distintas** |
| Umbral | 25 / 60 min | **10 / 60 min** |
| Respuesta | `ACCESO_BLOQUEADO`, 1 → 5 → 15 → 60 min | **429 `LIMITE_DE_SOLICITUDES`**, 15 min **fijos** |

Un rociado son muchos **correos**, no muchos intentos: contando cuentas se mide la firma del ataque y
no su síntoma. Y la espera fija impide que la defensa se convierta en la denegación de servicio que
quería evitar.

**El precio, dicho:** un barrido de **nueve** cuentas por hora y por IP ya no lo corta este eje. Cada
cuenta sigue protegida por el suyo, por la política de contraseñas y por Argon2id.

## 4 · Cómo se verificó

```
dominio (politica-de-intentos.spec.ts)
  🔴 mil fallos de UNA cuenta no limitan la IP
  🔴 diez cuentas distintas sí; cuentasDistintas = 10
  🔴 y NO escala: cuarenta cuentas esperan lo mismo que diez
     el enfriamiento son 15 min desde el último fallo; a los 16 se pasa
     fuera de la ventana de una hora, las cuentas ya no cuentan

caso de uso (iniciar-sesion.spec.ts)
  🔴 mil fallos de UNA sola cuenta no tocan a las demás de esa IP
  🔴 diez cuentas distintas → RociadoDeContrasenasError
  🔴 el límite de IP NO escala (misma espera con 10 y con 40)
     limitar por IP no es bloquear una cuenta, y tampoco gasta un hash

HTTP (limite-de-ip-en-login.spec.ts, archivo propio)
  🔴 treinta fallos de UNA cuenta → otra cuenta de esa IP entra con 200
  🔴 diez cuentas distintas → 429 LIMITE_DE_SOLICITUDES con Retry-After ≤ 900 s
     y la misma cuenta entra desde otra IP: el límite es de la conexión
```

**Dos cosas se aprendieron escribiendo esas pruebas, y las dos valen más que las pruebas.**

**El 500 del catálogo.** El primer intento de la prueba de HTTP devolvió 500: `audit_log.event_type`
tiene clave foránea a `audit_event_type` y el evento nuevo no existía. De ahí la migración — y la
confirmación de que el catálogo hace su trabajo.

**El banco de pruebas es una IP compartida.** Las pruebas nuevas vivían al principio dentro de
`autenticacion-y-autorizacion.spec.ts`, insertando fallos y borrando `login_attempt` desde
`127.0.0.1`, que es de donde salen TODAS las suites. Resultado: tres archivos que no tenían nada que
ver se pusieron en rojo —un aviso de bloqueo que no se encoló, un despachador que no vio su fila, un
recuento de golpes que se descuadró—, porque el 429 nuevo les caía encima a mitad de camino, o porque
el borrado les quitaba los fallos que estaban contando.

Es **INC-027 a escala de banco de pruebas**: exactamente el daño que el cambio existe para evitar,
aparecido en el sitio donde no dolía. La prueba se mudó a un archivo propio que monta la aplicación
con `127.0.0.1` como proxy de confianza y manda `X-Forwarded-For` con una IP de documentación (RFC
5737): así vive en una dirección que no es de nadie, no borra la tabla de todos y no le cae encima a
ninguna otra suite.

## 5 · Decisiones

D-16.196 en `ESTADO.md`; **ADR-028**; **INC-027**.
