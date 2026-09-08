# ADR-016 — Un VPS en Hostinger con PostgreSQL propio, y lo que eso cuesta

| | |
|---|---|
| **Estado** | Aceptada — **cierra D10** |
| **Fecha** | 2026-09-08 |
| **Contexto** | `DECISIONES.md` D10 · `CLAUDE.md` §4.1 · Fase B del sprint de salida |

D10 dejaba «contenedores sobre AWS, con PostgreSQL gestionado» como **valor provisional** y aplazaba
el servicio concreto. Aquí se cierra, y el resultado no es el que D10 suponía.

---

## 1. La decisión

**Un único VPS en Hostinger, corriendo el `docker-compose` del proyecto: PostgreSQL, PgBouncer y la
API en la misma máquina.** PostgreSQL **no** es gestionado: es nuestro.

| | |
|---|---|
| Plan | KVM 1 (1 vCPU, 4 GiB, 50 GB NVMe) o KVM 2 (2 vCPU, 8 GiB) |
| Coste | **$6,49/mes** con dos años prepagados, **$11,99/mes** al renovar (KVM 1) |
| Región | Sudamérica — la más cercana a Ecuador de todo lo evaluado |
| Respaldos del proveedor | **Semanales**, del VPS entero, sin PITR |

Se evaluaron y se descartaron: DigitalOcean App Platform + Managed PostgreSQL (≈ $27/mes),
DigitalOcean Droplet + Managed PostgreSQL (≈ $27/mes) y AWS RDS + App Runner (≈ $17-20/mes).

---

## 2. Lo que se gana, y no es el precio

**a) El arranque de roles funciona tal cual está probado.** Es lo más importante y no era obvio.

`docker/postgres/initdb/` crea `costeo_migrator` y `costeo_app` con `roles.sql`, y aplica
`grants.sql` con `ALTER SCHEMA public OWNER TO costeo_migrator` y los DEFAULT PRIVILEGES. **Ese hook
solo existe si la base es nuestra.** Con un PostgreSQL gestionado hay que reescribirlo como un script
de arranque que se ejecute una vez con el usuario admin del proveedor — código nuevo, no probado, en
la pieza de la que depende la Barrera 1 entera.

Aquí ese trabajo no existe: producción monta exactamente lo que CI monta.

**b) `shared_preload_libraries=pg_stat_statements` está en el compose y funciona.** En un gestionado
es un grupo de parámetros del proveedor, y en algunos ni se puede.

**c) PgBouncer es el nuestro, en modo transacción.** Es el mismo contra el que `pgbouncer.spec.ts`
demuestra la cuarta condición de D12 — la única que podía obligar a reabrir la decisión de ORM. En
AWS, RDS Proxy no es PgBouncer y cuesta más que la propia base.

**d) Latencia.** Hostinger tiene centro de datos en Sudamérica. DigitalOcean no tiene ninguno; AWS
tiene São Paulo, que desde Ecuador suele ir peor que Miami.

**e) Recursos por el dinero.** 4 GiB de RAM por $6,49 frente a 1 GiB de base + 1 GiB de contenedor
por $27.

---

## 3. Lo que se pierde — y hay que decirlo entero

**a) No hay failover.** Una sola máquina, un solo PostgreSQL, sin réplica ni standby. Si la máquina
cae, el sistema está caído hasta que se levante otra y se restaure. No son segundos: es una hora
larga, con el runbook delante.

**b) Los parches del sistema operativo son nuestros.** Kernel, Docker, la imagen de PostgreSQL. La
imagen está fijada por digest (`CLAUDE.md` §1), lo cual es bueno para la reproducibilidad y significa
que **subir de versión es un acto deliberado que alguien tiene que hacer**. Nadie lo hará por
nosotros.

**c) El respaldo es nuestro, y es el riesgo real.** Los respaldos de Hostinger son **semanales y del
VPS entero**. El libro de inventario es append-only (R3) y **no se reconstruye desde ningún otro
sitio**: ni desde el Excel del cliente, ni volviendo a importar. Un fallo el viernes con el último
respaldo del domingo son seis días de movimientos, ventas y conteos perdidos para siempre.

Por eso la decisión viene con una condición que no es opcional: **`pg_dump` diario más archivado de
WAL a almacenamiento fuera de la máquina, con la restauración probada de verdad.** Está en
`scripts/respaldo.mjs` y en `docs/runbooks/respaldos-y-restauracion.md`, y su diseño responde a
INC-007: no basta con escribir un archivo cada día, hay que **restaurarlo y comparar los recuentos**,
o el respaldo es una creencia.

**d) La base y la API comparten máquina.** Un consumo de memoria desbocado en una afecta a la otra.
Se acota con límites de recursos en el compose.

**e) El precio anunciado exige dos años prepagados.** Al renovar casi se dobla. Sigue siendo la opción
más barata de las cuatro, pero el número honesto para planificar es **$11,99**, no $6,49.

---

## 4. Por qué no la opción «correcta»

Un PostgreSQL gestionado con respaldos, PITR y failover del proveedor es, en abstracto, mejor
ingeniería. Se descartó por esto:

**Con un cliente, lo que importa no es la disponibilidad teórica: es que quien opera esto sepa
arreglarlo a las once de la noche.** Un VPS con `docker compose` es la pila que ya corre en la
máquina de desarrollo y en CI, con los mismos comandos y los mismos registros. AWS añade VPC,
subredes, grupos de seguridad, grupos de parámetros, IAM y la conectividad App Runner–RDS: a las
23:00 la pregunta deja de ser «¿por qué se cayó la API?» y pasa a ser «¿por qué App Runner no llega a
la base?», que es otra clase de noche.

**Y el failover que se pierde compra menos de lo que parece con esta topología.** Con una sola
instancia de API, si cae la máquina el sistema está caído aunque la base tenga standby.

---

## 5. Cuándo se revisa esta decisión

No es para siempre. Los disparadores, escritos ahora para no discutirlos luego:

| Disparador | Qué hacer |
|---|---|
| **Un segundo cliente de pago** | Separar la base a un servicio gestionado. El coste deja de ser el factor y el failover empieza a comprar algo |
| **Más de diez ubicaciones en una company** | Es el techo que P9 midió para el consolidado (ADR-012 §7). Antes de tocar infraestructura, las vistas materializadas |
| **Una caída que cueste datos** | Aunque el respaldo funcione. Si pasó una vez con una máquina, pasará |
| **P15** | Ahí se revisa esto con el pentest y el volumen sintético delante |

---

## Consecuencias

- **D10 pasa de 🟡 a ✅**, con un valor distinto al provisional.
- La cadena de respaldo deja de ser una tarea de infraestructura y pasa a ser **código del
  repositorio, con su prueba**. Es el efecto secundario más valioso de esta decisión.
- `docs/runbooks/respaldos-y-restauracion.md` y `rotacion-secretos.md` dejan de ser plantillas.
- Queda registrado que **no hay failover**: si alguien lee esto dentro de seis meses tras una caída,
  que sepa que fue una decisión y no un olvido.
