import type { NextConfig } from 'next';

/**
 * Configuracion de Next.js.
 *
 * `reactStrictMode` deja los avisos de React en desarrollo: efectos que se
 * montan dos veces, APIs obsoletas. Con cinco pantallas y una semana, es la
 * clase de error que conviene ver en la consola y no en la sesion con el
 * cliente.
 *
 * NO HAY REESCRITURA DE `/api` HACIA EL BACKEND. La URL de la API llega por
 * variable de entorno y el navegador la llama directamente: una reescritura
 * pondria al servidor de Next en el camino de cada peticion sin aportar nada, y
 * escondería de donde salen los datos.
 */
const config: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,

  /**
   * DESACTIVADO A PROPOSITO. Next escribe por su cuenta un `AGENTS.md` y un
   * `CLAUDE.md` dentro de `apps/web` la primera vez que arranca.
   *
   * En este repositorio eso no es una comodidad, es un peligro: `CLAUDE.md` es
   * el archivo de reglas del proyecto —de cumplimiento obligatorio, con su
   * canario— y tener un segundo archivo con ese nombre, generado por una
   * herramienta y no revisado por nadie, es exactamente la clase de ambiguedad
   * que ese archivo existe para impedir.
   */
  agentRules: false,
};

export default config;
