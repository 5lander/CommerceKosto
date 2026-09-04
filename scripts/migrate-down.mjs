#!/usr/bin/env node
/**
 * `npm run migrate:down` — revierte migraciones aplicadas.
 *
 *   --steps N     revierte las N mas recientes (por defecto 1)
 *   --to <nombre> revierte hasta dejar aplicada esa migracion, inclusive
 *   --all         revierte todas (solo fuera de produccion)
 *   --force       requerido en produccion
 *
 * Cada `down.sql` se aplica en UNA transaccion, con el borrado de su fila de
 * `_prisma_migrations` dentro: o se revierte entero, o no se revierte nada.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MIGRACIONES, exigir } from './lib/entorno.mjs';
import { aplicarSql, consultar } from './lib/psql.mjs';

const conexion = exigir('MIGRATION_DATABASE_URL');
const enProduccion = process.env['NODE_ENV'] === 'production';

/** @param {string} nombre */
function bandera(nombre) {
  return process.argv.includes(`--${nombre}`);
}

/** @param {string} nombre */
function valor(nombre) {
  const indice = process.argv.indexOf(`--${nombre}`);
  return indice === -1 ? undefined : process.argv[indice + 1];
}

/** Migraciones aplicadas, de la mas reciente a la mas antigua. */
function aplicadas() {
  const salida = consultar({
    conexion,
    sql:
      'SELECT migration_name FROM "_prisma_migrations" ' +
      'WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ' +
      'ORDER BY started_at DESC;',
  });
  return salida.split('\n').map((linea) => linea.trim()).filter(Boolean);
}

/** @param {readonly string[]} historial */
function seleccionar(historial) {
  if (bandera('all')) {
    if (enProduccion) {
      throw new Error('`--all` no se admite con NODE_ENV=production.');
    }
    return [...historial];
  }

  const hasta = valor('to');
  if (hasta !== undefined) {
    const indice = historial.indexOf(hasta);
    if (indice === -1) throw new Error(`La migracion "${hasta}" no figura como aplicada.`);
    return historial.slice(0, indice + 1);
  }

  const pasos = Number(valor('steps') ?? '1');
  if (!Number.isSafeInteger(pasos) || pasos < 1) throw new Error('`--steps` debe ser un entero >= 1.');
  return historial.slice(0, pasos);
}

const historial = aplicadas();
if (historial.length === 0) {
  console.log('[migrate:down] no hay migraciones aplicadas.');
  process.exit(0);
}

const objetivo = seleccionar(historial);

// Se comprueba que TODAS tienen down.sql antes de aplicar la primera: revertir
// tres de cuatro deja la base en un estado que no es ni el de antes ni el de
// despues, y es peor que no empezar.
const sinReverso = objetivo.filter((nombre) => !existsSync(join(MIGRACIONES, nombre, 'down.sql')));
if (sinReverso.length > 0) {
  console.error('[migrate:down] falta down.sql en:');
  for (const nombre of sinReverso) console.error(`  ${nombre}`);
  console.error('\nNo se revierte nada. Ver docs/incidencias/INC-004.');
  process.exit(1);
}

if (enProduccion && !bandera('force')) {
  console.error('[migrate:down] en produccion hay que pasar `--force` explicitamente.');
  process.exit(1);
}

console.log(`[migrate:down] revirtiendo ${String(objetivo.length)} migracion(es), de la mas reciente:`);

for (const nombre of objetivo) {
  console.log(`  <- ${nombre}`);
  aplicarSql({
    conexion,
    sql: readFileSync(join(MIGRACIONES, nombre, 'down.sql'), 'utf8'),
    descripcion: `${nombre}/down.sql`,
  });
}

console.log('[migrate:down] listo.');
