# INC-022 — Detrás del proxy toda petición llega con la IP de Caddy: el bloqueo por IP del login bloquearía a todos a la vez

> **El título es el síntoma.** Lo que se ve es que `login_attempt.ip` vale siempre lo mismo para todo el mundo, y que un límite «por IP» limita a todos juntos.

| Campo | Valor |
|---|---|
| **Fecha** | 2026-09-10 |
| **Paquete** | P16-A1 (el hueco existía desde P14b, el primer despliegue con Caddy) |
| **Área** | despliegue · seguridad |
| **Tiempo perdido** | ~0 en diagnóstico (se vio leyendo, antes de que pasara en producción); lo que costó fue la corrección: un helper, tres consumidores, un guard, una subred fija y tres suites |
| **Recurrencias** | 0 |

## Síntoma

**No hay mensaje de error.** Con la pila de producción levantada (`docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d`), todas las filas de `login_attempt` y de `session` llevan la **misma** IP, la del contenedor `caddy` en la red interna de compose:

```
costeo=# SELECT DISTINCT host(ip) FROM login_attempt;
   host
------------
 172.18.0.6
(1 row)
```

Consecuencias, todas silenciosas:

- **El bloqueo por IP del login** (25 fallos en 60 minutos, `iam/domain/politica-de-intentos.ts`) se dispara con los fallos de **todos los usuarios sumados**, y bloquea a **todos** —clientes distintos, companies distintas— durante 1 → 5 → 15 → 60 minutos. Veinticinco errores de contraseña en una hora entre todo el parque de restaurantes es un martes cualquiera.
- **El limitador global** (`ThrottlerGuard`, 300 peticiones por minuto) cuenta las de todos los usuarios en una sola cubeta: un cliente ruidoso agota el cupo del resto.
- **Cualquier límite por IP nuevo** —los cuatro de D-16.50— no mediría nada: sería otro límite global.

## Contexto

Revisión de solo lectura antes de construir el límite de tasa de P16-A1 (D-16.17). `auth.controller.ts` y `backoffice.controller.ts` tenían dos copias de `ipDe(peticion) = peticion.socket.remoteAddress`, y el comentario de cabecera del primero decía, literalmente:

> LA IP SALE DEL SOCKET, NO DE `X-Forwarded-For`, y es una decision de seguridad, no un descuido. […] Cuando el despliegue tenga proxy de confianza se configurara `trust proxy` y se leera de ahi — con el proxy delante, no antes.

El despliegue con proxy existe desde P14b (`docker/caddy/Caddyfile`, `reverse_proxy api:3000`). Nadie volvió al comentario. `trust proxy`, `trustProxy` y `X-Forwarded-For` no aparecían en ningún otro archivo del repositorio.

## Causa raíz

Tres caminos de IP independientes, ninguno consciente del proxy, y **la decisión correcta en P1** (no creer `X-Forwarded-For` sin proxy de confianza) convertida en la incorrecta por un cambio de despliegue que no la revisó:

1. `auth.controller.ts` → `login_attempt.ip`, `session.ip` y el eje de IP del bloqueo.
2. `backoffice.controller.ts` → `backoffice_access_log.ip` y el login del operador.
3. `ThrottlerGuard` de `@nestjs/throttler` → su rastreador por defecto (`req.ip` en Express), **sin una sola línea de código propia que lo delatara**.

Y un cuarto factor que habría hecho frágil cualquier arreglo: la red de compose no declaraba subred, así que un `PROXY_DE_CONFIANZA` escrito como CIDR podía dejar de casar tras un `docker compose down`/`up` que reasignara la red, y el efecto sería volver en silencio a la IP del socket.

## Solución

Un solo camino, `apps/api/src/shared/infrastructure/http/ip-del-cliente.ts` (D-16.49):

```ts
// Se cree el ULTIMO salto de X-Forwarded-For SOLO si el socket esta en PROXY_DE_CONFIANZA
// (IPv4, CIDR v4 o IPv6 exacta). Si no, la IP es la del socket. Lo que no parsea como IP
// cae al socket (login_attempt.ip es INET). `::ffff:a.b.c.d` se normaliza a `a.b.c.d`.
ipDelCliente(peticion, proxiesDeConfianza): string | null
```

- Lo usan el login, el back office (`SesionDelOperador.proxiesDeConfianza`, leída a mano de `PROXY_DE_CONFIANZA` como `BACKOFFICE_PORT`), `LimitadorDeTasa` y **el limitador global** (`LimitadorGlobalGuard extends ThrottlerGuard`, con `getTracker`, registrado en `app.module.ts` en vez de `ThrottlerGuard`). Las dos copias de `ipDe` desaparecieron y el comentario de `auth.controller.ts` dice ahora lo contrario de lo que decía.
- `PROXY_DE_CONFIANZA` en `environment.ts`, lista separada por comas, **validada en el campo** (INC-008), vacía por defecto → `Configuration.proxiesDeConfianza`.
- `docker-compose.prod.yml`: la red por defecto gana subred fija `172.28.0.0/24` y **Caddy una IP fija dentro de ella, `172.28.0.10`** (`ipv4_address`); `scripts/vps/preparar.sh` deja `PROXY_DE_CONFIANZA=172.28.0.10` en la plantilla; `api` la exige en producción. Cambiar la subred o la IP exige `docker compose down` + `up`: un `restart` no toca la IPAM de una red viva (`docs/runbooks/despliegue.md`).
- **Por qué la IP de Caddy y no la subred** (corrección tras la revisión adversarial de la etapa): la primera versión confiaba en `172.28.0.0/24` entera, que incluye la pasarela `172.28.0.1` —la dirección de origen que ve el contenedor cuando algo del propio VPS entra por el puerto publicado `127.0.0.1:3000` (docker-proxy)— y a todos los demás contenedores (`web`, `correo`, `pgbouncer`, `db`). Cualquier proceso del host o contenedor comprometido podía entonces poner la `X-Forwarded-For` que quisiera: esquivar el límite por IP o envenenar la de un tercero, exactamente «la lista amplia» que `ip-del-cliente.ts` dice no permitir. CLAUDE.md §4 manda la opción más restrictiva y existía: una sola dirección. La subred sigue fija para que esa dirección no cambie tras `down`/`up`.

## Qué NO era

- **`app.set('trust proxy', …)` de Express** → descartado porque solo arregla `req.ip` (el camino 3) y deja intactos los otros dos, que leen `socket.remoteAddress` a mano; y porque su semántica («confía en N saltos» o en rangos con nombres como `loopback`/`uniquelocal`) es más amplia de lo que hace falta y más fácil de configurar de más. Una lista explícita de direcciones, vacía por defecto, es la opción más restrictiva.
- **Leer el primer salto de la cabecera** → descartado: el primero lo pone el cliente (o quien quiera); el último lo pone el proxy en el que se confía, con lo que vio en su socket.
- **Confiar en «las IP privadas»** → descartado: es el envenenamiento con otro nombre. Cualquier contenedor de la máquina, o cualquiera detrás de un NAT compartido, podría elegir su IP.

## Prevención

- [x] **Prueba automatizada — es la prevención principal.** `test/integracion/ip-tras-el-proxy.spec.ts`: con par **no** confiable, diez `/olvido` con diez `X-Forwarded-For` distintas siguen siendo diez golpes de la misma clave y el undécimo es 429; `login_attempt.ip` guarda el socket. `test/integracion/limite-de-tasa.spec.ts`: con par confiable, la cabecera **sí** cambia la clave y `login_attempt.ip` guarda el último salto. `test/integracion/limitador.spec.ts`: el limitador global distingue por cabecera con par confiable. `ip-del-cliente.spec.ts`: 71 casos de borde del parseo (puerto, `for=`, zona, IPv4 mapeada, CIDR, `/0`, `/32`, cabecera repetida, lista mal escrita).
- [x] **Verificación de `npm run audit`:** ninguna nueva. No hay patrón textual que la detecte (`socket.remoteAddress` tiene un uso legítimo: dentro del propio helper), y una regla que prohibiera la cadena fuera de `ip-del-cliente.ts` sería la siguiente que alguien exime. Queda dicho aquí; si aparece una segunda copia de `ipDe`, entonces sí se escribe la regla.
- [x] **Regla en `CLAUDE.md`:** no hace falta una nueva. La que existía —«ante cualquier duda de seguridad, la opción más restrictiva»— era la que produjo el `ipDe` del socket, correcta en su día. Lo que falló es que **un comentario que dice «cuando el despliegue tenga X» es una deuda con vencimiento, y nadie la cobró**. Es la clase de fallo de INC-018/019/020: solo aparece ejecutando el sistema entero como se va a ejecutar de verdad.
- [x] **ADR:** ADR-026 (límite de tasa e IP tras el proxy), en el cierre del paquete.

## Referencias

- `docs/decisiones/ADR-006-las-tres-barreras-del-aislamiento.md` — el umbral por IP del login y por qué es distinto del de cuenta.
- `docs/pasos/P16/PLAN.md` D-16.36, D-16.49, D-16.50; `docs/pasos/P16-A1/CONSTRUCCION.md`.
- `@nestjs/throttler` 6.5.0, `ThrottlerGuard.getTracker` — el punto de extensión documentado para proxies (consultado 2026-09-10 en `node_modules/@nestjs/throttler/dist/throttler.guard.d.ts`).
- Caddy `reverse_proxy` añade `X-Forwarded-For` por defecto (`docker/caddy/Caddyfile` no cambia).
