/**
 * Esperar a que N sesiones estén paradas en un bloqueo — para las carreras de
 * P16-B (D-16.100, D-16.101, ADR-023).
 *
 * POR QUÉ EXISTE. Mandar diez peticiones «a la vez» con `Promise.all` no prueba
 * una carrera: en local la transacción es tan corta que no se solapan, y un
 * leer-comparar-escribir pasaba igual. El guardián de P16-B lo enseñó. La
 * carrera se hace determinista bloqueando la fila desde otra conexión y
 * soltándola solo cuando todas las escrituras ya están esperando; esto es lo que
 * dice cuándo.
 *
 * NO ES UN HELPER DE SERVIDOR NI DE SIEMBRA, que es lo que la regla de
 * `csrf.ts` protege: no sabe nada de la aplicación ni de sus datos, solo lee
 * `pg_locks`, y vale para las dos suites que lo usan sin copiar el sondeo.
 *
 * Cuenta CUALQUIER sesión con un bloqueo no concedido, y puede: las suites de
 * integración corren una detrás de otra (`singleFork`), así que en ese momento
 * no hay más escrituras en la base que las de la propia prueba.
 */

import type { Client } from 'pg';

const ESPERA_MAXIMA_MS = 10_000;
const SONDEO_MS = 25;

/** Si no llegan a esperar, falla diciendo cuántas había: nunca suelta el bloqueo a ciegas. */
export async function esperarBloqueadas(cliente: Client, cuantas: number): Promise<void> {
  const limite = Date.now() + ESPERA_MAXIMA_MS;
  let esperando = 0;
  while (Date.now() < limite) {
    const { rows } = await cliente.query<{ esperando: number }>(
      'SELECT count(DISTINCT pid)::int AS esperando FROM pg_locks WHERE NOT granted AND pid <> pg_backend_pid()',
    );
    esperando = rows[0]?.esperando ?? 0;
    if (esperando >= cuantas) return;
    await new Promise((resolver) => setTimeout(resolver, SONDEO_MS));
  }
  throw new Error(`Solo ${String(esperando)} de ${String(cuantas)} escrituras llegaron a esperar el bloqueo`);
}
