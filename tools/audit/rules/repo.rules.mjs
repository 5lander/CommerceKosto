/**
 * Reglas de repositorio: no miran el contenido de un archivo de codigo, miran
 * el estado del repositorio en su conjunto. El escaner las ejecuta como
 * funciones y cada una devuelve la lista de infracciones que encontro.
 *
 * Cada una recibe:
 *   { archivos, leer, raiz }
 *     archivos  rutas normalizadas (versionadas + nuevas, nunca las ignoradas)
 *     leer      (ruta) => string  contenido del archivo
 *     raiz      ruta absoluta de la raiz del repositorio
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { matchesAny, normalizePath } from '../lib/glob.mjs';

/** @typedef {{ruta: string, linea: number, extracto: string}} Hallazgo */

const CR = String.fromCharCode(13);

/** Tabulador, salto de linea y retorno de carro: los tres unicos legitimos. */
const TABULADOR = 9;
const SALTO_DE_LINEA = 10;
const RETORNO_DE_CARRO = 13;
const ULTIMO_DE_CONTROL = 31;

/**
 * Se comprueba por CODIGO y no con una expresion regular a proposito: una regex
 * que contenga el rango de control es ella misma una infraccion, y
 * `no-control-regex` de ESLint la rechaza — con razon. La ironia de que la
 * regla que busca caracteres de control no pueda escribirlos merece quedar
 * anotada aqui.
 * @param {number} codigo
 * @returns {boolean}
 */
function esCaracterDeControl(codigo) {
  if (codigo === TABULADOR || codigo === SALTO_DE_LINEA || codigo === RETORNO_DE_CARRO) {
    return false;
  }
  return codigo <= ULTIMO_DE_CONTROL;
}
const DOLAR = String.fromCharCode(36);

/** Archivos que un interprete POSIX va a ejecutar: no toleran CRLF. */
const ARCHIVOS_POSIX = ['.githooks/*', '**/*.sh', 'docker/**/*.sql'];

/** Los scripts que el entrypoint de PostgreSQL corre al inicializar el cluster. */
const ARCHIVOS_INITDB = ['docker/**/initdb/*.sh', 'docker/**/initdb/**/*.sh'];

/** Las suites que levantan una aplicacion HTTP de verdad. */
const SUITES_DE_INTEGRACION = ['apps/*/test/integracion/**/*.spec.ts'];


/** Un `.ts` de `apps/<algo>/src/`. */
const FUENTE_DE_APP = /^apps\/[^/]+\/src\/.+\.tsx?$/;

const SALTO = String.fromCharCode(SALTO_DE_LINEA);

/** `from '../../x/y'` o `import('../../x/y')`, con la ruta relativa capturada. */
const IMPORT_RELATIVO = /from\s+'(\.\.?\/[^']+)'/g;

/**
 * Las carpetas de fuera de `src/` que un archivo importa, con su linea.
 *
 * Resuelve la ruta relativa a mano —sin `path`, para no depender del separador
 * de la plataforma— y se queda con el PRIMER segmento por debajo de la app:
 * `apps/api/src/a/b/c.ts` importando `../../../../parser/lector.mjs` da
 * `parser`. Lo que no sale de `src/` no interesa: ya esta copiado.
 *
 * @param {string} contenido @param {string} desde @param {string} app
 * @returns {{carpeta: string, linea: number, extracto: string}[]}
 */
function carpetasDeFuera(contenido, desde, app) {
  const encontradas = [];

  for (const [indice, texto] of contenido.split(SALTO).entries()) {
    for (const [, relativa] of texto.matchAll(IMPORT_RELATIVO)) {
      const resuelta = resolverRelativa(desde, relativa ?? '');
      if (resuelta === null || !resuelta.startsWith(`${app}/`)) continue;

      const resto = resuelta.slice(app.length + 1);
      const carpeta = resto.slice(0, resto.indexOf('/'));
      if (carpeta === '' || carpeta === 'src') continue;

      encontradas.push({ carpeta, linea: indice + 1, extracto: texto.trim() });
    }
  }

  return encontradas;
}

/**
 * `a/b/c` + `../../x` -> `a/x`. Devuelve `null` si sube por encima de la raiz.
 *
 * @param {string} desde @param {string} relativa @returns {string | null}
 */
function resolverRelativa(desde, relativa) {
  const partes = desde.split('/');

  for (const paso of relativa.split('/')) {
    if (paso === '.' || paso === '') continue;
    if (paso !== '..') {
      partes.push(paso);
      continue;
    }
    if (partes.length === 0) return null;
    partes.pop();
  }

  return partes.join('/');
}

const ES_COMPOSE = /^docker-compose(\.[\w-]+)?\.ya?ml$/;
const ES_DOCKERFILE = /(^|\/)Dockerfile$/;

/** La convencion de PostgreSQL <= 17, que la 18 rechaza. Ver INC-005. */
const RUTA_DE_DATOS_ANTIGUA = /^\s*-\s*\S+:\/var\/lib\/postgresql\/data\s*(?::|$)/;

/**
 * Declaraciones de Prisma con rango en vez de version exacta.
 * @param {string} contenidoDelManifiesto
 * @returns {string[]} extractos legibles, uno por declaracion floja
 */
function prismaConRangoFlojo(contenidoDelManifiesto) {
  /** @type {{dependencies?: Record<string, string>, devDependencies?: Record<string, string>}} */
  let manifiesto;
  try {
    manifiesto = JSON.parse(contenidoDelManifiesto);
  } catch {
    return [];
  }

  const rangoFlojo = /^[\^~><*]/;
  const esPrisma = (/** @type {string} */ nombre) => nombre === 'prisma' || nombre.startsWith('@prisma/');

  return [manifiesto.dependencies, manifiesto.devDependencies]
    .filter((bloque) => bloque !== undefined)
    .flatMap((bloque) => Object.entries(bloque))
    .filter(([nombre, rango]) => esPrisma(nombre) && rangoFlojo.test(String(rango)))
    .map(([nombre, rango]) => `"${nombre}": "${rango}"`);
}

/**
 * Una imagen esta "fijada" si trae digest. Sin digest, `postgres:18` puede
 * cambiar de contenido bajo los pies y un build deja de ser reproducible.
 * @param {string} texto linea de un compose o de un Dockerfile
 */
function esImagenSinFijar(texto) {
  const referencia = /^\s*(?:image:\s*|FROM\s+)(\S+)/i.exec(texto)?.[1];
  if (referencia === undefined) return false;
  if (referencia.startsWith(DOLAR)) return false; // interpolada, se resuelve fuera

  const sinDigest = !referencia.includes('@sha256:');
  const etiquetaMovil = referencia.endsWith(':latest') || !referencia.includes(':');
  return sinDigest && etiquetaMovil;
}


/**
 * El archivo que un script invoca con `node`, o `null` si no invoca ninguno.
 *
 * SOLO SE MIRA `node <ruta>`, y es deliberado: un `prisma migrate deploy` o un
 * `eslint .` los resuelve npm por su cuenta y comprobarlos aqui exigiria
 * reimplementar esa resolucion. Lo que esta regla cubre es el caso que fallo
 * dos veces —una ruta de archivo escrita a mano en el manifiesto— y no
 * pretende cubrir mas.
 *
 * @param {string} comando
 * @returns {string | null}
 */
function archivoInvocado(comando) {
  const partes = comando.trim().split(/\s+/u);
  if (partes[0] !== 'node') return null;

  // Se salta las banderas: `node --watch dist/main.js`.
  const objetivo = partes.slice(1).find((parte) => !parte.startsWith('-'));
  if (objetivo === undefined) return null;

  return /\.(mjs|cjs|js|ts)$/u.test(objetivo) ? objetivo : null;
}


/** Las carpetas que produce una compilacion, no el repositorio. */
const SALIDAS_DE_COMPILACION = ['dist/', '.next/', 'build/'];

/**
 * Si el objetivo de un script es algo que solo existe DESPUES de compilar.
 *
 * `"start": "node dist/main.js"` es correcto —es lo que ejecuta el Dockerfile
 * tras `npm run build`— pero `dist/` esta ignorado por git y ningun paso de
 * `npm run audit` lo genera: `apps/api/tsconfig.json` es `noEmit`. Comprobarlo
 * con `existsSync` hacia que la regla respondiera una cosa u otra segun
 * hubiera quedado un build viejo en disco: verde en local, roja en CI, sobre
 * el MISMO commit. Una regla cuyo resultado depende del residuo del entorno no
 * mide el repositorio, que es la familia de INC-007. Ver INC-033.
 * @param {string} objetivo
 * @returns {boolean}
 */
function esSalidaDeCompilacion(objetivo) {
  const normalizado = normalizePath(objetivo);
  return SALIDAS_DE_COMPILACION.some(
    (carpeta) => normalizado.startsWith(carpeta) || normalizado.includes(`/${carpeta}`),
  );
}

/**
 * Aplana `overrides`: `{a: "1"}` y `{x: {a: "1"}}` dan los dos `[["a", "1"]]`.
 * Solo se miran versiones exactas: un rango no dice que version tiene que
 * estar en el lock, y este proyecto no usa rangos en `overrides`.
 * @param {{overrides?: Record<string, unknown>}} manifiesto
 * @returns {Array<[string, string]>}
 */
function paresDeOverrides(manifiesto) {
  /** @type {Array<[string, string]>} */
  const pares = [];
  for (const [nombre, valor] of Object.entries(manifiesto.overrides ?? {})) {
    if (typeof valor === 'string') pares.push([nombre, valor]);
    else if (valor !== null && typeof valor === 'object') pares.push(...paresDeOverrides({ overrides: /** @type {Record<string, unknown>} */ (valor) }));
  }
  return pares.filter(([, version]) => /^\d+\.\d+\.\d+/.test(version));
}

/**
 * Todas las copias de un paquete en el lock: la izada y las anidadas. Una
 * anidada con otra version es la senal de que el override no se aplico.
 * @param {Record<string, {version?: string}>} paquetes
 * @param {string} nombre
 * @returns {Array<{clave: string, version: string}>}
 */
function copiasEnElLock(paquetes, nombre) {
  const sufijo = `node_modules/${nombre}`;
  return Object.entries(paquetes)
    .filter(([clave]) => clave === sufijo || clave.endsWith(`/${sufijo}`))
    .map(([clave, entrada]) => ({ clave, version: entrada.version ?? '' }));
}

/** `expect(x.status).toBe(PROHIBIDO)` o `.toBe(403)`, escrito como sea. */
const ASERCION_DE_403 = /toBe\((?:PROHIBIDO|403)\)/;

/** Cualquier asercion sobre el `code` del cuerpo: `{ code: 'PERMISO_DENEGADO' }`. */
const ASERCION_DE_CODIGO = /\bcode:/;

/**
 * Recorre el CUERPO DE LA PRUEBA a partir de la asercion de 403 buscando una
 * asercion de codigo.
 *
 * El limite es la sangria, no un numero de lineas: se para en la primera linea
 * menos sangrada que la del `expect`, que es el `});` que cierra el `it`. Con
 * una ventana fija de N lineas, un comentario de dos lineas en medio la
 * desbordaba —paso— y N+1 lineas mas abajo se colaba el `code` de la prueba
 * SIGUIENTE, que es peor: aprobaba una prueba que no comprueba nada.
 *
 * @param {readonly string[]} lineas
 * @param {number} desde indice (base 0) de la linea del 403
 * @returns {boolean}
 */
function afirmaElCodigo(lineas, desde) {
  const sangria = sangriaDe(lineas[desde] ?? '');

  for (let n = desde; n < lineas.length; n += 1) {
    const linea = lineas[n] ?? '';
    if (linea.trim() === '') continue;
    if (n > desde && sangriaDe(linea) < sangria) return false;
    if (ASERCION_DE_CODIGO.test(linea)) return true;
  }
  return false;
}

/** @param {string} linea @returns {number} */
function sangriaDe(linea) {
  return linea.length - linea.trimStart().length;
}


/** Los dos archivos que la regla del ensayo local compara (INC-017, recurrencia 2). */
const COMPOSE_DE_PRODUCCION = 'docker-compose.prod.yml';
const RUNBOOK_DE_PUESTA_EN_MARCHA = 'docs/runbooks/puesta-en-marcha.md';

/**
 * Las variables que el compose de produccion exige con `${VAR:?mensaje}`: las que
 * hacen fallar `docker compose` ANTES de construir nada si faltan.
 * @param {string} compose
 * @returns {string[]}
 */
function variablesObligatorias(compose) {
  return [...new Set([...compose.matchAll(/\$\{([A-Z][A-Z0-9_]*):\?/gu)].map((m) => String(m[1])))];
}

/**
 * El texto del «Paso 0» del runbook, hasta el siguiente `## `. `null` si no esta.
 * @param {string} runbook
 * @returns {string | null}
 */
function pasoCeroDelRunbook(runbook) {
  const inicio = runbook.indexOf('## Paso 0');
  if (inicio === -1) return null;
  const fin = runbook.indexOf('\n## ', inicio + 1);
  return runbook.slice(inicio, fin === -1 ? undefined : fin);
}

export const repoRules = [
  {
    id: '403-de-integracion-sin-su-code',
    descripcion: 'Una asercion de 403 en las pruebas de integracion que no comprueba tambien el `code`',
    porQue:
      'DESDE P16-A2 HAY DOS 403 DISTINTOS: `PERMISO_DENEGADO` y `CSRF_INVALIDO`, y `CsrfGuard` corre ' +
      'ANTES que `PermisosGuard`. Una mutacion a la que se le olvide `X-CSRF-Token` responde 403 y ' +
      'deja en verde una prueba de autorizacion que no llego a ejercitar ningun permiso — incluidas ' +
      'las 🔴 de aislamiento y confidencialidad de CLAUDE.md §7, que son las que menos pueden ' +
      'permitirse pasar por la razon equivocada. El estado dice que se rechazo; solo el codigo dice ' +
      'POR QUE. Vale cualquier asercion sobre `code` dentro del mismo `it`.',
    referencia: 'CLAUDE.md §7 · ADR-021 · docs/pasos/P16-A2/CONSTRUCCION.md',
    desde: 'P16-A2',
    incluye: ['apps/api/test/integracion/**/*.spec.ts'],
    /**
     * @param {{archivos: readonly string[], leer: (ruta: string) => string}} ctx
     * @returns {Hallazgo[]}
     */
    revisar({ archivos, leer }) {
      /** @type {Hallazgo[]} */
      const hallazgos = [];

      for (const ruta of archivos.filter((a) => matchesAny(a, this.incluye ?? []))) {
        const lineas = leer(ruta).split('\n');
        lineas.forEach((linea, indice) => {
          if (!ASERCION_DE_403.test(linea) || afirmaElCodigo(lineas, indice)) return;
          hallazgos.push({ ruta, linea: indice + 1, extracto: linea.trim() });
        });
      }

      return hallazgos;
    },
  },
  {
    id: 'script-de-package-json-apunta-a-nada',
    descripcion: 'Un script de `package.json` que invoca un archivo que no existe',
    porQue:
      'SEGUNDA VEZ. `db:psql` apuntaba a `scripts/psql-shell.mjs`, que no existia, desde P0 y durante nueve paquetes (INC-014). Despues, `dev` ejecutaba `node --watch --experimental-transform-types src/main.ts`, que no arranca porque el paquete es CommonJS con imports sin extension. Ninguno de los dos lo vio ningun check: `knip` analiza imports de TypeScript, no las rutas que los scripts invocan. Un script roto no se nota hasta que alguien lo necesita, y para entonces suele ser el peor momento.',
    referencia: 'docs/incidencias/INC-014',
    desde: 'P10',
    /**
     * @param {{archivos: readonly string[], leer: (ruta: string) => string, raiz: string}} ctx
     * @returns {Hallazgo[]}
     */
    revisar({ archivos, leer, raiz }) {
      const hallazgos = [];

      for (const ruta of archivos.filter((r) => r.endsWith('package.json'))) {
        if (ruta.includes('node_modules')) continue;

        /** @type {{scripts?: Record<string, string>}} */
        const manifiesto = JSON.parse(leer(ruta));
        const base = ruta.split('/').slice(0, -1).join('/');

        for (const [nombre, comando] of Object.entries(manifiesto.scripts ?? {})) {
          const objetivo = archivoInvocado(comando);
          if (objetivo === null) continue;
          if (esSalidaDeCompilacion(objetivo)) continue;

          const absoluto = join(raiz, base, objetivo);
          if (existsSync(absoluto)) continue;

          hallazgos.push({
            ruta,
            linea: 0,
            extracto: `"${nombre}": ${comando}  ->  no existe ${objetivo}`,
          });
        }
      }

      return hallazgos;
    },
  },

  {
    id: 'sin-env-versionado',
    descripcion: 'Un archivo `.env` bajo control de versiones',
    porQue: 'Los secretos jamas entran al repositorio. `.env.example` si; `.env` nunca.',
    referencia: 'SEGURIDAD.md §9 · AUDITORIA.md C11',
    desde: 'P0',
    /**
     * @param {{archivos: readonly string[]}} ctx
     * @returns {Hallazgo[]}
     */
    revisar({ archivos }) {
      return archivos
        .filter((ruta) => {
          const nombre = ruta.split('/').pop() ?? '';
          return nombre === '.env' || (nombre.startsWith('.env.') && nombre !== '.env.example');
        })
        .map((ruta) => ({ ruta, linea: 0, extracto: ruta }));
    },
  },
  {
    id: 'sin-crlf-en-archivo-posix',
    descripcion: 'Retorno de carro (CR) en un archivo que ejecuta un interprete POSIX',
    porQue:
      'Un CR en la linea shebang produce `bad interpreter: /bin/sh^M` y el hook queda inservible sin que git avise. Ver docs/incidencias/INC-001.',
    referencia: 'docs/incidencias/INC-001',
    desde: 'P0',
    /**
     * @param {{archivos: readonly string[], leer: (ruta: string) => string}} ctx
     * @returns {Hallazgo[]}
     */
    revisar({ archivos, leer }) {
      return archivos
        .filter((ruta) => matchesAny(ruta, ARCHIVOS_POSIX))
        .filter((ruta) => leer(ruta).includes(CR))
        .map((ruta) => ({ ruta, linea: 0, extracto: 'contiene CR (CRLF)' }));
    },
  },
  {
    id: 'lote-en-paralelo-sin-servidor-escuchando',
    descripcion: 'Una suite que dispara peticiones en PARALELO sin poner el servidor a escuchar',
    porQue:
      '`app.init()` monta la aplicacion pero NO abre el puerto. Supertest lo abre perezosamente al construir cada peticion: mira `server.address()` y, si esta vacia, llama a `listen(0)`. Con varios `Test` creados en el mismo tick, TODOS ven la direccion vacia y TODOS intentan abrir el puerto, y sale un `read ECONNRESET` en una peticion al azar. Solo aparece bajo carga: paso en el PR y fallo en el push del MISMO arbol. Anadir `await app.listen(0)` tras el `init()`. Ver docs/incidencias/INC-034.',
    referencia: 'docs/incidencias/INC-034',
    desde: 'P16-U6',
    /**
     * @param {{archivos: readonly string[], leer: (ruta: string) => string}} ctx
     * @returns {Hallazgo[]}
     */
    revisar({ archivos, leer }) {
      /** @type {Hallazgo[]} */
      const infracciones = [];

      for (const ruta of archivos.filter((candidata) => matchesAny(candidata, SUITES_DE_INTEGRACION))) {
        const texto = leer(ruta);
        // Las tres condiciones juntas son la carrera: peticiones HTTP, lanzadas
        // a la vez, sobre un servidor que nadie puso a escuchar.
        if (!texto.includes('Promise.all')) continue;
        if (!texto.includes('request(')) continue;
        if (texto.includes('.listen(')) continue;

        infracciones.push({
          ruta,
          linea: 0,
          extracto: 'Promise.all sobre supertest sin un listen() previo',
        });
      }

      return infracciones;
    },
  },
  {
    id: 'initdb-no-resuelve-su-ruta-con-dollar-cero',
    descripcion: 'Un script de `/docker-entrypoint-initdb.d` que usa `$0` fuera de un comentario',
    porQue:
      'El entrypoint de PostgreSQL EJECUTA los .sh que tienen bit de ejecucion y SOURCEA los que no. Al sourcear, $0 sigue siendo el del entrypoint, asi que `dirname "$0"` apunta a /usr/local/bin, los .sql no se encuentran y el cluster arranca SIN ROLES. Solo se ve con el volumen vacio: en local nunca lo esta y en CI siempre. Usar ${BASH_SOURCE[0]}. Ver docs/incidencias/INC-033.',
    referencia: 'docs/incidencias/INC-033',
    desde: 'P16-U',
    /**
     * @param {{archivos: readonly string[], leer: (ruta: string) => string}} ctx
     * @returns {Hallazgo[]}
     */
    revisar({ archivos, leer }) {
      const usaDollarCero = new RegExp(`\\${DOLAR}0(?![0-9])`);
      /** @type {Hallazgo[]} */
      const infracciones = [];

      for (const ruta of archivos.filter((candidata) => matchesAny(candidata, ARCHIVOS_INITDB))) {
        leer(ruta)
          .split(SALTO)
          .forEach((texto, indice) => {
            // El comentario que EXPLICA la trampa tiene que poder nombrarla.
            if (texto.trimStart().startsWith('#')) return;
            if (usaDollarCero.test(texto)) {
              infracciones.push({ ruta, linea: indice + 1, extracto: texto.trim() });
            }
          });
      }

      return infracciones;
    },
  },
  {
    id: 'sin-bind-mount-de-codigo',
    descripcion: 'Montar el codigo fuente del host dentro del contenedor de la API',
    porQue:
      'Mete un node_modules de win32 en un contenedor Linux y rompe @swc/core y los engines de Prisma con mensajes que apuntan al lugar equivocado. Ver docs/incidencias/INC-003.',
    referencia: 'docs/incidencias/INC-003',
    desde: 'P0',
    /**
     * @param {{archivos: readonly string[], leer: (ruta: string) => string}} ctx
     * @returns {Hallazgo[]}
     */
    revisar({ archivos, leer }) {
      /** @type {Hallazgo[]} */
      const infracciones = [];
      const montaDeCodigo = new RegExp(
        `^\\s*-\\s*(?:\\.{1,2}[^:]*|\\${DOLAR}\\{PWD\\}[^:]*):\\s*/app(?:/src)?\\s*(?::|${DOLAR})`,
      );

      for (const ruta of archivos.filter((candidata) => ES_COMPOSE.test(candidata))) {
        leer(ruta)
          .split('\n')
          .forEach((texto, indice) => {
            if (montaDeCodigo.test(texto)) {
              infracciones.push({ ruta, linea: indice + 1, extracto: texto.trim() });
            }
          });
      }

      return infracciones;
    },
  },
  {
    id: 'postgres-18-monta-en-var-lib-postgresql',
    descripcion: 'Montar el volumen de PostgreSQL en `/var/lib/postgresql/data`',
    porQue:
      'Las imagenes de PostgreSQL 18+ guardan los datos en un subdirectorio por version mayor. Un volumen montado en la ruta antigua hace que el contenedor se niegue a arrancar, con un mensaje que habla de una actualizacion que nunca ocurrio. Ver docs/incidencias/INC-005.',
    referencia: 'docs/incidencias/INC-005 · ADR-001',
    desde: 'P0',
    /**
     * @param {{archivos: readonly string[], leer: (ruta: string) => string}} ctx
     * @returns {Hallazgo[]}
     */
    revisar({ archivos, leer }) {
      return archivos
        .filter((ruta) => ES_COMPOSE.test(ruta))
        .flatMap((ruta) =>
          leer(ruta)
            .split('\n')
            .map((texto, indice) => ({ texto, linea: indice + 1 }))
            .filter(({ texto }) => RUTA_DE_DATOS_ANTIGUA.test(texto))
            .map(({ texto, linea }) => ({ ruta, linea, extracto: texto.trim() })),
        );
    },
  },
  {
    id: 'sin-prisma-sin-fijar',
    descripcion: 'Prisma declarado con rango (`^` o `~`) en vez de version exacta',
    porQue:
      'El dist-tag `latest` de npm apunta a un Release Candidate (8.0.0-rc.x). Un rango puede traerse un RC a produccion. Ver ADR-001.',
    referencia: 'ADR-001 · DECISIONES.md D2',
    desde: 'P0',
    /**
     * @param {{archivos: readonly string[], leer: (ruta: string) => string}} ctx
     * @returns {Hallazgo[]}
     */
    revisar({ archivos, leer }) {
      return archivos
        .filter((ruta) => /(^|\/)package\.json$/.test(ruta))
        .flatMap((ruta) =>
          prismaConRangoFlojo(leer(ruta)).map((extracto) => ({ ruta, linea: 0, extracto })),
        );
    },
  },
  {
    id: 'dockerfile-no-copia-lo-que-el-codigo-importa',
    descripcion: 'El codigo importa una carpeta de fuera de `src/` que el Dockerfile no copia',
    porQue:
      'La imagen se construye solo con lo que el Dockerfile COPIA. Si el codigo importa algo que vive ' +
      'fuera de `src/` y esa carpeta no se copia, el `tsc` de dentro de la imagen falla con un ' +
      '"Cannot find module" que en la maquina de desarrollo no pasa nunca, porque ahi el archivo esta. ' +
      'Y el fallo se esconde: `docker compose up -d --build` deja el contenedor ANTERIOR corriendo y su ' +
      'comprobacion de salud sigue en verde, asi que el despliegue parece haber funcionado mientras ' +
      'sirve codigo viejo. Paso con `apps/api/parser/` desde P10 y se descubrio en el ensayo de ' +
      'despliegue, dos dias despues. Ver INC-018.',
    referencia: 'INC-018 · docs/runbooks/despliegue.md',
    desde: 'P14b',
    /**
     * @param {{archivos: readonly string[], leer: (ruta: string) => string}} ctx
     * @returns {Hallazgo[]}
     */
    revisar({ archivos, leer }) {
      /** @type {Hallazgo[]} */
      const hallazgos = [];

      for (const ruta of archivos.filter((candidata) => FUENTE_DE_APP.test(candidata))) {
        const app = ruta.slice(0, ruta.indexOf('/src/'));
        const dockerfile = `${app}/Dockerfile`;
        if (!archivos.includes(dockerfile)) continue;

        // SIN LOS COMENTARIOS, y no es un detalle: el propio Dockerfile
        // explica por que copia el parser y al hacerlo escribe su ruta. Mirando
        // el texto crudo, ese comentario haria pasar la regla aunque alguien
        // borrase el `COPY` que hay debajo. Es el mismo enmascarado que
        // `forbidden.mjs` aplica a las reglas de codigo, y por el mismo motivo:
        // la prosa que EXPLICA una regla contiene lo que la regla busca.
        const copiado = leer(dockerfile)
          .split(SALTO)
          .filter((linea) => !linea.trimStart().startsWith('#'))
          .join(SALTO);
        const desde = ruta.slice(0, ruta.lastIndexOf('/'));

        for (const { carpeta, linea, extracto } of carpetasDeFuera(leer(ruta), desde, app)) {
          if (copiado.includes(`${app}/${carpeta}`)) continue;
          hallazgos.push({ ruta, linea, extracto });
        }
      }

      return hallazgos;
    },
  },
  {
    id: 'sin-imagen-sin-fijar',
    descripcion: 'Imagen de contenedor con etiqueta movil o sin digest',
    porQue: 'Una imagen que cambia bajo los pies hace que un build reproducible deje de serlo.',
    referencia: 'CLAUDE.md §1 · SEGURIDAD.md §9',
    desde: 'P0',
    /**
     * @param {{archivos: readonly string[], leer: (ruta: string) => string}} ctx
     * @returns {Hallazgo[]}
     */
    revisar({ archivos, leer }) {
      const objetivos = archivos.filter((ruta) => ES_COMPOSE.test(ruta) || ES_DOCKERFILE.test(ruta));

      return objetivos.flatMap((ruta) =>
        leer(ruta)
          .split('\n')
          .map((texto, indice) => ({ texto, linea: indice + 1 }))
          .filter(({ texto }) => esImagenSinFijar(texto))
          .map(({ texto, linea }) => ({ ruta, linea, extracto: texto.trim() })),
      );
    },
  },
  {
    id: 'sin-migracion-commiteada-modificada',
    descripcion: 'Modificar una migracion que ya esta en el historial',
    /**
     * LA LISTA DE ENMIENDAS AUTORIZADAS ESTA VACIA, Y ES LO CORRECTO.
     *
     * P0 abrio una: su `REVOKE ALL ON TABLE "_prisma_migrations"` impedia
     * reproducir el historial sobre una base vacia —lo que Prisma hace en la
     * base sombra para crear CUALQUIER migracion nueva— y P1 no se podia
     * empezar. El usuario autorizo editar aquella migracion el 2026-08-27, con
     * el argumento de que el proyecto no tenia ningun despliegue y las dos
     * unicas bases con ella aplicada eran desechables.
     *
     * **Se retiro en P2**, tal como se habia escrito. La enmienda ya viajo en
     * el commit de P1, asi que el archivo coincide con HEAD y la excepcion ya
     * no protege nada: dejarla puesta seria una puerta abierta sin nadie
     * detras. Esa es la vida entera que debe tener una excepcion de este tipo.
     *
     * Si vuelve a hacer falta, se anade una entrada `{carpeta, motivo,
     * seRetiraEn}` a mano —aparece en el diff, alguien la aprueba— y se retira
     * en el paquete que diga. No existe un interruptor general.
     *
     * @type {ReadonlyArray<{carpeta: string, motivo: string, seRetiraEn: string}>}
     */
    enmiendasAutorizadas: [],
    porQue:
      'Rompe el checksum de `_prisma_migrations` en toda base donde ya se aplico. Un error en una migracion se corrige con una migracion nueva, jamas editando la anterior.',
    referencia: 'CLAUDE.md §5 · AUDITORIA.md D1',
    desde: 'P0',
    /**
     * @param {{raiz: string}} ctx
     * @returns {Hallazgo[]}
     */
    revisar({ raiz }) {
      let salida = '';
      try {
        salida = execFileSync(
          'git',
          ['diff', '--name-only', 'HEAD', '--', 'apps/api/prisma/migrations'],
          { cwd: raiz, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
        );
      } catch {
        return [];
      }

      /** Un directorio de migracion nuevo, entero, es legitimo: no esta en HEAD. */
      const existiaEnHead = (/** @type {string} */ ruta) => {
        try {
          execFileSync('git', ['cat-file', '-e', `HEAD:${ruta}`], { cwd: raiz, stdio: 'ignore' });
          return true;
        } catch {
          return false;
        }
      };

      const autorizada = (/** @type {string} */ ruta) =>
        this.enmiendasAutorizadas?.some((e) => ruta.includes(`/${e.carpeta}/`)) === true;

      return salida
        .split('\n')
        .map((linea) => normalizePath(linea.trim()))
        .filter(Boolean)
        .filter(existiaEnHead)
        .filter((ruta) => !autorizada(ruta))
        .map((ruta) => ({ ruta, linea: 0, extracto: 'ya existia en HEAD y cambio' }));
    },
  },
  {
    id: 'sin-caracteres-de-control',
    descripcion: 'Un caracter de control literal dentro de un archivo de codigo',
    porQue:
      'OCTAVA RECURRENCIA DE INC-007, y la SEGUNDA con esta causa exacta. Al generar codigo desde ' +
      'una cadena de otro lenguaje, "\\b" no siempre significa «limite de palabra»: en Python y en ' +
      'muchos generadores es el caracter de RETROCESO (0x08). La regex resultante compila, no ' +
      'lanza, no avisa, y solo casa si delante hay un retroceso — o sea nunca. El check pasa en ' +
      'verde sin examinar nada. Paso en M10 y volvio a pasar en M11. Un caracter de control ' +
      'jamas tiene sitio legitimo en un archivo de codigo, asi que la regla no necesita ' +
      'excepciones: escribase el escape doble en el generador, o String.fromCharCode si de ' +
      'verdad hace falta el caracter.',
    referencia: 'docs/incidencias/INC-007',
    incluye: [
      'apps/*/src/**/*.{ts,tsx}',
      'apps/*/test/**/*.ts',
      'tools/**/*.mjs',
      'scripts/**/*.mjs',
      '*.mjs',
      '*.cjs',
    ],
    /**
     * @param {{archivos: string[], leer: (ruta: string) => string}} contexto
     * @returns {Hallazgo[]}
     */
    revisar({ archivos, leer }) {
      /** @type {Hallazgo[]} */
      const hallazgos = [];

      for (const ruta of archivos.filter((a) => matchesAny(a, this.incluye ?? []))) {
        leer(ruta)
          .split('\n')
          .forEach((linea, indice) => {
            const posicion = [...linea].findIndex((c) => esCaracterDeControl(c.charCodeAt(0)));
            if (posicion === -1) return;

            const codigo = linea.charCodeAt(posicion);
            hallazgos.push({
              ruta,
              linea: indice + 1,
              extracto: `caracter de control 0x${codigo.toString(16).padStart(2, '0')} en la columna ${String(posicion + 1)}`,
            });
          });
      }

      return hallazgos;
    },
  },
  {
    id: 'override-de-npm-reflejado-en-el-lock',
    descripcion: 'Un `overrides` de la raiz cuya version no es la que `package-lock.json` instala',
    porQue:
      'npm IGNORA un override nuevo cuando ya existe lockfile: `npm install` dice "up to date" y deja la ' +
      'version vieja, sin un solo aviso. Y si se borra la entrada del lock para forzarlo, descarta el ' +
      'paquete entero. Un override que no se ve en el lock es una correccion de seguridad que uno cree ' +
      'aplicada y no lo esta. Ver docs/incidencias/INC-021: la entrada se trasplanta de una resolucion ' +
      'sin lock y se verifica con `npm ci`.',
    referencia: 'docs/incidencias/INC-021 · AUDITORIA.md C26',
    desde: 'P16',
    /**
     * @param {{archivos: readonly string[], leer: (ruta: string) => string}} ctx
     * @returns {Hallazgo[]}
     */
    revisar({ archivos, leer }) {
      if (!archivos.includes('package.json') || !archivos.includes('package-lock.json')) return [];
      const lock = /** @type {{packages?: Record<string, {version?: string}>}} */ (JSON.parse(leer('package-lock.json')));
      const paquetes = lock.packages ?? {};
      return paresDeOverrides(JSON.parse(leer('package.json'))).flatMap(([nombre, version]) =>
        copiasEnElLock(paquetes, nombre)
          .filter((copia) => copia.version !== version)
          .map((copia) => ({
            ruta: 'package-lock.json',
            linea: 0,
            extracto: `overrides pide ${nombre}@${version}, el lock instala ${copia.clave} en ${copia.version}`,
          })),
      );
    },
  },
  {
    id: 'ensayo-local-con-las-variables-obligatorias',
    descripcion:
      'Una variable obligatoria (`${VAR:?...}`) de docker-compose.prod.yml que el comando del ensayo local del runbook no pone',
    porQue:
      'El paso 0 de `puesta-en-marcha.md` es el ensayo que destapo INC-018, INC-019 e INC-020, y su comando es lo ' +
      'primero que se copia. P16-A1 anadio APP_URL, PROXY_DE_CONFIANZA y MAIL_ADAPTER al compose y el comando ' +
      'se quedo sin ellas: `docker compose` falla antes de construir nada con «falta APP_URL», y quien lo ejecuta ' +
      'lo deja para otro dia. Un runbook que no arranca es INC-017 con otro formato.',
    referencia: 'docs/incidencias/INC-017 (recurrencia 2) · docs/runbooks/puesta-en-marcha.md',
    desde: 'P16-C',
    /**
     * @param {{archivos: readonly string[], leer: (ruta: string) => string}} ctx
     * @returns {Hallazgo[]}
     */
    revisar({ archivos, leer }) {
      // Con que cambie UNO de los dos, se comparan los dos: en el pre-commit solo llega el indice.
      if (!archivos.includes(COMPOSE_DE_PRODUCCION) && !archivos.includes(RUNBOOK_DE_PUESTA_EN_MARCHA)) return [];
      const paso = pasoCeroDelRunbook(leer(RUNBOOK_DE_PUESTA_EN_MARCHA));
      if (paso === null) {
        return [{ ruta: RUNBOOK_DE_PUESTA_EN_MARCHA, linea: 0, extracto: 'no tiene «## Paso 0», el ensayo local' }];
      }
      return variablesObligatorias(leer(COMPOSE_DE_PRODUCCION))
        .filter((variable) => !paso.includes(`${variable}=`))
        .map((variable) => ({
          ruta: RUNBOOK_DE_PUESTA_EN_MARCHA,
          linea: 0,
          extracto: `el ensayo local no pone ${variable}, y ${COMPOSE_DE_PRODUCCION} la exige`,
        }));
    },
  },
];
