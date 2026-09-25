/**
 * Las plantillas del correo transaccional, en texto plano — D-16.12.
 *
 * TRES CORREOS Y NADA MAS: la invitacion y el restablecimiento —el alcance
 * minimo que el usuario cerro—, que llevan lo mismo (un enlace y hasta cuando
 * vale), y el aviso de bloqueo del login (SEGURIDAD.md §2.1), que no lleva
 * nada. Ninguno dice mas: ni contrasenas, ni el nombre de la company, ni un
 * solo dato de negocio. Un correo es la parte del sistema que viaja por
 * buzones ajenos, se reenvia y se imprime; cuanto menos diga, menos hay que
 * proteger.
 *
 * TEXTO PLANO A PROPOSITO. Un correo de «activa tu cuenta» en HTML con botones
 * es indistinguible de una suplantacion; uno en texto, con el enlace a la vista,
 * deja que la persona lea a donde va antes de pulsar. Y el aviso de bloqueo va
 * SIN ENLACES: un correo automatico de seguridad con un enlace es exactamente
 * lo que un atacante mandaria.
 *
 * ES UNA FUNCION PURA de `application`: entra el contenido encolado, sale
 * asunto y cuerpo. Quien la llama es el despachador, justo antes de entregar.
 */

import type { ContenidoDeCorreo, DatosDeEnlace, PlantillaConEnlace } from './correo-a-encolar';

export interface CorreoRenderizado {
  readonly subject: string;
  readonly body: string;
}

/** `2026-09-10T13:00:00.000Z` → `2026-09-10 13:00 UTC`. */
const LARGO_HASTA_LOS_MINUTOS = 16;

/**
 * La fecha se enseña hasta los minutos y en UTC, sin zona local: el correo se
 * lee desde cualquier sitio y un «13:00» sin zona miente en la mitad de ellos.
 * Si el instante no se puede leer, se enseña tal cual antes que inventar uno.
 */
function fechaLegible(instanteIso: string): string {
  const instante = new Date(instanteIso);
  if (Number.isNaN(instante.getTime())) {
    return instanteIso;
  }
  return `${instante.toISOString().slice(0, LARGO_HASTA_LOS_MINUTOS).replace('T', ' ')} UTC`;
}

const PIE = 'Si no esperabas este mensaje, ignoralo: sin el enlace no ocurre nada.';

type PlantillaConDatos = (datos: DatosDeEnlace, producto: string) => CorreoRenderizado;

const CON_ENLACE: Readonly<Record<PlantillaConEnlace, PlantillaConDatos>> = {
  INVITACION: (datos, producto) => ({
    subject: `Te han invitado a ${producto}`,
    body:
      `Te han invitado a usar ${producto}. Para activar tu cuenta y elegir tu contrasena, ` +
      `abre este enlace:\n\n${datos.enlace}\n\n` +
      `El enlace caduca el ${fechaLegible(datos.caducaEn)}.\n\n${PIE}`,
  }),
  RESTABLECIMIENTO: (datos, producto) => ({
    subject: `Restablece tu contrasena de ${producto}`,
    body:
      `Alguien pidio restablecer la contrasena de tu cuenta en ${producto}. ` +
      `Si fuiste tu, abre este enlace y elige una nueva:\n\n${datos.enlace}\n\n` +
      `El enlace caduca el ${fechaLegible(datos.caducaEn)} y sirve una sola vez.\n\n` +
      `Si no lo pediste, tu contrasena sigue siendo la misma. ${PIE}`,
  }),
};

/**
 * Hasta P16-A1 este texto vivia en `IniciarSesion` y salia por `MailerPort`
 * directamente desde la API; ahora se encola como los otros dos (ADR-025).
 */
function bloqueo(producto: string): CorreoRenderizado {
  return {
    subject: `Intentos de acceso fallidos en tu cuenta de ${producto}`,
    body:
      `Hemos detectado varios intentos de acceso fallidos en tu cuenta de ${producto} y la ` +
      'hemos bloqueado temporalmente. Si has sido tu, vuelve a intentarlo en unos minutos. ' +
      'Si no, entra a la aplicacion como haces siempre y cambia tu contrasena.',
  };
}

export function renderizar(correo: ContenidoDeCorreo, nombreDelProducto: string): CorreoRenderizado {
  if (correo.plantilla === 'BLOQUEO') {
    return bloqueo(nombreDelProducto);
  }
  return CON_ENLACE[correo.plantilla](correo.datos, nombreDelProducto);
}
