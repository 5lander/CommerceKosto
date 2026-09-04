/**
 * Quien puede tocar el rol de quien — SPEC §4.
 *
 * ES DOMINIO PURO Y ADEMAS ES REDUNDANTE CON LA BASE, a proposito. La clave
 * foranea compuesta contra `role(code, requires_location)` y el indice unico
 * parcial del OWNER ya impiden en PostgreSQL las combinaciones imposibles. Lo
 * que esto anade es (a) un mensaje que explica que pasa, en vez de un error
 * `23503` del driver, y (b) las reglas que la base NO puede expresar: que un
 * ADMIN no desmonte al OWNER y que nadie se toque a si mismo.
 *
 * Si estas comprobaciones desaparecieran, el sistema seguiria siendo seguro y
 * pasaria a ser incomprensible. Si desapareciera la base, no seria ninguna de
 * las dos cosas. Ese es el orden de importancia.
 */

export const ROL_OWNER = 'OWNER';

/** Los roles que se atan a una ubicacion. Espeja `role.requires_location`. */
const ROLES_DE_UBICACION: ReadonlySet<string> = new Set(['GERENTE_LOCAL', 'BODEGA']);

const ROLES_CONOCIDOS: ReadonlySet<string> = new Set([
  ROL_OWNER,
  'ADMIN',
  'GERENTE_LOCAL',
  'BODEGA',
  'LECTURA',
]);

export type ProblemaDeRol =
  | { readonly clase: 'rol_desconocido'; readonly rol: string }
  | { readonly clase: 'falta_ubicacion'; readonly rol: string }
  | { readonly clase: 'sobra_ubicacion'; readonly rol: string }
  | { readonly clase: 'owner_no_se_asigna' }
  | { readonly clase: 'owner_no_se_toca' }
  | { readonly clase: 'no_sobre_uno_mismo' };

export interface Asignacion {
  readonly rol: string;
  readonly tieneUbicacion: boolean;
}

export interface Actor {
  readonly userId: string;
  /** Roles efectivos del objetivo, para saber si es el OWNER. */
  readonly objetivoEsOwner: boolean;
  readonly objetivoUserId: string;
}

/**
 * @returns `null` si la asignacion es legitima.
 */
export function problemaDeAsignacion(entrada: {
  readonly asignacion: Asignacion;
  readonly actor: Actor;
}): ProblemaDeRol | null {
  const { asignacion, actor } = entrada;

  const problemaDelObjetivo = problemaSobreElObjetivo(actor);
  if (problemaDelObjetivo !== null) {
    return problemaDelObjetivo;
  }

  if (!ROLES_CONOCIDOS.has(asignacion.rol)) {
    return { clase: 'rol_desconocido', rol: asignacion.rol };
  }

  // El OWNER es unico por company y se establece al crear el tenant. Cederlo es
  // una operacion propia, con su confirmacion y su rastro; no un caso mas de
  // "asignar un rol". Mientras no exista, esta puerta esta cerrada.
  if (asignacion.rol === ROL_OWNER) {
    return { clase: 'owner_no_se_asigna' };
  }

  const necesita = ROLES_DE_UBICACION.has(asignacion.rol);
  if (necesita && !asignacion.tieneUbicacion) {
    return { clase: 'falta_ubicacion', rol: asignacion.rol };
  }
  if (!necesita && asignacion.tieneUbicacion) {
    return { clase: 'sobra_ubicacion', rol: asignacion.rol };
  }

  return null;
}

/** Las mismas dos reglas valen para revocar: no al OWNER, no a uno mismo. */
export function problemaDeRevocacion(actor: Actor): ProblemaDeRol | null {
  return problemaSobreElObjetivo(actor);
}

function problemaSobreElObjetivo(actor: Actor): ProblemaDeRol | null {
  // Nadie edita sus propios roles. Un ADMIN ya tiene casi todo, asi que esto no
  // impide una escalada que hoy sea posible: impide que MANANA lo sea, cuando
  // alguien anada una capacidad nueva y no se acuerde de esta ruta.
  if (actor.userId === actor.objetivoUserId) {
    return { clase: 'no_sobre_uno_mismo' };
  }

  // Un ADMIN tiene `user.update`, asi que sin esta regla podria dejar al OWNER
  // sin rol y quedarse con la company. La base impide DOS owners; no impide
  // quitarle el suyo al que hay.
  if (actor.objetivoEsOwner) {
    return { clase: 'owner_no_se_toca' };
  }

  return null;
}

const MENSAJES: Readonly<Record<ProblemaDeRol['clase'], string>> = {
  rol_desconocido: 'Ese rol no existe.',
  falta_ubicacion: 'Ese rol se ejerce sobre una ubicacion concreta: indica cual.',
  sobra_ubicacion: 'Ese rol es de nivel company: no lleva ubicacion.',
  owner_no_se_asigna: 'El propietario se establece al crear la company y se cede en otra operacion.',
  owner_no_se_toca: 'No se pueden modificar los roles del propietario.',
  no_sobre_uno_mismo: 'No puedes modificar tus propios roles.',
};

export function mensajeDelProblemaDeRol(problema: ProblemaDeRol): string {
  return MENSAJES[problema.clase];
}
