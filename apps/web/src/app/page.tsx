import { redirect } from 'next/navigation';

/** La raíz manda al costeo, que es la pantalla que el dueño abre. */
export default function Inicio(): never {
  redirect('/costeo');
}
