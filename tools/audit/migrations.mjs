#!/usr/bin/env node
/**
 * `audit:migrations` — verifica que cada migracion sea reversible y que ninguna
 * tabla nueva nazca sin RLS.
 *
 * Prisma Migrate no genera migraciones de bajada, asi que la reversibilidad que
 * exige AUDITORIA.md D1 es un mecanismo propio (ADR-004). Este check es la
 * primera mitad de su verificacion: la estatica, que corre en cada commit. La
 * segunda es `npm run migrate:verify`, que aplica la escalera up -> down -> up
 * contra bases reales y compara los dumps.
 *
 * Un `down.sql` vacio o incoherente es un fallo SILENCIOSO: la migracion se
 * commitea, todo pasa en verde, y el problema aparece el dia que alguien
 * necesita revertir en produccion. Ver docs/incidencias/INC-004.
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRACIONES = join(RAIZ, 'apps', 'api', 'prisma', 'migrations');

const MARCA_MANUAL_INICIO = 'MANUAL: BEGIN';
const MARCA_MANUAL_FIN = 'MANUAL: END';
const MARCA_REVERSA_INICIO = 'MANUAL-REVERSE: BEGIN';
const MARCA_REVERSA_FIN = 'MANUAL-REVERSE: END';

const PRECISION_CONTRATO = '24';
const ESCALA_CONTRATO = '12';

/**
 * Tablas exentas de M6. **La lista esta vacia a proposito y deberia seguir asi.**
 *
 * Los catalogos de enums (`audit_event_type`, `audit_outcome`, ...) no tienen
 * tenant, y la primera version de esta regla los eximia. Se decidio lo
 * contrario: llevan RLS con una politica de lectura, porque una regla con
 * excepciones no se puede automatizar y porque "toda tabla tiene RLS" es un
 * invariante que se verifica de un vistazo.
 *
 * Anadir algo aqui exige un ADR que explique por que esa tabla no puede.
 */
/** @type {Set<string>} */
const SIN_RLS_PERMITIDO = new Set();

/** @typedef {{check: string, mensaje: string}} Fallo */
/** @typedef {{nombre: string, up: string, down: string, upSql: string, downSql: string, tablasSoltadas: Set<string>}} Migracion */

/** @param {string} sql */
function sinComentarios(sql) {
  return sql
    .split('\n')
    .filter((linea) => !linea.trim().startsWith('--'))
    .join('\n');
}

/**
 * @param {string} texto
 * @param {RegExp} patron
 * @returns {string[]} el primer grupo de captura de cada coincidencia
 */
function capturarTodo(texto, patron) {
  /** @type {string[]} */
  const capturas = [];
  for (const coincidencia of texto.matchAll(patron)) {
    const grupo = coincidencia[1];
    if (grupo !== undefined) capturas.push(grupo);
  }
  return capturas;
}

/** @param {string} texto */
function escaparParaRegExp(texto) {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- Comprobaciones, una funcion por regla -------------------------------

/**
 * M2 — si el `up` trae bloque manual, el `down` trae su espejo.
 * @param {Migracion} m
 * @returns {Fallo[]}
 */
function comprobarBloquesManuales({ up, down }) {
  if (!up.includes(MARCA_MANUAL_INICIO)) return [];

  /** @type {Fallo[]} */
  const fallos = [];
  if (!up.includes(MARCA_MANUAL_FIN)) {
    fallos.push({ check: 'M2', mensaje: `migration.sql abre "${MARCA_MANUAL_INICIO}" y no lo cierra` });
  }
  if (!down.includes(MARCA_REVERSA_INICIO) || !down.includes(MARCA_REVERSA_FIN)) {
    fallos.push({
      check: 'M2',
      mensaje: `migration.sql tiene bloque manual y down.sql no tiene su "${MARCA_REVERSA_INICIO}" / "${MARCA_REVERSA_FIN}"`,
    });
  }
  return fallos;
}

/**
 * M3 — cada `CREATE POLICY` se revierte, salvo que el down suelte la tabla.
 * @param {Migracion} m
 * @returns {Fallo[]}
 */
function comprobarPoliticas({ upSql, downSql, tablasSoltadas }) {
  /** @type {Fallo[]} */
  const fallos = [];
  const patron = /\bCREATE\s+POLICY\s+"?([\w]+)"?\s+ON\s+"?([\w]+)"?/gi;

  for (const [, politica, tabla] of upSql.matchAll(patron)) {
    if (politica === undefined || tabla === undefined) continue;
    if (tablasSoltadas.has(tabla.toLowerCase())) continue;

    const revierte = new RegExp(
      `DROP\\s+POLICY\\s+(?:IF\\s+EXISTS\\s+)?"?${politica}"?\\s+ON\\s+"?${tabla}"?`,
      'i',
    );
    if (!revierte.test(downSql)) {
      fallos.push({ check: 'M3', mensaje: `la politica "${politica}" sobre "${tabla}" no se revierte en down.sql` });
    }
  }
  return fallos;
}

/**
 * M4 — `ENABLE` y `FORCE ROW LEVEL SECURITY` tienen su reverso.
 * @param {Migracion} m
 * @returns {Fallo[]}
 */
function comprobarReversoDeRls({ upSql, downSql, tablasSoltadas }) {
  const pares = [
    { activa: 'ENABLE', revierte: 'DISABLE', queja: 'habilita RLS y down.sql no lo deshabilita' },
    { activa: 'FORCE', revierte: 'NO\\s+FORCE', queja: 'fuerza RLS y down.sql no lo revierte (NO FORCE)' },
  ];

  return pares.flatMap(({ activa, revierte, queja }) =>
    capturarTodo(upSql, new RegExp(`ALTER\\s+TABLE\\s+"?([\\w]+)"?\\s+${activa}\\s+ROW\\s+LEVEL\\s+SECURITY`, 'gi'))
      .filter((tabla) => !tablasSoltadas.has(tabla.toLowerCase()))
      .filter(
        (tabla) =>
          !new RegExp(`ALTER\\s+TABLE\\s+"?${tabla}"?\\s+${revierte}\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i').test(downSql),
      )
      .map((tabla) => ({ check: 'M4', mensaje: `"${tabla}" ${queja}` })),
  );
}

/**
 * M6 — toda tabla creada nace con RLS deny-by-default completo.
 *
 * Es la regla que mecaniza CLAUDE.md §4.1: "la politica se define antes de
 * insertar la primera fila, no despues". Hace imposible anadir una tabla de
 * negocio sin aislamiento.
 * @param {Migracion} m
 * @returns {Fallo[]}
 */
function comprobarRlsEnTablasNuevas({ upSql }) {
  const creadas = capturarTodo(upSql, /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([\w]+)"?/gi);

  return creadas
    .filter((tabla) => !SIN_RLS_PERMITIDO.has(tabla.toLowerCase()))
    .filter((tabla) => {
      const habilita = new RegExp(`ALTER\\s+TABLE\\s+"?${tabla}"?\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i');
      const fuerza = new RegExp(`ALTER\\s+TABLE\\s+"?${tabla}"?\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i');
      const politica = new RegExp(`CREATE\\s+POLICY\\s+"?[\\w]+"?\\s+ON\\s+"?${tabla}"?`, 'i');
      return !habilita.test(upSql) || !fuerza.test(upSql) || !politica.test(upSql);
    })
    .map((tabla) => ({
      check: 'M6',
      mensaje:
        `"${tabla}" se crea sin RLS deny-by-default completo (ENABLE + FORCE + al menos una POLICY) ` +
        'en la misma migracion. CLAUDE.md §4.1: la politica se define ANTES de insertar la primera fila',
    }));
}

/**
 * M7 — nada se concede a PUBLIC.
 * @param {Migracion} m
 * @returns {Fallo[]}
 */
function comprobarSinPublic({ upSql }) {
  if (!/\bGRANT\b[^;]*\bTO\s+PUBLIC\b/i.test(upSql)) return [];
  return [{ check: 'M7', mensaje: 'concede privilegios TO PUBLIC' }];
}

/**
 * M8 — todo `numeric` respeta el contrato de la aritmetica decimal.
 * @param {Migracion} m
 * @returns {Fallo[]}
 */
function comprobarEscalaDecimal({ upSql }) {
  /** @type {Fallo[]} */
  const fallos = [];
  const patron = /\b(?:DECIMAL|NUMERIC)\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/gi;

  for (const [texto, precision, escala] of upSql.matchAll(patron)) {
    if (precision === PRECISION_CONTRATO && escala === ESCALA_CONTRATO) continue;
    fallos.push({
      check: 'M8',
      mensaje: `${texto} no respeta el contrato numeric(${PRECISION_CONTRATO},${ESCALA_CONTRATO}) de la aritmetica decimal (ADR-003)`,
    });
  }
  return fallos;
}

/**
 * M9 — el `down` borra su propia fila del historial.
 *
 * No se usa `migrate resolve --rolled-back`: solo acepta migraciones FALLIDAS,
 * y aqui se revierten migraciones exitosas. Ver ADR-004 y INC-004.
 * @param {Migracion} m
 * @returns {Fallo[]}
 */
function comprobarBorradoDelHistorial({ nombre, down }) {
  const borra = new RegExp(`DELETE\\s+FROM\\s+"?_prisma_migrations"?[^;]*${escaparParaRegExp(nombre)}`, 'i');
  if (borra.test(down)) return [];

  return [
    {
      check: 'M9',
      mensaje:
        `down.sql no borra su fila de _prisma_migrations ('${nombre}'). ` +
        'No se usa "migrate resolve --rolled-back": solo acepta migraciones FALLIDAS, no exitosas (ADR-004)',
    },
  ];
}

/**
 * M10 — un `down` no borra filas de una tabla que sobrevive.
 *
 * NACE DE UN FALLO REAL (INC-011). El down de P1 borraba los tipos de evento
 * que P1 habia sembrado en `audit_event_type`, una tabla de P0 que sobrevive al
 * down. Reventaba en cuanto la base tenia un solo evento registrado, por la
 * clave foranea `ON DELETE RESTRICT` de `audit_log` — y no se habia visto nunca
 * porque `migrate:verify` trabaja sobre bases LIMPIAS, donde no hay ninguna
 * fila que referencie nada.
 *
 * La regla generaliza la leccion: si el down suelta la tabla, sus filas se van
 * con ella y no hay nada que borrar; si NO la suelta, las filas que hubiera
 * pueden estar referenciadas por datos que el down no controla. Un catalogo que
 * sostiene evidencia es tan append-only como la evidencia.
 *
 * `_prisma_migrations` es la unica excepcion: borrar su propia fila es
 * justamente lo que M9 EXIGE.
 * @param {Migracion} m
 * @returns {Fallo[]}
 */
function comprobarBorradoDeFilas({ downSql, tablasSoltadas }) {
  const borradas = capturarTodo(downSql, /\bDELETE\s+FROM\s+"?([\w]+)"?/gi).map((t) => t.toLowerCase());

  return borradas
    .filter((tabla) => tabla !== '_prisma_migrations' && !tablasSoltadas.has(tabla))
    .map((tabla) => ({
      check: 'M10',
      mensaje:
        `down.sql borra filas de "${tabla}", que NO elimina. Si otra tabla las referencia, el down ` +
        'falla en cuanto haya datos — y no se vera en `migrate:verify`, que corre sobre bases limpias. ' +
        'Ver docs/incidencias/INC-011',
    }));
}

const COMPROBACIONES = [
  comprobarBloquesManuales,
  comprobarPoliticas,
  comprobarReversoDeRls,
  comprobarRlsEnTablasNuevas,
  comprobarSinPublic,
  comprobarEscalaDecimal,
  comprobarBorradoDelHistorial,
  comprobarBorradoDeFilas,
];

// --- Recorrido -----------------------------------------------------------

function listarMigraciones() {
  if (!existsSync(MIGRACIONES)) return [];
  return readdirSync(MIGRACIONES)
    .filter((nombre) => statSync(join(MIGRACIONES, nombre)).isDirectory())
    .sort();
}

/**
 * M0 y M1: los dos fallos que impiden siquiera analizar la migracion.
 * @param {string} nombre
 * @returns {{migracion: Migracion} | {fallos: Fallo[]}}
 */
function cargar(nombre) {
  const carpeta = join(MIGRACIONES, nombre);
  const rutaUp = join(carpeta, 'migration.sql');
  const rutaDown = join(carpeta, 'down.sql');

  if (!existsSync(rutaUp)) return { fallos: [{ check: 'M0', mensaje: 'falta migration.sql' }] };
  if (!existsSync(rutaDown)) {
    return { fallos: [{ check: 'M1', mensaje: 'falta down.sql (AUDITORIA.md D1 exige migracion reversible)' }] };
  }

  const up = readFileSync(rutaUp, 'utf8');
  const down = readFileSync(rutaDown, 'utf8');
  const downSql = sinComentarios(down);

  if (downSql.trim().length === 0) {
    return {
      fallos: [
        {
          check: 'M1',
          mensaje:
            'down.sql esta vacio. Ver docs/incidencias/INC-004: casi siempre es que ' +
            '`migrate diff` se ejecuto DESPUES de crear la migracion de subida',
        },
      ],
    };
  }

  const tablasSoltadas = new Set(
    capturarTodo(downSql, /\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?([\w]+)"?/gi).map((t) => t.toLowerCase()),
  );

  return { migracion: { nombre, up, down, upSql: sinComentarios(up), downSql, tablasSoltadas } };
}

/**
 * @param {string} nombre
 * @returns {Fallo[]}
 */
function revisar(nombre) {
  const cargada = cargar(nombre);
  if ('fallos' in cargada) return cargada.fallos;
  return COMPROBACIONES.flatMap((comprobar) => comprobar(cargada.migracion));
}

const migraciones = listarMigraciones();

if (migraciones.length === 0) {
  console.log('audit:migrations  OK — todavia no hay migraciones');
  process.exit(0);
}

let total = 0;
for (const nombre of migraciones) {
  const fallos = revisar(nombre);
  if (fallos.length === 0) continue;
  total += fallos.length;
  console.error(`\n  ${nombre}`);
  for (const { check, mensaje } of fallos) {
    console.error(`     [${check}] ${mensaje}`);
  }
}

if (total > 0) {
  console.error(`\naudit:migrations  FALLO — ${total} problema(s) en ${migraciones.length} migracion(es)\n`);
  process.exit(1);
}

console.log(`audit:migrations  OK — ${migraciones.length} migracion(es) reversibles y con RLS`);
