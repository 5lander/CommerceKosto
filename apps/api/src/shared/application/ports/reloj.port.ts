/**
 * El reloj, como puerto.
 *
 * NO ES CEREMONIA. La politica anti fuerza bruta escala hasta una hora y las
 * sesiones caducan a los treinta dias: probar cualquiera de las dos cosas
 * contra `new Date()` significa o no probarlas, o esperar. Con el reloj
 * inyectado, un caso de uso que decide sobre el tiempo se prueba en
 * milisegundos y sin base de datos, que es el criterio arquitectonico de
 * CLAUDE.md §2.
 *
 * La implementacion real son tres lineas. Lo que compra no es abstraccion: es
 * que el tiempo deje de ser estado global.
 */

export const RELOJ = 'RELOJ';

export interface Reloj {
  ahora(): Date;
}
