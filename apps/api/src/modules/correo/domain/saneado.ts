/**
 * Lo que queda en `email_outbox.datos` cuando el correo ya no esta en vuelo —
 * D-16.34, ADR-025.
 *
 * EL TOKEN EN CLARO EXISTE EN LA BASE SOLO MIENTRAS EL CORREO ESTA EN VUELO.
 * Mientras es `PENDIENTE`, `datos` lleva el enlace con el token porque el
 * despachador lo necesita para escribir el correo. En cuanto se marca
 * `ENVIADO` —o `FALLIDO` tras el tope— el enlace deja de tener sentido en la
 * base: el usuario ya lo tiene en su buzon, o no lo va a tener nunca. Dejarlo
 * seria conservar una credencial que vale una cuenta, en una tabla que otros
 * dos roles pueden leer por columnas y que un volcado se llevaria entera.
 *
 * SE REEMPLAZA, NO SE BORRA: quedan la plantilla y el destinatario, que es lo
 * que hace falta para saber que se mando y a quien sin abrir ninguna otra
 * tabla. Nada mas: ni enlace, ni caducidad, ni el error del proveedor (ese va
 * en su columna).
 *
 * ES UNA FUNCION Y NO UN LITERAL EN EL REPOSITORIO para que exista UNA sola
 * lista de lo que sobrevive. `datos = {}` del aviso de bloqueo se trata igual
 * que cualquier otro: el resultado no depende de lo que hubiera antes.
 */

export interface DatosSaneados {
  readonly plantilla: string;
  readonly destinatario: string;
}

export function datosSaneados(plantilla: string, destinatario: string): DatosSaneados {
  return { plantilla, destinatario };
}
