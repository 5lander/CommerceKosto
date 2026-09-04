# INC-002 — `psql: command not found` al correr los scripts de migración

| Campo | Valor |
|---|---|
| **Fecha** | 2026-08-27 |
| **Paquete** | P0 |
| **Área** | base de datos |
| **Tiempo perdido** | 0 min — **anticipada en la fase PLAN** |
| **Recurrencias** | 0 |

## Síntoma

```
/usr/bin/bash: line 1: psql: command not found
```

Al ejecutar `npm run migrate:down`, `npm run migrate:verify` o cualquier script que aplique SQL directamente.

## Contexto

La máquina de desarrollo tiene Docker, Node 24 y Git Bash, pero **no tiene el cliente de PostgreSQL instalado en el PATH**. Es lo normal en Windows: PostgreSQL corre dentro del contenedor y nadie instala las herramientas de línea de comandos aparte.

El problema aparece precisamente donde más duele: en los scripts de reversión de migraciones, que es cuando alguien está intentando deshacer algo y no quiere pelearse además con la herramienta.

## Causa raíz

Los scripts necesitan `psql` —y no `prisma db execute`— por tres razones concretas que no son negociables:

| Necesidad | Por qué `psql` |
|---|---|
| `--single-transaction` | El DDL del `down.sql` y el borrado de la fila de `_prisma_migrations` tienen que ser atómicos: o se revierte todo, o no se revierte nada |
| `-v ON_ERROR_STOP=1` | Parar en el primer error. Sin esto, un `down` a medias deja la base en un estado que no es ni el de antes ni el de después |
| Elegir el rol | Las migraciones corren como `costeo_migrator`, no como el rol de la aplicación |

Asumir que `psql` está disponible es un supuesto de entorno no declarado.

## Solución

`scripts/lib/psql.ts` resuelve el ejecutable en tiempo de ejecución, con una cascada explícita:

1. Si `psql` está en el PATH, se usa directamente.
2. Si no, se ejecuta dentro del contenedor: `docker compose exec -T db psql ...`, redirigiendo el archivo por stdin.
3. Si tampoco hay Docker corriendo, **falla con un mensaje que dice exactamente qué hacer**, no con `command not found`.

```bash
docker compose exec -T db \
  psql --single-transaction -v ON_ERROR_STOP=1 \
       -U costeo_migrator -d costeo \
  < prisma/migrations/<dir>/down.sql
```

El `-T` es obligatorio: sin él, `docker compose exec` intenta asignar un TTY y la redirección por stdin no funciona en un script no interactivo.

## Qué NO era

- **No es que falte instalar PostgreSQL en la máquina.** Se podría, pero entonces el proyecto solo funcionaría en máquinas donde alguien se acordó de hacerlo. La solución tiene que estar en el repositorio.
- **No se resuelve usando `prisma db execute`.** Ese comando no ofrece `--single-transaction` ni `ON_ERROR_STOP`, que son justo lo que hace segura una reversión. Queda documentado en el runbook como salida de emergencia cuando no hay Docker, con la advertencia de que no es atómico.
- **No es un problema de rutas de Windows.** El ejecutable no existe; no es que esté en otro sitio.

## Prevención

- [x] ¿Se puede convertir en una verificación de `npm run audit`? **Parcialmente.** `npm run doctor` comprueba y reporta qué vía de `psql` está disponible antes de que haga falta, en vez de descubrirlo a mitad de una reversión.
- [x] ¿Se puede convertir en una prueba automatizada? **Sí.** `migrate:verify` corre en CI y ejercita la ruta de `psql` en cada PR que toque `prisma/`.
- [ ] ¿Es una regla que debería estar en `CLAUDE.md`? No.
- [ ] ¿Es una decisión que merece un ADR? Se registra dentro del ADR de migraciones reversibles.

## Referencias

- Documentación de `docker compose exec`, opción `-T` (`--no-TTY`) — consultado 2026-08-27
