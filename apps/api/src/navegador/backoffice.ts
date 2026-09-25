/**
 * La interfaz del back office. **Corre en el navegador; no es código de servidor.**
 *
 * Vive en `src/navegador/` y se compila con `tsconfig.ui.json`, que es el único
 * proyecto del repositorio con `lib: DOM`. Si esto viviera junto al resto de
 * `apps/api`, un endpoint podría usar `document` y compilaría.
 *
 * **CERO LÓGICA DE NEGOCIO** (CLAUDE.md §10). No calcula ni un número: pinta lo
 * que la API devuelve y manda lo que el operador escribe. La única aritmética es
 * contar caracteres del motivo, y ni siquiera esa decide nada — el servidor
 * vuelve a comprobarlo, y por debajo el `CHECK` de la base.
 *
 * **SIN FRAMEWORK, SIN DEPENDENCIAS, SIN PASO DE EMPAQUETADO.** Un archivo, un
 * módulo ES, `tsc` y ya. Para cuatro vistas que usa una persona por un túnel
 * SSH, montar React aquí sería añadir un build, un árbol de dependencias y una
 * superficie de actualización al proceso más peligroso del sistema.
 *
 * **EL MOTIVO ESTÁ SIEMPRE A LA VISTA, y eso es una decisión de trazabilidad.**
 * No es un diálogo que aparece al pulsar: es un campo permanente que dice qué se
 * va a registrar antes de que se registre. Un motivo que se pide *después* de
 * decidir mirar se rellena para pasar el trámite; uno que está delante mientras
 * se decide, se piensa.
 *
 * **NO SE GUARDA EN `localStorage`.** Ni el motivo ni nada. La sesión va en una
 * cookie `HttpOnly` y el motivo muere con la pestaña: es lo que impide que el
 * motivo de ayer acompañe al acceso de hoy.
 */

const MINIMO_DEL_MOTIVO = 20;

const SIN_SESION = 401;

interface CompanyEnLista {
  readonly id: string;
  readonly nombre: string;
  readonly estado: string;
  readonly plan: string;
  readonly creadaEn: string;
  readonly ubicaciones: number;
}

interface Limites {
  readonly code: string;
  readonly name: string;
  readonly maxLocations: number;
  readonly maxItems: number;
  readonly maxProducts: number;
}

interface CompanyDetallada extends CompanyEnLista {
  readonly items: number;
  readonly productos: number;
  readonly usuarios: number;
  readonly limites: Limites;
}

interface LineaDeAuditoria {
  readonly at: string;
  readonly eventType: string;
  readonly outcome: string;
  readonly actorType: string;
  readonly actorId: string | null;
  readonly ip: string | null;
}

interface AccesoRegistrado {
  readonly at: string;
  readonly operador: string;
  readonly companyId: string | null;
  readonly accion: string;
  readonly motivo: string;
  readonly ip: string | null;
}

/** Lo que devuelve `GET /correo/salud`: contadores e instantes, nunca correos. */
interface SaludDelCorreo {
  readonly pendientesAntiguos: number;
  readonly fallidos: number;
  readonly ultimoEnvio: string | null;
}

type Vista =
  | { readonly nombre: 'entrar' }
  | { readonly nombre: 'cartera' }
  | { readonly nombre: 'ficha'; readonly companyId: string }
  | { readonly nombre: 'accesos' };

interface Estado {
  vista: Vista;
  motivo: string;
  error: string | null;
  /**
   * El token anti-CSRF de la sesión del operador (ADR-021).
   *
   * **VIVE EN MEMORIA Y NO EN `localStorage`**, así que una recarga lo pierde y
   * hay que volver a entrar. Es aceptable aquí y no lo sería en la app cliente:
   * el back office es una sola pestaña, de una sesión de ocho horas, que se
   * abre para hacer una cosa. Guardarlo en disco solo añadiría un sitio donde
   * un XSS pudiera encontrarlo.
   */
  csrf: string | null;
}

const estado: Estado = { vista: { nombre: 'entrar' }, motivo: '', error: null, csrf: null };

// --- La API -----------------------------------------------------------------

class FalloDeApi extends Error {
  public constructor(
    message: string,
    public readonly estadoHttp: number,
  ) {
    super(message);
  }
}

/**
 * Toda llamada manda el motivo y la cookie.
 *
 * `same-origin` y no `include`: la interfaz la sirve el MISMO proceso que la
 * API, así que no hay petición cruzada — y por eso este proceso no necesita
 * CORS, que es la mitad de por qué la interfaz se sirve desde aquí.
 */
async function llamar<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
  const cabeceras = new Headers(opciones.headers);
  cabeceras.set('X-Motivo', estado.motivo);
  if (opciones.body !== undefined) cabeceras.set('Content-Type', 'application/json');
  // El token anti-CSRF en TODA mutación. La cabecera es el punto: un sitio
  // cruzado puede provocar una petición, pero no puede ponerle una cabecera.
  if (estado.csrf !== null) cabeceras.set('X-CSRF-Token', estado.csrf);

  const respuesta = await fetch(ruta, { ...opciones, headers: cabeceras, credentials: 'same-origin' });

  if (respuesta.status === 204) return undefined as T;

  const cuerpo: unknown = await respuesta.json().catch(() => null);
  if (!respuesta.ok) {
    throw new FalloDeApi(mensajeDe(cuerpo), respuesta.status);
  }
  return cuerpo as T;
}

function mensajeDe(cuerpo: unknown): string {
  if (typeof cuerpo === 'object' && cuerpo !== null && 'message' in cuerpo) {
    const mensaje = (cuerpo as { readonly message: unknown }).message;
    if (typeof mensaje === 'string') return mensaje;
  }
  return 'La petición no salió bien.';
}

// --- Pintar -----------------------------------------------------------------

function elemento<K extends keyof HTMLElementTagNameMap>(
  etiqueta: K,
  atributos: Readonly<Record<string, string>> = {},
  hijos: readonly (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const nodo = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(atributos)) nodo.setAttribute(clave, valor);
  // `append` con cadenas crea nodos de TEXTO, nunca HTML. Es lo que hace
  // imposible que el nombre de una company se interprete como marcado: aquí no
  // se concatena una plantilla en ningún sitio.
  for (const hijo of hijos) nodo.append(hijo);
  return nodo;
}

function raiz(): HTMLElement {
  const nodo = document.getElementById('raiz');
  if (nodo === null) throw new Error('Falta el nodo raíz de la página.');
  return nodo;
}

function fecha(iso: string): string {
  return iso.replace('T', ' ').slice(0, 19);
}

// --- Vistas -----------------------------------------------------------------

function vistaEntrar(): HTMLElement {
  const correo = elemento('input', { type: 'email', id: 'correo', autocomplete: 'username' });
  const clave = elemento('input', {
    type: 'password',
    id: 'clave',
    autocomplete: 'current-password',
  });
  const boton = elemento('button', { type: 'submit', class: 'principal' }, ['Entrar']);

  const formulario = elemento('form', { class: 'tarjeta' }, [
    elemento('label', { for: 'correo' }, ['Correo del operador']),
    correo,
    elemento('label', { for: 'clave' }, ['Contraseña']),
    clave,
    boton,
  ]);

  formulario.addEventListener('submit', (evento) => {
    evento.preventDefault();
    boton.disabled = true;
    void conError(async () => {
      const abierta = await llamar<{ readonly csrf: string }>('/sesion', {
        method: 'POST',
        body: JSON.stringify({ email: correo.value, contrasena: clave.value }),
      });
      estado.csrf = abierta.csrf;
      estado.vista = { nombre: 'cartera' };
    }).finally(() => {
      boton.disabled = false;
    });
  });

  return elemento('div', { class: 'entrar' }, [
    elemento('h1', {}, ['Back office']),
    elemento('p', { class: 'pie' }, [
      'Este panel ve los datos de TODOS los clientes. Cada acceso queda registrado con su motivo.',
    ]),
    formulario,
  ]);
}

function cajaDelMotivo(): HTMLElement {
  const campo = elemento('textarea', {
    id: 'motivo',
    placeholder: 'Para qué necesitas mirar estos datos',
  });
  campo.value = estado.motivo;

  const cuenta = elemento('p', { class: 'cuenta' }, []);
  const refrescar = (): void => {
    const faltan = MINIMO_DEL_MOTIVO - campo.value.trim().length;
    cuenta.textContent =
      faltan > 0
        ? `Faltan ${String(faltan)} caracteres para poder consultar nada.`
        : 'Este texto se guarda junto a cada consulta, con tu nombre y la hora.';
    cuenta.className = faltan > 0 ? 'cuenta falta' : 'cuenta';
  };

  campo.addEventListener('input', () => {
    estado.motivo = campo.value;
    refrescar();
  });
  refrescar();

  return elemento('section', { class: 'aviso' }, [
    elemento('label', { for: 'motivo' }, ['Motivo del acceso']),
    campo,
    cuenta,
  ]);
}

function cabecera(): HTMLElement {
  const salir = elemento('button', {}, ['Salir']);
  salir.addEventListener('click', () => {
    void conError(async () => {
      await llamar('/salir', { method: 'POST' });
      estado.vista = { nombre: 'entrar' };
      estado.motivo = '';
      estado.csrf = null;
    });
  });

  const irA = (nombre: 'cartera' | 'accesos', texto: string): HTMLButtonElement => {
    const actual = estado.vista.nombre === nombre;
    const boton = elemento('button', actual ? { 'aria-current': 'page' } : {}, [texto]);
    boton.addEventListener('click', () => {
      estado.vista = { nombre };
      pintar();
    });
    return boton;
  };

  return elemento('div', {}, [
    elemento('header', { class: 'cabecera' }, [
      elemento('h1', {}, ['Back office']),
      elemento('div', { class: 'quien' }, [salir]),
    ]),
    elemento('nav', {}, [irA('cartera', 'Cartera'), irA('accesos', 'Quién ha mirado qué')]),
    cajaDelMotivo(),
  ]);
}

function tabla(
  columnas: readonly string[],
  filas: readonly (readonly (Node | string)[])[],
  vacio: string,
): HTMLElement {
  if (filas.length === 0) return elemento('p', { class: 'vacio' }, [vacio]);

  return elemento('table', {}, [
    elemento('thead', {}, [
      elemento(
        'tr',
        {},
        columnas.map((columna) => elemento('th', {}, [columna])),
      ),
    ]),
    elemento(
      'tbody',
      {},
      filas.map((celdas) =>
        elemento(
          'tr',
          {},
          celdas.map((celda) => elemento('td', {}, [celda])),
        ),
      ),
    ),
  ]);
}

function insignia(estadoDeCompany: string): HTMLElement {
  return elemento('span', { class: `estado ${estadoDeCompany}` }, [estadoDeCompany]);
}

/**
 * La tarjeta de la cola de correo (D-16.27c). Tres números: si hay pendientes
 * viejos, el despachador no corre o el proveedor no entrega; si hay fallidos,
 * alguien tendrá que reenviar desde la aplicación. No enseña ningún correo.
 */
function tarjetaDeCorreo(salud: SaludDelCorreo): HTMLElement {
  const hayProblema = salud.pendientesAntiguos > 0 || salud.fallidos > 0;
  const linea = (que: string, cuanto: string, mal: boolean): HTMLElement =>
    elemento('p', mal ? { class: 'cuenta falta' } : { class: 'cuenta' }, [`${que}: ${cuanto}`]);

  return elemento('div', { class: hayProblema ? 'tarjeta aviso' : 'tarjeta' }, [
    elemento('h3', {}, ['Cola de correo']),
    linea('Pendientes con retraso', String(salud.pendientesAntiguos), salud.pendientesAntiguos > 0),
    linea('Fallidos', String(salud.fallidos), salud.fallidos > 0),
    linea('Último envío', salud.ultimoEnvio === null ? 'ninguno todavía' : fecha(salud.ultimoEnvio), false),
  ]);
}

async function vistaCartera(): Promise<HTMLElement> {
  const salud = await llamar<SaludDelCorreo>('/correo/salud');
  const companies = await llamar<readonly CompanyEnLista[]>('/companies');

  const filas = companies.map((company) => {
    const abrir = elemento('button', { class: 'enlace' }, [company.nombre]);
    abrir.addEventListener('click', () => {
      estado.vista = { nombre: 'ficha', companyId: company.id };
      pintar();
    });

    return [
      abrir,
      company.plan,
      insignia(company.estado),
      String(company.ubicaciones),
      fecha(company.creadaEn),
    ];
  });

  return elemento('section', {}, [
    elemento('h2', {}, [`Cartera · ${String(companies.length)} companies`]),
    tarjetaDeCorreo(salud),
    tabla(['Nombre', 'Plan', 'Estado', 'Ubicaciones', 'Creada'], filas, 'No hay ninguna todavía.'),
  ]);
}

function selector(
  id: string,
  opciones: readonly string[],
  actual: string,
): HTMLSelectElement {
  const campo = elemento(
    'select',
    { id },
    opciones.map((opcion) => elemento('option', { value: opcion }, [opcion])),
  );
  campo.value = actual;
  return campo;
}

function cambiador(entrada: {
  readonly etiqueta: string;
  readonly campo: HTMLSelectElement;
  readonly boton: string;
  readonly aplicar: (valor: string) => Promise<void>;
}): HTMLElement {
  const boton = elemento('button', {}, [entrada.boton]);
  boton.addEventListener('click', () => {
    boton.disabled = true;
    void conError(async () => {
      await entrada.aplicar(entrada.campo.value);
    }).finally(() => {
      boton.disabled = false;
    });
  });

  return elemento('div', { class: 'fila' }, [
    elemento('div', {}, [
      elemento('label', { for: entrada.campo.id }, [entrada.etiqueta]),
      entrada.campo,
    ]),
    boton,
  ]);
}

function usoDelPlan(company: CompanyDetallada): HTMLElement {
  const linea = (que: string, tiene: number, tope: number): readonly (Node | string)[] => [
    que,
    String(tiene),
    String(tope),
  ];

  return tabla(
    ['Recurso', 'Tiene', 'Permite el plan'],
    [
      linea('Ubicaciones', company.ubicaciones, company.limites.maxLocations),
      linea('Ítems', company.items, company.limites.maxItems),
      linea('Productos', company.productos, company.limites.maxProducts),
    ],
    '',
  );
}

function botonVolver(): HTMLElement {
  const volver = elemento('button', { class: 'enlace' }, ['← Volver a la cartera']);
  volver.addEventListener('click', () => {
    estado.vista = { nombre: 'cartera' };
    pintar();
  });
  return volver;
}

/** Los dos cambios que un operador puede hacer sobre una company. */
function cambiosDeLaCompany(
  company: CompanyDetallada,
  planes: readonly Limites[],
): HTMLElement {
  return elemento('div', { class: 'tarjeta' }, [
    cambiador({
      etiqueta: 'Plan',
      campo: selector(
        'plan',
        planes.map((plan) => plan.code),
        company.plan,
      ),
      boton: 'Cambiar plan',
      aplicar: async (plan) => {
        await llamar(`/companies/${company.id}/plan`, {
          method: 'PUT',
          body: JSON.stringify({ plan }),
        });
        pintar();
      },
    }),
    cambiador({
      etiqueta: 'Estado',
      campo: selector('estado', ['ACTIVE', 'SUSPENDED'], company.estado),
      boton: 'Cambiar estado',
      aplicar: async (nuevo) => {
        await llamar(`/companies/${company.id}/estado`, {
          method: 'PUT',
          body: JSON.stringify({ estado: nuevo }),
        });
        pintar();
      },
    }),
  ]);
}

function auditoriaDelCliente(auditoria: readonly LineaDeAuditoria[]): HTMLElement {
  return elemento('div', {}, [
    elemento('h2', {}, ['Auditoría de este cliente']),
    elemento('p', { class: 'pie' }, [
      'Lo que su propia aplicación registró. Consultarlo también queda registrado.',
    ]),
    tabla(
      ['Cuándo', 'Evento', 'Desenlace', 'Actor', 'IP'],
      auditoria.map((linea) => [
        fecha(linea.at),
        linea.eventType,
        linea.outcome,
        linea.actorType,
        linea.ip ?? '—',
      ]),
      'Sin eventos todavía.',
    ),
  ]);
}

async function vistaFicha(companyId: string): Promise<HTMLElement> {
  const company = await llamar<CompanyDetallada>(`/companies/${companyId}`);
  const planes = await llamar<readonly Limites[]>('/planes');
  const auditoria = await llamar<readonly LineaDeAuditoria[]>(
    `/companies/${companyId}/auditoria`,
  );

  return elemento('section', {}, [
    botonVolver(),
    elemento('h2', {}, [company.nombre]),
    elemento('p', { class: 'pie' }, [company.id]),
    elemento('div', { class: 'tarjeta' }, [
      elemento('div', { class: 'fila' }, [insignia(company.estado), `Plan ${company.plan}`]),
      usoDelPlan(company),
    ]),
    cambiosDeLaCompany(company, planes),
    auditoriaDelCliente(auditoria),
  ]);
}

async function vistaAccesos(): Promise<HTMLElement> {
  const accesos = await llamar<readonly AccesoRegistrado[]>('/accesos');

  return elemento('section', {}, [
    elemento('h2', {}, ['Quién ha mirado qué']),
    elemento('p', { class: 'pie' }, [
      'El registro del propio back office. No se puede editar ni borrar: el rol de base de datos no tiene permiso.',
    ]),
    tabla(
      ['Cuándo', 'Operador', 'Acción', 'Company', 'Motivo'],
      accesos.map((acceso) => [
        fecha(acceso.at),
        acceso.operador,
        acceso.accion,
        acceso.companyId ?? '—',
        acceso.motivo,
      ]),
      'Nadie ha mirado nada todavía.',
    ),
  ]);
}

// --- El bucle ---------------------------------------------------------------

/**
 * Ejecuta y, si falla, deja el mensaje de la API a la vista.
 *
 * **UN 401 DEVUELVE A LA PANTALLA DE ENTRADA**, no deja la página a medias: la
 * sesión dura ocho horas y caduca justo mientras alguien trabaja.
 */
async function conError(trabajo: () => Promise<void>): Promise<void> {
  try {
    estado.error = null;
    await trabajo();
  } catch (fallo) {
    if (fallo instanceof FalloDeApi && fallo.estadoHttp === SIN_SESION) {
      estado.vista = { nombre: 'entrar' };
    }
    estado.error = fallo instanceof Error ? fallo.message : 'Algo no salió bien.';
  }
  pintar();
}

function pintar(): void {
  const nodo = raiz();
  nodo.replaceChildren();

  if (estado.vista.nombre === 'entrar') {
    if (estado.error !== null) nodo.append(elemento('p', { class: 'error' }, [estado.error]));
    nodo.append(vistaEntrar());
    return;
  }

  nodo.append(cabecera());
  if (estado.error !== null) nodo.append(elemento('p', { class: 'error' }, [estado.error]));

  const cuerpo = elemento('p', { class: 'cargando' }, ['Cargando…']);
  nodo.append(cuerpo);

  void (async () => {
    try {
      cuerpo.replaceWith(await contenido());
    } catch (fallo) {
      const mensaje = fallo instanceof Error ? fallo.message : 'Algo no salió bien.';
      if (fallo instanceof FalloDeApi && fallo.estadoHttp === SIN_SESION) {
        estado.vista = { nombre: 'entrar' };
        estado.error = mensaje;
        pintar();
        return;
      }
      cuerpo.replaceWith(elemento('p', { class: 'error' }, [mensaje]));
    }
  })();
}

async function contenido(): Promise<HTMLElement> {
  if (estado.vista.nombre === 'cartera') return vistaCartera();
  if (estado.vista.nombre === 'accesos') return vistaAccesos();
  if (estado.vista.nombre === 'ficha') return vistaFicha(estado.vista.companyId);
  return vistaEntrar();
}

pintar();
