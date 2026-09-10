/**
 * Lo que la aplicacion ENCOLA, no lo que se envia — ADR-025.
 *
 * LA API NO MANDA CORREOS: escribe una fila en `email_outbox` dentro de la
 * misma transaccion que crea la invitacion o el token de restablecimiento, y
 * un proceso aparte —el despachador, con su propio rol— la entrega. Si la
 * transaccion se revierte, el correo no existe; si el proveedor esta caido, la
 * invitacion existe igual y el correo sale cuando vuelva. Es la diferencia
 * entre «te invite» y «te invite, pero el correo se perdio y nadie lo sabe».
 *
 * TRES PLANTILLAS, DE DOS FORMAS. La invitacion y el restablecimiento llevan un
 * enlace con el token EN CLARO y su caducidad, y por eso `datos` solo vive en
 * la base mientras el correo esta en vuelo (D-16.34): al marcar `ENVIADO` o
 * `FALLIDO`, el despachador lo reemplaza por `{plantilla, destinatario}`. El
 * aviso de bloqueo del login no lleva NADA —ni enlace, ni cifra, ni hora—,
 * porque un correo de seguridad con un enlace es indistinguible de la
 * suplantacion que dice prevenir. La union discriminada hace que no se pueda
 * encolar un aviso con enlace ni una invitacion sin el. Aqui no hay contrasenas
 * ni datos de negocio.
 *
 * LA PLANTILLA ES UN TIPO CERRADO, no texto: el CHECK `email_outbox_plantilla_conocida`
 * de la base lo repite, y `renderizar` no compila con una que no exista.
 */

export type PlantillaConEnlace = 'INVITACION' | 'RESTABLECIMIENTO';

export interface DatosDeEnlace {
  /** El enlace completo (`APP_URL/...?token=...`). Solo en vuelo. */
  readonly enlace: string;
  /** Instante ISO 8601 en que el enlace deja de valer. */
  readonly caducaEn: string;
}

export type ContenidoDeCorreo =
  | { readonly plantilla: PlantillaConEnlace; readonly datos: DatosDeEnlace }
  /** Un `jsonb` vacio: el aviso no lleva datos y la columna es NOT NULL. */
  | { readonly plantilla: 'BLOQUEO'; readonly datos: Readonly<Record<string, never>> };

export type CorreoAEncolar = ContenidoDeCorreo & { readonly destinatario: string };

/**
 * Lo que va a la columna `datos`, copiado CAMPO A CAMPO: la lista explicita
 * impide que un dato de mas —una contrasena, un nombre— llegue al outbox por
 * venir dentro del objeto. Es la unica forma de construirlo, y la comparten el
 * repositorio de organizacion (Prisma) y la llamada a `password_reset_request`.
 */
export function datosParaGuardar(correo: ContenidoDeCorreo): Readonly<Record<string, string>> {
  if (correo.plantilla === 'BLOQUEO') {
    return {};
  }
  return { enlace: correo.datos.enlace, caducaEn: correo.datos.caducaEn };
}
