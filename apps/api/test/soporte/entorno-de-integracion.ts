/**
 * Carga el `.env` de la raiz antes de que arranquen las pruebas de integracion.
 *
 * Se usa `process.loadEnvFile` (nativo desde Node 20.6) en vez de `dotenv`: una
 * dependencia menos para cuatro lineas.
 *
 * No pisa lo que ya este en el entorno, y eso es justo lo que hace falta: en CI
 * las variables vienen del runner y no hay archivo `.env` que leer.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// `__dirname` y no `import.meta.dirname`: la aplicacion compila a CommonJS
// (NestJS 11 todavia no es ESM), y `import.meta` no existe ahi. Cambiara con
// NestJS 12 — ver ADR-001.
const ARCHIVO = resolve(__dirname, '..', '..', '..', '..', '.env');

if (existsSync(ARCHIVO)) {
  process.loadEnvFile(ARCHIVO);
}
