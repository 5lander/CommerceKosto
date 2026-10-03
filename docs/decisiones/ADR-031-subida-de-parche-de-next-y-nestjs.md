# ADR-031: Subida de parche de Next.js y NestJS, y fuera el override de multer

> Architecture Decision Record. **Inmutable una vez aceptado**: si la decisión cambia, se escribe un ADR nuevo que lo reemplaza.

| Campo | Valor |
|---|---|
| Estado | ✅ aceptado |
| Fecha | 2026-10-03 |
| Paquete | Dependencias (commit propio, previo a P16-K) |
| Decisores | Usuario / Claude Code |
| Actualiza | **ADR-001** §3 y §6, solo en la versión de parche. El resto de ADR-001 —majors, fechas de fin de soporte, criterio de elección— sigue vigente |

## Contexto

El 2026-10-01, al cerrar P16-K, `npm run audit` falló en `audit:deps` con tres avisos graves. Ninguno venía de P16-K: eran avisos nuevos del registro sobre versiones que ya estaban instaladas.

| Paquete | Aviso | Va en producción |
|---|---|---|
| `next` 16.3.4 | **Crítico**: ejecución remota de código en `next/og`, arreglado desde 16.3.6 | Sí |
| `fast-uri`, `brace-expansion`, `qs` | Graves, en dependencias transitivas | Herramientas de desarrollo y transitivas |
| `multer` 2.2.0 | Graves. Apareció al arreglar lo anterior: `@nestjs/platform-express` 11.2.3 **fija `multer` 2.2.0 exacto** | Sí, vía `platform-express` |

Y una deuda previa que esto destapa: ADR-001 fijaba Next **16.3.3**, pero `apps/web` llevaba en **16.3.4** sin que ningún documento lo dijera (BRECHAS de P16-K, C4).

## Opciones consideradas

| Opción | A favor | En contra |
|---|---|---|
| (a) Restaurar el lock de HEAD con el override `multer` 2.3.0 | Cambio mínimo | El lock de HEAD era **inconsistente**: `platform-express` 11.2.3 pide `multer` 2.2.0 exacto y el override lo pisaba. Restaurarlo es frágil, y es la clase de fallo de INC-021 |
| **(b) Subir toda la familia `@nestjs/*` fijada en 11.2.3 a 11.2.7** | `platform-express` 11.2.7 trae `multer` 2.4.0: queda **una sola versión** en el árbol y el override sobra | Mueve la versión fijada en ADR-001 y CLAUDE.md §1 |
| (c) Aceptar el aviso de `multer` como vulnerabilidad documentada | Sin tocar Nest | Hay un arreglo disponible y sin coste de major: aceptar un aviso grave arreglable no cumple `audit:deps` |

## Decisión

**El usuario eligió (b)**, con pin exacto. Las versiones fijadas pasan a:

| Componente | ADR-001 | Ahora |
|---|---|---|
| NestJS (`common`, `core`, `platform-express`) | 11.2.3 | **11.2.7** |
| Next.js | 16.3.3 (instalada 16.3.4) | **16.3.8** |

Y además:

- **Se retira el `overrides` de `multer`** del `package.json` raíz. Era la condición escrita al añadirlo (INC-021, ESTADO.md `audit:deps`): *«se retira cuando `@nestjs/platform-express` fije `multer ≥ 2.3.0`»*. Con 11.2.7 fija 2.4.0.
- `npm audit fix` **sin `--force`** para `fast-uri`, `brace-expansion` y `qs`.
- `next/og` **no se usa** en `apps/`: buscado como import, como `ImageResponse` y como archivos de imagen de metadatos. El aviso de Next era real para la dependencia y no alcanzaba al código, pero se sube igual: lo que no se usa hoy se puede usar mañana sin que nadie mire el aviso.

Las dos son subidas **de parche dentro del mismo major**: no cambian las fechas de fin de soporte de ADR-001 (Next 16 hasta ~2027-10-21; NestJS 11 sin política publicada).

## Verificación

- `npm ls multer`: una sola versión, 2.4.0.
- `npm ci` limpio en una copia aparte reproduce el lock exacto.
- `npm run audit` completo en `exit=0` el 2026-10-01, con la API y la web levantadas sobre Nest 11.2.7 y Next 16.3.8.
- El commit de dependencias pasó el pre-commit el 2026-10-03.

## Consecuencias

- `CLAUDE.md` §1 y `DECISIONES.md` D2 se actualizan a 11.2.7 y 16.3.8. La tabla de los seis puntos de §1 conserva lo que se confirmó el 2026-08-26, porque es historia de una verificación, no la versión vigente.
- **Un aviso del registro puede romper `audit:deps` sin que el repositorio cambie.** Es lo que pasó aquí: la auditoría del 2026-09-25 estaba en verde con las mismas versiones. Un paquete que se cierra días después de otro puede encontrarse rojo por algo que no tocó.
- La próxima subida de parche se registra igual: ADR corto que actualiza ADR-001, nunca una edición de ADR-001.
