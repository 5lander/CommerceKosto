/**
 * Que contrasena se acepta al crearla — SEGURIDAD.md §2.2.
 *
 * SIN REGLAS DE COMPOSICION, Y ES DELIBERADO. No se exige "una mayuscula, un
 * numero y un simbolo". Esas reglas se cumplen con `Password1!` —que esta en
 * cualquier diccionario— y empujan a la gente hacia patrones predecibles y
 * hacia el papel pegado al monitor. NIST SP 800-63B las desaconseja
 * explicitamente desde 2017. Lo que si se exige es LARGO y que no este en una
 * lista conocida, que es lo que de verdad encarece el ataque.
 *
 * ES DOMINIO PURO: entra texto, sale una decision.
 */

import { CONTRASENAS_FILTRADAS } from './contrasenas-filtradas';

export const LARGO_MINIMO = 12;

/**
 * Argon2 no tiene el limite de 72 bytes de bcrypt, asi que el techo no es
 * criptografico: es para que nadie pueda pedir el hasheo de un megabyte y
 * convertir el login en una denegacion de servicio contra la CPU del servidor.
 */
export const LARGO_MAXIMO = 128;

/**
 * Por debajo de cuatro caracteres, exigir que la contrasena no contenga la
 * parte local del correo rechazaria frases legitimas por coincidencia: con
 * `ab@x.com`, cualquier contrasena con "abajo" dentro caeria.
 */
const LARGO_MINIMO_DE_PARTE_LOCAL = 4;

export type ProblemaDeContrasena =
  | { readonly clase: 'corta'; readonly minimo: number }
  | { readonly clase: 'larga'; readonly maximo: number }
  | { readonly clase: 'filtrada' }
  | { readonly clase: 'contiene_el_correo' };

function normalizar(contrasena: string): string {
  return contrasena.trim().toLowerCase();
}

/**
 * La lista se consulta DOS VECES: tal cual, y sin lo que cuelga al final.
 *
 * Sin esto la lista seria casi decorativa. El minimo son doce caracteres, y
 * "restaurante" tiene once: ninguna de las entradas cortas se alcanzaria jamas,
 * porque el largo fallaria antes. Y lo que la gente escribe cuando un
 * formulario le exige doce caracteres no es otra contrasena — es la misma con
 * un ano detras: `restaurante2026`, `guayaquil123456`, `administrador!!`.
 * Quitando la cola no alfabetica, esas vuelven a caer donde deben.
 *
 * Se descubrio escribiendo la prueba: dos de los tres casos del ambito
 * hispanohablante fallaban por LARGO y no por estar en la lista, y todas las
 * entradas de menos de doce caracteres eran peso muerto.
 */
function esConocida(contrasena: string): boolean {
  const normalizada = normalizar(contrasena);
  const sinCola = normalizada.replace(/[^a-záéíóúñü]+$/u, '');

  return CONTRASENAS_FILTRADAS.has(normalizada) || CONTRASENAS_FILTRADAS.has(sinCola);
}

/** @returns `null` si la contrasena es aceptable. */
export function problemaDeContrasena(entrada: {
  readonly contrasena: string;
  readonly correo: string;
}): ProblemaDeContrasena | null {
  const { contrasena, correo } = entrada;

  if (contrasena.length < LARGO_MINIMO) {
    return { clase: 'corta', minimo: LARGO_MINIMO };
  }
  if (contrasena.length > LARGO_MAXIMO) {
    return { clase: 'larga', maximo: LARGO_MAXIMO };
  }
  if (esConocida(contrasena)) {
    return { clase: 'filtrada' };
  }

  // La parte local del correo dentro de la contrasena la convierte en publica:
  // es el primer candidato de cualquier ataque dirigido.
  const parteLocal = normalizar(correo.split('@')[0] ?? '');
  const suficientementeLarga = parteLocal.length >= LARGO_MINIMO_DE_PARTE_LOCAL;
  if (suficientementeLarga && normalizar(contrasena).includes(parteLocal)) {
    return { clase: 'contiene_el_correo' };
  }

  return null;
}

const MENSAJES: Readonly<Record<ProblemaDeContrasena['clase'], string>> = {
  corta: `La contrasena debe tener al menos ${String(LARGO_MINIMO)} caracteres.`,
  larga: `La contrasena no puede pasar de ${String(LARGO_MAXIMO)} caracteres.`,
  filtrada: 'Esa contrasena aparece en listas publicas de contrasenas filtradas. Elige otra.',
  contiene_el_correo: 'La contrasena no puede contener tu correo.',
};

export function mensajeDelProblema(problema: ProblemaDeContrasena): string {
  return MENSAJES[problema.clase];
}
