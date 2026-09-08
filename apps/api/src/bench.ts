/**
 * El medidor de los presupuestos de rendimiento de CLAUDE.md §5.
 *
 * ESTA DEUDA SE APLAZO DOS VECES —se fijo para P9, se re-fecho a P10, y P10 la
 * volvio a mover— y se paga aqui. Hasta ahora el unico que medía algo era CI, y
 * lo que CI mide no lo ve quien esta escribiendo la consulta.
 *
 * MIDE LOS CASOS DE USO, NO LOS ENDPOINTS, y es deliberado. INC-016 dejo medido
 * que el proxy de puertos de Docker en Windows anade ~300 ms por peticion HTTP:
 * un presupuesto de 400 ms medido a traves de el mide el proxy, no el sistema.
 * Los presupuestos de §5 estan en la seccion de base de datos y hablan del
 * camino de datos, asi que se mide el camino de datos — la misma sesion, el
 * mismo `TenantTransaction`, el mismo RLS, las mismas consultas.
 *
 * Y SE MIDE EL SUELO DEL ENTORNO, que es lo que hace interpretable el numero.
 * Una `ValidarSesion` es una consulta indexada por una clave: lo que tarde es
 * lo que cuesta ir y volver en esta maquina. Si el suelo es 40 ms, un costeo de
 * 380 ms no es «casi se pasa», es 340 ms de trabajo real con 60 ms de margen.
 *
 * P95 Y NO MEDIA. La media esconde exactamente lo que un presupuesto quiere
 * cazar: el caso malo que sufre el cliente. §5 dice p95 y aqui se calcula p95.
 *
 * FALLA CON CODIGO 1 SI ALGUN PRESUPUESTO SE PASA. Un medidor que informa y
 * sigue es un medidor que nadie mira — INC-007, una comprobacion verde que no
 * comprueba.
 */

import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';

import { AppModule } from './app.module';
// LAS FACHADAS, no los casos de uso sueltos: `AnalyticsModule` registra
// `VistasDelMes` y `VistasDeLaCadena` como proveedores, y las piezas de dentro
// no estan en el contenedor. Pedirlas directamente falla en arranque.
import {
  VistasDeLaCadena,
  VistasDelMes,
} from './modules/analytics/infrastructure/http/analitica.controller';
import { CostearCarta } from './modules/costing/application/casos-de-uso/costear';
import { IniciarSesion } from './modules/iam/application/casos-de-uso/iniciar-sesion';
import {
  ValidarSesion,
  type SesionActiva,
} from './modules/iam/application/casos-de-uso/validar-sesion';
import { GuardarReceta } from './modules/recipes/application/casos-de-uso/recetas';
import { loadConfiguration } from './shared/infrastructure/config/environment';
import type { ItemId, LocationId, ProductId } from './shared/domain/identity/identificadores';

const SALIDA_CON_ERROR = 1;

/** Cuantas veces se repite cada operacion antes de calcular el percentil. */
const REPETICIONES = 30;

/** Las de calentamiento, que no cuentan: la primera paga el plan y la conexion. */
const CALENTAMIENTO = 3;

const PERCENTIL = 0.95;

/** Un UUID en hexadecimal: 8 digitos de cabeza y 12 de cola. */
const BASE_HEX = 16;
const DIGITOS_DE_CABEZA = 8;
const DIGITOS_DE_COLA = 12;

const NANOSEGUNDOS_POR_MS = 1_000_000;

/** Lineas por receta de prueba: la media del volumen sembrado. */
const LINEAS_POR_RECETA = 7;

/** Una de cada tres en base EP, para que el rendimiento entre en juego (R4). */
const UNA_DE_CADA = 3;

/** El salto entre insumos, primo, para no repetir siempre los mismos. */
const SALTO_ENTRE_INSUMOS = 13;

/** Anchos de la tabla que se imprime. */
const ANCHO_DEL_NOMBRE = 52;
const ANCHO_DEL_LIMITE = 4;
const DECIMALES = 1;
const DECIMALES_DEL_NETO = 1;
const ANCHO_DEL_P95 = 7;

/** Los identificadores que siembra `scripts/lib/volumen.sql`, con su familia. */
function idDeVolumen(familia: number, n: number): string {
  const cabeza = familia.toString(BASE_HEX).padStart(DIGITOS_DE_CABEZA, '0');
  const cola = n.toString(BASE_HEX).padStart(DIGITOS_DE_COLA, '0');
  return `${cabeza}-0000-4000-8000-${cola}`;
}

/** Las familias con que `volumen.sql` separa los espacios de identificadores. */
const FAMILIA_DE_UBICACION = 2;
const FAMILIA_DE_ITEM = 4;
const FAMILIA_DE_PRODUCTO = 7;

const UBICACION = idDeVolumen(FAMILIA_DE_UBICACION, 1) as LocationId;
const PRODUCTO = idDeVolumen(FAMILIA_DE_PRODUCTO, 1) as ProductId;
const CORREO = 'volumen1@ejemplo.invalid';

/** La misma que `bench.mjs` acaba de sembrar con el hasher real. */
const VARIABLE_DE_CONTRASENA = 'COSTEO_BENCH_PASSWORD';

/** Un mes del volumen: 2024-06 tiene periodo y ventas en las diez ubicaciones. */
const ANIO = 2024;
const MES = 6;

/** El dia del mes al que se pide la foto. Cualquiera dentro del periodo. */
const DIA = 15;

/** Mediodia: la medianoche UTC cae en el mes anterior en Ecuador (INC-013). */
const HORA = 12;

/** Mediodia, no medianoche: la medianoche UTC cae en el mes anterior (INC-013). */
const FECHA = new Date(Date.UTC(ANIO, MES - 1, DIA, HORA));

interface Presupuesto {
  readonly nombre: string;
  readonly limiteMs: number;
  readonly correr: (sesion: SesionActiva) => Promise<unknown>;
}

interface Medida {
  readonly nombre: string;
  readonly limiteMs: number;
  readonly p95: number;
}

function percentil(muestras: readonly number[], fraccion: number): number {
  const ordenadas = [...muestras].sort((a, b) => a - b);
  const posicion = Math.ceil(fraccion * ordenadas.length) - 1;
  return ordenadas[Math.min(posicion, ordenadas.length - 1)] ?? 0;
}

async function medir(presupuesto: Presupuesto, sesion: SesionActiva): Promise<Medida> {
  for (let vuelta = 0; vuelta < CALENTAMIENTO; vuelta += 1) {
    await presupuesto.correr(sesion);
  }

  const muestras: number[] = [];
  for (let vuelta = 0; vuelta < REPETICIONES; vuelta += 1) {
    const arranque = process.hrtime.bigint();
    await presupuesto.correr(sesion);
    muestras.push(Number(process.hrtime.bigint() - arranque) / NANOSEGUNDOS_POR_MS);
  }

  return {
    nombre: presupuesto.nombre,
    limiteMs: presupuesto.limiteMs,
    p95: percentil(muestras, PERCENTIL),
  };
}

/**
 * Lineas de receta para la medida de guardado.
 *
 * SIETE, que es la media del volumen sembrado. El presupuesto de §5 —150 ms
 * «incluye validacion de ciclos»— se mide sobre una receta de tamano corriente,
 * no sobre una de una linea.
 */
function lineasDePrueba(): readonly {
  readonly itemId: ItemId;
  readonly cantidad: string;
  readonly base: 'AP' | 'EP';
  readonly estado: 'ACTIVA';
}[] {
  return Array.from({ length: LINEAS_POR_RECETA }, (_sin, indice) => ({
    itemId: idDeVolumen(FAMILIA_DE_ITEM, 1 + indice * SALTO_ENTRE_INSUMOS) as ItemId,
    cantidad: '0.150',
    base: indice % UNA_DE_CADA === 0 ? ('EP' as const) : ('AP' as const),
    estado: 'ACTIVA' as const,
  }));
}

/**
 * El SUELO: una consulta indexada por clave unica.
 *
 * No es un presupuesto de §5. Lo que tarde es lo que cuesta ir y volver en esta
 * maquina, y sin ese numero los otros cuatro no se pueden leer: 380 ms con un
 * suelo de 40 no es «casi se pasa», es 340 de trabajo con 60 de margen.
 */
function sueloDelEntorno(app: INestApplicationContext, token: string): Presupuesto {
  const validar = app.get(ValidarSesion);

  return {
    nombre: 'suelo del entorno (validar sesion)',
    limiteMs: Number.POSITIVE_INFINITY,
    correr: async () => validar.ejecutar(token),
  };
}

/** Los cuatro de CLAUDE.md §5, con su limite tal y como esta escrito alli. */
function presupuestosDeNegocio(app: INestApplicationContext): readonly Presupuesto[] {
  const costear = app.get(CostearCarta);
  const inventario = app.get(VistasDelMes).inventario;
  const consolidado = app.get(VistasDeLaCadena).total;
  const guardar = app.get(GuardarReceta);

  return [
    {
      nombre: 'costeo de la carta (200 productos, 1.400 lineas)',
      limiteMs: 400,
      correr: async (sesion) => costear.ejecutar(sesion, { locationId: UBICACION, fecha: FECHA }),
    },
    {
      nombre: 'inventario valorizado de una ubicacion (500 items)',
      limiteMs: 300,
      correr: async (sesion) =>
        inventario.ejecutar(sesion, { locationId: UBICACION, anio: ANIO, mes: MES }),
    },
    {
      nombre: 'consolidado de company (10 ubicaciones)',
      limiteMs: 800,
      correr: async (sesion) => consolidado.ejecutar(sesion, { anio: ANIO, mes: MES }),
    },
    {
      nombre: 'guardar una receta (con validacion de ciclos)',
      limiteMs: 150,
      correr: async (sesion) =>
        guardar.ejecutar(sesion, {
          destino: { clase: 'producto', productId: PRODUCTO },
          locationId: UBICACION,
          lineas: lineasDePrueba(),
          validFrom: FECHA,
          nota: null,
        }),
    },
  ];
}

function presupuestosDe(app: INestApplicationContext, token: string): readonly Presupuesto[] {
  return [sueloDelEntorno(app, token), ...presupuestosDeNegocio(app)];
}

function dentroDeLimite(medida: Medida): boolean {
  return medida.limiteMs === Number.POSITIVE_INFINITY || medida.p95 <= medida.limiteMs;
}

/** Una fila de la tabla. Aparte porque la tabla ya tenia demasiadas ramas. */
function comoFila(medida: Medida, suelo: number): string {
  const sinLimite = medida.limiteMs === Number.POSITIVE_INFINITY;
  const marca = sinLimite ? '  ' : dentroDeLimite(medida) ? 'OK' : '!!';
  const limite = sinLimite
    ? '     —'
    : `${medida.limiteMs.toString().padStart(ANCHO_DEL_LIMITE)} ms`;
  const neto = sinLimite
    ? ''
    : `  (${(medida.p95 - suelo).toFixed(DECIMALES_DEL_NETO)} ms sobre el suelo)`;

  return (
    `  ${marca}  ${medida.nombre.padEnd(ANCHO_DEL_NOMBRE)} ` +
    `p95 ${medida.p95.toFixed(DECIMALES).padStart(ANCHO_DEL_P95)} ms` +
    `   limite ${limite}${neto}\n`
  );
}

const CABECERA = '\nPRESUPUESTOS DE RENDIMIENTO (CLAUDE.md §5), p95 de 30 corridas\n\n';
const TODO_BIEN = '\nTodos los presupuestos dentro de limite.\n';
const ALGO_MAL = '\nHAY PRESUPUESTOS FUERA DE LIMITE. No se sube el umbral: se arregla la consulta.\n';

function imprimir(medidas: readonly Medida[]): boolean {
  const suelo = medidas[0]?.p95 ?? 0;
  process.stdout.write(CABECERA);

  for (const medida of medidas) process.stdout.write(comoFila(medida, suelo));

  const todoBien = medidas.every(dentroDeLimite);
  process.stdout.write(todoBien ? TODO_BIEN : ALGO_MAL);
  return todoBien;
}

async function main(): Promise<void> {
  const contrasena = process.env[VARIABLE_DE_CONTRASENA];
  if (contrasena === undefined || contrasena === '') {
    throw new Error(`Falta ${VARIABLE_DE_CONTRASENA}. Se lanza desde \`npm run bench\`.`);
  }

  // `logger: false` NO: un fallo de inyeccion se registra por el logger de Nest
  // y ademas termina el proceso, asi que apagarlo del todo deja un `exit 1` sin
  // una sola linea que diga por que. Se dejan los errores.
  const app = await NestFactory.createApplicationContext(
    AppModule.forRoot(loadConfiguration(process.env)),
    { logger: ['error'] },
  );

  try {
    const abierta = await app
      .get(IniciarSesion)
      .ejecutar({ email: CORREO, contrasena, ip: null, userAgent: null });
    const sesion = await app.get(ValidarSesion).ejecutar(abierta.token);

    const medidas: Medida[] = [];
    for (const presupuesto of presupuestosDe(app, abierta.token)) {
      medidas.push(await medir(presupuesto, sesion));
    }

    if (!imprimir(medidas)) process.exitCode = SALIDA_CON_ERROR;
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = SALIDA_CON_ERROR;
});
