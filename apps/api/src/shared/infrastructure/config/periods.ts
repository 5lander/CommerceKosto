/**
 * Configuración de períodos — D6, y la zona horaria de D11.
 *
 * **ES CONFIGURACIÓN VERSIONADA, NO VARIABLE DE ENTORNO**, y la diferencia
 * importa: cambiar esta zona cambia a qué mes pertenece cada movimiento futuro.
 * Un cambio así tiene que pasar por una revisión de código y quedar en el
 * historial, no aparecer en el `.env` de una máquina.
 *
 * **CAMBIARLA NO REESCRIBE LA HISTORIA.** Las fronteras de un período se
 * resuelven una sola vez, al abrirlo, y se guardan como dos instantes en
 * `period.starts_at` / `ends_at`. Los meses ya abiertos conservan la frontera
 * con la que se abrieron; solo los nuevos usarían la zona nueva. Es la razón
 * de que el modelo guarde instantes y no un mes — ver `periods/domain/periodo.ts`.
 *
 * D6 la sitúa en `config/periods.ts`. Vive bajo `shared/infrastructure/config/`
 * porque una carpeta `src/config/` suelta quedaría fuera de las tres capas que
 * `audit:arch` vigila, y el dominio no la lee nunca: la recibe por constructor.
 */

/** Ecuador, sin horario de verano (D11). */
export const ZONA_HORARIA_DE_PERIODOS = 'America/Guayaquil';
