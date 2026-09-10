/**
 * Reglas del DESPACHADOR DE CORREO — P16-A1, D-16.23, ADR-025.
 *
 * `costeo_despachador` no puentea RLS, pero puede lo que la aplicacion no debe
 * poder: marcar un correo como enviado, reemplazar su enlace, y borrar los
 * golpes del limite de tasa. D-16.23 lo pone en su propio proceso con su
 * propia cadena de conexion, y estas tres reglas son esa separacion hecha
 * cumplir en el editor, antes de que `audit:arch` vea la arista o la prueba
 * de integracion construya `AppModule` y no lo encuentre.
 *
 * LAS TRES PRIMERAS SON EL ESPEJO EXACTO DE `backoffice.rules.mjs`, con la
 * misma forma y por la misma razon: tres vias distintas de acabar con la
 * conexion en el sitio equivocado, tres reglas que nombran cada una la suya.
 * La exencion de las pruebas es igual de estrecha —`correo*` bajo
 * `test/integracion/`— porque comprobar que `AppModule` NO tiene la conexion
 * exige nombrarla, y probar el despachador exige montar su modulo; nada mas la
 * necesita.
 *
 * LA CUARTA ES SOLO DEL BINARIO: el cierre ordenado del despachador (terminar
 * la pasada, cerrar el pool, salir con 0) es incompatible con los ganchos de
 * apagado de Nest, y la revision adversarial de la etapa 2 lo encontro roto
 * por eso. Una incidencia que cabe en una regla se convierte en regla (§8.4).
 */

const CODIGO = ['apps/*/src/**/*.{ts,tsx}', 'apps/*/test/**/*.ts'];
const META = ['tools/audit/**', 'apps/*/test/fixtures/**'];

/** El unico sitio donde la conexion del despachador puede existir. */
const EL_CORREO = [
  'apps/*/src/modules/correo/**',
  'apps/*/src/despachador.ts',
  'apps/*/test/integracion/correo*.spec.ts',
];

export const correoRules = [
  {
    id: 'conexion-del-despachador-solo-en-correo',
    descripcion: 'Nombrar `DespachadorConnection` fuera del modulo de correo',
    porQue:
      'Esa clase construye el cliente del rol que marca la cola y purga el limite de tasa. Que exista en el ' +
      'contenedor de inyeccion de la aplicacion cliente convierte un `@Inject` mal puesto en un endpoint que da ' +
      'por enviado lo que no salio o vacia el limite. D-16.23 exige que viva SOLO en el proceso del despachador.',
    patron: /\bDespachadorConnection\b/g,
    incluye: CODIGO,
    excluye: [...META, ...EL_CORREO],
    desde: 'P16-A1',
    referencia: 'CLAUDE.md §4.1 · D-16.23 · ADR-025',
  },
  {
    id: 'cadena-del-despachador-solo-en-correo',
    descripcion: 'Leer `DESPACHADOR_DATABASE_URL` fuera del modulo de correo',
    porQue:
      'La cadena es la credencial de un rol con UPDATE sobre la cola y DELETE sobre el limite de tasa. Leerla ' +
      'desde el proceso de la aplicacion cliente seria meterla en un proceso que no debe poder abrirla ni por ' +
      'error, y bastaria un `new PrismaClient` para usarla.',
    patron: /DESPACHADOR_DATABASE_URL/g,
    incluye: CODIGO,
    excluye: [...META, ...EL_CORREO],
    desde: 'P16-A1',
    referencia: 'D-16.23 · ADR-025',
  },
  {
    id: 'correo-no-lo-monta-la-app',
    descripcion: 'Importar `CorreoModule` desde el arbol de la aplicacion cliente',
    porQue:
      'Montarlo dentro de `AppModule` pondria la conexion del despachador en el MISMO contenedor que todos los ' +
      'controladores del cliente. Son dos procesos a proposito: el de la aplicacion ni siquiera tiene la ' +
      'variable de entorno, y su esquema no la acepta.',
    patron: /\bCorreoModule\b/g,
    incluye: CODIGO,
    excluye: [...META, ...EL_CORREO],
    desde: 'P16-A1',
    referencia: 'D-16.23 · ADR-025',
  },
  {
    id: 'despachador-sin-ganchos-de-nest',
    descripcion: 'Llamar a `enableShutdownHooks()` en el binario del despachador',
    porQue:
      'Los ganchos de Nest cierran el pool (`onModuleDestroy`) en cuanto llega la senal, con la pasada a medias, ' +
      'y despues re-emiten la senal con `process.kill` sin receptor: el proceso muere sin marcar el correo que el ' +
      'proveedor ya acepto, la reserva caduca y se envia dos veces. El despachador maneja SIGTERM/SIGINT a mano: ' +
      'termina la pasada, cierra el contexto y sale con 0 (`despachador.ts`).',
    patron: /enableShutdownHooks/g,
    incluye: ['apps/*/src/despachador.ts'],
    excluye: META,
    desde: 'P16-A1',
    referencia: 'ADR-025 · docs/pasos/P16-A1/CONSTRUCCION.md («Problemas», etapa 2)',
  },
];
