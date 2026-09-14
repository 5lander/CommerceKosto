import { redirect } from 'next/navigation';

/** La raíz manda a Inicio: el mes de la sucursal, o qué reponer (U2). */
export default function Raiz(): never {
  redirect('/inicio');
}
