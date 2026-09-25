/**
 * El proceso hijo que abre el archivo — SEGURIDAD.md §5.4.
 *
 * **AQUI ES DONDE SE TOCA LA ENTRADA HOSTIL, Y NO HAY NADA MAS.** No carga
 * NestJS, ni Prisma, ni la configuracion, ni el dominio. Solo el lector. Cuanto
 * menos haya cargado este proceso, menos hay que pueda salir mal en el sitio
 * donde se abre el archivo de un desconocido — y menos tarda en arrancar, que
 * se paga en cada importacion.
 *
 * **NO TIENE ACCESO A LA BASE.** El padre lo lanza con `env: {}`, asi que aqui
 * no hay cadena de conexion ni secretos. Ni siquiera podria conectarse.
 *
 * **DEVUELVE CELDAS, NO VALIDACION.** El reparto es deliberado: lo peligroso
 * —descomprimir, escanear XML, recorrer texto de origen desconocido— pasa aqui;
 * la validacion de cadenas ya extraidas es codigo puro sin superficie de
 * ataque, y se queda en el padre con el resto del dominio.
 *
 * **HABLA POR IPC Y NO POR STDOUT.** Un parser que escribe su resultado en la
 * salida estandar se mezcla con cualquier traza de una dependencia, y el padre
 * acaba parseando basura. El canal de mensajes esta separado.
 */

import { leerHoja } from './lector.mjs';

process.on('message', (peticion) => {
  try {
    const bytes = new Uint8Array(Buffer.from(peticion.bytes, 'base64'));
    const hoja = leerHoja(bytes, peticion.limites);

    process.send({ ok: true, formato: hoja.formato, filas: hoja.filas });
  } catch (error) {
    // EL MENSAJE DE UN `ErrorDeLectura` SALE AL USUARIO TAL CUAL —«tu archivo
    // se expande por encima del limite»— porque esta escrito para que lo lea.
    // Cualquier otro error se convierte en una frase generica: lo que no se
    // escribio para publicarse, no se publica.
    const publico = error instanceof Error && error.publico === true;

    process.send({ ok: false, error: publico ? error.message : 'No se pudo leer el archivo.' });
  }
});
