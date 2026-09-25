/**
 * Parecido entre nombres — la deduplicación que P10 existe para hacer.
 *
 * EL CRITERIO DE ACEPTACIÓN, TEXTUAL: «un archivo con "Tomate riñón", "tomate
 * riñon" y "TOMATE" propone **un** ítem con tres alias, no tres ítems».
 *
 * Normalizar no basta. Quitar tildes y bajar a minúsculas hace iguales a los
 * dos primeros, y deja "tomate" distinto de "tomate rinon" — que es justo el
 * par que hay que juntar. Hace falta una medida de **parecido**, no de
 * igualdad.
 *
 * POR QUE TRIGRAMAS, Y POR QUE LOS DE `pg_trgm` Y NO OTROS. P2 creó un índice
 * GIN con `pg_trgm` sobre el nombre normalizado, y es con ese índice con el que
 * se busca si el ítem **ya existe** en el catálogo. Si el agrupamiento dentro
 * del archivo usara otra medida, dos filas podrían quedar juntas aquí y
 * separadas allí —o al revés—, y la previsualización enseñaría una cosa
 * mientras la escritura hace otra.
 *
 * Así que esta función replica el algoritmo de `pg_trgm`: partir por lo que no
 * es alfanumérico, rodear cada palabra de espacios, cortar en trigramas y
 * dividir la intersección entre la unión. **Hay una prueba que lo contrasta
 * contra PostgreSQL** —la misma pareja, la misma cifra— porque una réplica sin
 * comprobar es una suposición.
 *
 * ES DOMINIO PURO: entran cadenas, sale un número entre 0 y 1.
 */

/**
 * El umbral por defecto de `pg_trgm` —0,3— escrito como FRACCION EXACTA.
 *
 * Y no como `0.3` por dos razones, y la segunda es la buena:
 *
 *   1. `audit:forbidden` prohibe el literal decimal en `domain` (CLAUDE.md §3),
 *      y hace bien: la regla no puede distinguir un umbral adimensional de un
 *      precio, y la excepcion se pagaria el dia que alguien escriba un precio.
 *   2. Como fraccion, la comparacion de `seParecen` se hace **en enteros**. No
 *      hay coma flotante en la decision de si dos insumos son el mismo.
 */
const UMBRAL_NUMERADOR = 3;
const UMBRAL_DENOMINADOR = 10;

const TAMANO = 3;

/**
 * Normaliza como lo hace el índice: sin tildes, en minúsculas, sin dobles
 * espacios.
 *
 * `NFD` separa la letra de su tilde y `\p{M}` —la clase de marcas
 * diacríticas— se lleva las tildes sueltas. Es la forma estándar de comparar
 * "riñón" con "rinon" sin mantener una tabla de sustituciones que siempre se
 * queda corta.
 */
export function normalizar(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replaceAll(/\p{M}/gu, '')
    .toLowerCase()
    .replaceAll(/\s+/gu, ' ')
    .trim();
}

/**
 * Los trigramas de un texto, como los cuenta `pg_trgm`.
 *
 * Cada palabra se rodea de dos espacios delante y uno detrás, de modo que
 * "sal" produce "  s", " sa", "sal" y "al ". Ese relleno es lo que hace que
 * una palabra corta tenga trigramas: sin él, "sal" daría uno solo y "de"
 * ninguno.
 */
export function trigramas(texto: string): ReadonlySet<string> {
  const conjunto = new Set<string>();

  for (const palabra of normalizar(texto).split(/[^\p{L}\p{N}]+/u)) {
    if (palabra === '') continue;

    const relleno = `  ${palabra} `;
    for (let i = 0; i + TAMANO <= relleno.length; i += 1) {
      conjunto.add(relleno.slice(i, i + TAMANO));
    }
  }

  return conjunto;
}

/**
 * Parecido de Jaccard sobre los trigramas: 0 nada, 1 idéntico.
 *
 * Dos cadenas vacías se parecen **cero**, no uno. Es deliberado: «vacío» no es
 * un nombre, y devolver 1 haría que todas las filas sin nombre se agruparan en
 * un solo ítem fantasma.
 */
export function parecido(uno: string, otro: string): number {
  const { comunes, union } = contar(uno, otro);
  return union === 0 ? 0 : comunes / union;
}

/**
 * ¿Pasan del umbral? **La decisión, en aritmética entera.**
 *
 * `comunes / union >= 3 / 10` multiplicado en cruz. Es la misma pregunta sin
 * una sola división de coma flotante de por medio, que es lo que hay que
 * exigirle a algo que decide si dos insumos son el mismo.
 */
export function seParecen(uno: string, otro: string): boolean {
  const { comunes, union } = contar(uno, otro);
  if (union === 0) return false;

  return comunes * UMBRAL_DENOMINADOR >= union * UMBRAL_NUMERADOR;
}

/** Trigramas comunes y totales: el numerador y el denominador de Jaccard. */
function contar(uno: string, otro: string): { readonly comunes: number; readonly union: number } {
  const a = trigramas(uno);
  const b = trigramas(otro);
  if (a.size === 0 || b.size === 0) return { comunes: 0, union: 0 };

  let comunes = 0;
  for (const trigrama of a) {
    if (b.has(trigrama)) comunes += 1;
  }

  return { comunes, union: a.size + b.size - comunes };
}

export interface GrupoDeNombres {
  /**
   * El nombre que se propone crear.
   *
   * Se elige el MÁS LARGO del grupo, no el primero. "TOMATE" y "Tomate riñón"
   * son el mismo ítem, y el que sirve para volver a reconocerlo dentro de seis
   * meses es el que trae la variedad. El primero del archivo es un accidente
   * del orden en que alguien tecleó.
   */
  readonly canonico: string;
  /** Todas las grafías que cayeron en el grupo, en el orden del archivo. */
  readonly variantes: readonly string[];
}

/**
 * Agrupa nombres parecidos.
 *
 * Es agrupamiento por enlace simple: una variante entra en el grupo si se
 * parece a **alguna** de las que ya están, no a todas. Con nombres de insumos
 * es lo correcto —"tomate", "tomate riñón", "tomate riñon" forman cadena— y
 * el riesgo teórico de encadenar cosas distintas no aparece a esta escala,
 * donde los grupos son de dos o tres.
 *
 * **LO QUE ESTO NO GARANTIZA, dicho para que nadie lo dé por hecho:** el enlace
 * simple codicioso **sí depende del orden** en el caso general. Con A y C por
 * debajo del umbral y B parecido a los dos, el resultado cambia según por cuál
 * se empiece. Hay una prueba que lo comprueba **sobre el caso de aceptación**
 * —las tres grafías de "tomate", en las seis permutaciones— y ahí sale siempre
 * un grupo. Lo que no se afirma es que ocurra con cualquier entrada.
 */
export function agruparParecidos(nombres: readonly string[]): readonly GrupoDeNombres[] {
  const grupos: string[][] = [];

  for (const nombre of nombres) {
    const encaja = grupos.find((grupo) => grupo.some((miembro) => seParecen(miembro, nombre)));

    if (encaja === undefined) grupos.push([nombre]);
    else encaja.push(nombre);
  }

  return grupos.map((variantes) => ({ canonico: masLargo(variantes), variantes }));
}

function masLargo(variantes: readonly string[]): string {
  return variantes.reduce((mejor, actual) => (actual.length > mejor.length ? actual : mejor));
}
