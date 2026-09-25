/**
 * Los argumentos de `npm run importar`, validados con esquema.
 *
 * **CADA COMPROBACIÓN VA EN SU CAMPO, NUNCA EN UN REFINAMIENTO DEL OBJETO.** Es
 * INC-008: un `superRefine` de objeto no se ejecuta si algún campo falló antes,
 * así que una `--company` mal escrita desactivaría la comprobación de
 * `--operacion-supervisada` sin que nada avise. Aquí eso sería catastrófico: esa
 * bandera es lo único que separa una prueba de una escritura en producción.
 *
 * La línea de comandos es un límite externo como cualquier otro (CLAUDE.md §3).
 */

import { z } from 'zod';

const TIPOS = ['ITEMS', 'ARTICULOS', 'PRECIOS', 'PRODUCTOS', 'RECETAS', 'MOVIMIENTOS'] as const;

const UUID = z.uuid('no es un identificador válido.');

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/u;

const SALTO = '\n';

/** Lo que ocupa el `--` de una opción larga. */
const LARGO_DEL_PREFIJO = 2;

const esquema = z.object({
  archivo: z.string().min(1, 'falta la ruta del archivo.'),
  tipo: z.enum(TIPOS),
  company: UUID,
  ubicacion: UUID,
  usuario: z.email('no es un correo válido.'),
  vigenciaDesde: z
    .string()
    .regex(FECHA_ISO, 'la vigencia se escribe como AAAA-MM-DD.')
    .optional(),
  confirmar: z.boolean(),
  confirmarPrecios: z.boolean(),
  operacionSupervisada: z.boolean(),
});

export type OpcionesDeImportacion = z.infer<typeof esquema>;

/**
 * Lee `--clave=valor` y `--bandera`.
 *
 * No se usa `parseArgs` de `node:util` porque exige declarar cada opción dos
 * veces —aquí y en el esquema— y la segunda declaración es la que se olvida de
 * actualizar.
 */
export function leerOpciones(argv: readonly string[]): OpcionesDeImportacion {
  const banderas = new Set(argv.filter((a) => a.startsWith('--') && !a.includes('=')));
  const valores = new Map(
    argv
      .filter((a) => a.startsWith('--') && a.includes('='))
      .map((a) => {
        const corte = a.indexOf('=');
        return [a.slice(LARGO_DEL_PREFIJO, corte), a.slice(corte + 1)];
      }),
  );

  const posicional = argv.find((a) => !a.startsWith('--'));

  return validar({
    archivo: valores.get('archivo') ?? posicional ?? '',
    tipo: (valores.get('tipo') ?? '').toUpperCase(),
    company: valores.get('company') ?? '',
    ubicacion: valores.get('ubicacion') ?? '',
    usuario: valores.get('usuario') ?? '',
    vigenciaDesde: valores.get('vigencia-desde'),
    confirmar: banderas.has('--confirmar'),
    confirmarPrecios: banderas.has('--confirmar-precios'),
    operacionSupervisada: banderas.has('--operacion-supervisada'),
  });
}

/** El mensaje de uso, que es la documentación que de verdad se lee. */
export const USO = `
Uso:
  npm run importar -- <archivo.csv> --tipo=<TIPO> --company=<uuid> --ubicacion=<uuid> \\
                      --usuario=<correo> [--vigencia-desde=AAAA-MM-DD] [--confirmar]

  TIPO: ${TIPOS.join(' | ')}

Banderas:
  --confirmar               Escribe. Sin ella solo analiza e imprime el informe.
  --confirmar-precios       Solo con --tipo=PRECIOS: los deja VIGENTES en vez de
                            sugeridos. R5 exige que lo decida una persona; esto
                            es esa persona diciéndolo, y queda en el log.
  --operacion-supervisada   Levanta la negativa a correr contra producción.
                            Ver docs/runbooks/despliegue.md antes de usarla.

La contraseña se lee de la variable de entorno COSTEO_IMPORT_PASSWORD.
`.trim();

/**
 * Convierte el error de Zod en algo que se lee de un vistazo.
 *
 * El volcado crudo de `ZodError` trae la expresión regular del correo entera y
 * el `path` como arreglo. Es correcto y es ilegible; quien está migrando un
 * catálogo necesita «--usuario: no es un correo válido», no un JSON.
 */
function validar(entrada: unknown): OpcionesDeImportacion {
  const resultado = esquema.safeParse(entrada);
  if (resultado.success) return resultado.data;

  const lineas = resultado.error.issues.map(
    (issue) => `  --${guion(String(issue.path[0] ?? '?'))}: ${issue.message}`,
  );

  throw new Error(['Argumentos incorrectos:', ...lineas].join(SALTO));
}

/** `vigenciaDesde` es `--vigencia-desde` para quien escribe el comando. */
function guion(clave: string): string {
  return clave.replace(/[A-Z]/gu, (letra) => `-${letra.toLowerCase()}`);
}
