/**
 * Dos proyectos de pruebas, y la distincion no es organizativa: es el criterio
 * arquitectonico de aceptacion de todo el sistema (CLAUDE.md §2).
 *
 *   unit         Dominio y casos de uso. Corre con PostgreSQL APAGADO.
 *                Si algun dia necesita una base, las capas estan mal y se
 *                arregla antes de seguir. `guardia-sin-base.ts` lo hace
 *                cumplir: si un test de este proyecto abre un socket a la
 *                base, falla con un mensaje que explica por que.
 *
 *   integration  Aislamiento entre companies, privilegios de los roles de base
 *                de datos, confidencialidad por rol, conciliacion. Necesita
 *                PostgreSQL real: los dobles de prueba no reproducen RLS.
 *
 * SWC transpila los decoradores de NestJS con `emitDecoratorMetadata`, que es
 * lo que la inyeccion de dependencias necesita en tiempo de ejecucion. La capa
 * `domain` no tiene decoradores —es la regla— asi que no depende de esto.
 */

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const SEGUNDOS = 1000;

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'nodenext' } })],
  test: {
    globals: false,
    projects: [
      {
        plugins: [swc.vite({ module: { type: 'nodenext' } })],
        test: {
          name: 'unit',
          include: ['src/**/*.spec.ts'],
          exclude: ['src/**/*.integration.spec.ts'],
          setupFiles: ['./test/soporte/guardia-sin-base.ts'],
          testTimeout: 10 * SEGUNDOS,
        },
      },
      {
        plugins: [swc.vite({ module: { type: 'nodenext' } })],
        test: {
          name: 'integration',
          include: ['test/integracion/**/*.spec.ts', 'src/**/*.integration.spec.ts'],
          setupFiles: ['./test/soporte/entorno-de-integracion.ts'],
          // Las pruebas de integracion comparten una base: en paralelo se pisan.
          poolOptions: {
            threads: { singleThread: true },
            forks: { singleFork: true },
          },
          testTimeout: 60 * SEGUNDOS,
          hookTimeout: 60 * SEGUNDOS,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/main.ts', 'src/**/*.module.ts'],
    },
  },
});
