/**
 * Reglas de la CONEXION PRIVILEGIADA — P11, SPEC §1, CLAUDE.md §4.2.
 *
 * `costeo_backoffice` es el unico rol del sistema con `BYPASSRLS`: una consulta
 * suya ve TODOS los tenants a la vez. SPEC §1 lo eligio a sabiendas y puso tres
 * condiciones; la primera es que esa conexion viva **solo** en el proceso del
 * back office, «inalcanzable desde la aplicacion cliente por cualquier ruta».
 *
 * ESTAS REGLAS SON ESA CONDICION, HECHA CUMPLIR. No son la unica defensa —hay
 * una regla de `audit:arch` que prohibe la arista y una prueba de integracion
 * que construye `AppModule` de verdad y comprueba que la conexion no esta en su
 * contenedor— pero si son la que falla ANTES, en el editor, cuando alguien
 * escribe el import.
 *
 * POR QUE TRES REGLAS Y NO UNA. Porque hay tres formas distintas de acabar con
 * la conexion privilegiada en el sitio equivocado, y una sola regla que las
 * cubriera a las tres seria un patron tan ancho que daria falsos positivos y
 * acabaria relajado. Cada una nombra su via.
 */

const CODIGO = ['apps/*/src/**/*.{ts,tsx}', 'apps/*/test/**/*.ts'];
const META = ['tools/audit/**', 'apps/*/test/fixtures/**'];

/** El unico sitio donde la conexion privilegiada puede existir. */
const EL_BACKOFFICE = [
  'apps/*/src/modules/backoffice/**',
  'apps/*/src/backoffice.ts',
  // Las pruebas del propio back office tienen que poder nombrarlo: comprobar
  // que `AppModule` NO tiene la conexion exige mencionarla, y probar la
  // interfaz exige montar el modulo. El patron es deliberadamente estrecho —
  // `backoffice*` bajo `test/integracion/` y nada mas—: una exencion de
  // `test/**` dejaria la regla sin cazar la prueba que un dia importe el modulo
  // desde la suite de la aplicacion cliente.
  'apps/*/test/integracion/backoffice*.spec.ts',
];

export const backofficeRules = [
  {
    id: 'conexion-privilegiada-solo-en-backoffice',
    descripcion: 'Nombrar `BackofficeConnection` fuera del modulo del back office',
    porQue:
      'Esa clase construye el cliente del unico rol con BYPASSRLS: no filtra por tenant y no hay politica que ' +
      'lo detenga. Que exista en el contenedor de inyeccion de la aplicacion cliente convierte un `@Inject` mal ' +
      'puesto en una fuga total. SPEC §1 exige que viva SOLO en el proceso del back office.',
    patron: /\bBackofficeConnection\b/g,
    incluye: CODIGO,
    excluye: [...META, ...EL_BACKOFFICE],
    desde: 'P11',
    referencia: 'SPEC §1 · CLAUDE.md §4.2 · ADR-017',
  },
  {
    id: 'cadena-privilegiada-solo-en-backoffice',
    descripcion: 'Leer `BACKOFFICE_DATABASE_URL` fuera del modulo del back office',
    porQue:
      'La cadena es la credencial del rol que lo ve todo. Leerla desde el proceso de la aplicacion cliente ' +
      'seria meterla en un proceso que no debe poder abrirla ni por error, y bastaria un `new PrismaClient` ' +
      'para saltarse las tres barreras a la vez.',
    patron: /BACKOFFICE_DATABASE_URL/g,
    incluye: CODIGO,
    excluye: [...META, ...EL_BACKOFFICE],
    desde: 'P11',
    referencia: 'SPEC §1 · ADR-017',
  },
  {
    id: 'backoffice-no-lo-monta-la-app',
    descripcion: 'Importar `BackofficeModule` desde el arbol de la aplicacion cliente',
    porQue:
      'Montarlo dentro de `AppModule` con un guard delante pondria la conexion privilegiada en el MISMO ' +
      'contenedor que todos los controladores del cliente, y el guard seria lo unico entre eso y una fuga ' +
      'total. Son dos procesos a proposito: el de la aplicacion ni siquiera tiene la variable de entorno.',
    patron: /\bBackofficeModule\b/g,
    incluye: CODIGO,
    excluye: [...META, ...EL_BACKOFFICE],
    desde: 'P11',
    referencia: 'SPEC §1 · CLAUDE.md §4.2',
  },
];
