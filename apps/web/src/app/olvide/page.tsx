'use client';

/**
 * Pantalla 1b (primera mitad) — olvidé mi contraseña.
 *
 * **LA RESPUESTA ES LA MISMA EXISTA O NO LA CUENTA**, y esta pantalla no la
 * contradice: la API contesta 202 siempre (P16-A1), y aquí se enseña siempre la
 * misma frase. Decir «no encontramos ese correo» permitiría averiguar quién tiene
 * cuenta en el sistema, que es exactamente lo que el 202 constante impide.
 *
 * **EL 429 SÍ SE ENSEÑA, con el mensaje de la API**, que dice cuánto esperar: es
 * accionable, y no revela nada que quien lo recibe no sepa ya —que ha pedido
 * demasiados enlaces—.
 */

import Link from 'next/link';
import { useState } from 'react';
import type { ReactNode, SyntheticEvent } from 'react';

import { CampoDeTexto } from '../../componentes/ui/Campo';
import { Error as Fallo } from '../../componentes/ui/Estados';
import { llamar } from '../../lib/api';
import { useEnvio } from '../../lib/useEnvio';
import { TEXTOS } from '../../textos/es';

export default function Olvide(): ReactNode {
  const [pedido, setPedido] = useState(false);

  return (
    <main className="pantalla pantalla--angosta">
      <div className="pila">
        <div className="pila pila--minima">
          <h1 className="titulo">{TEXTOS.recuperacion.olvideTitulo}</h1>
          <p className="subtitulo">{TEXTOS.recuperacion.olvideAyuda}</p>
        </div>

        {pedido ? (
          <p role="status" className="panel panel--relleno">
            {TEXTOS.recuperacion.pedido}
          </p>
        ) : (
          <FormularioDeOlvido
            alPedir={() => {
              setPedido(true);
            }}
          />
        )}

        <Link href="/entrar" className="enlace">
          {TEXTOS.recuperacion.volverAEntrar}
        </Link>
      </div>
    </main>
  );
}

function FormularioDeOlvido({ alPedir }: { readonly alPedir: () => void }): ReactNode {
  const [correo, setCorreo] = useState('');
  const envio = useEnvio();

  async function pedir(evento: SyntheticEvent): Promise<void> {
    evento.preventDefault();
    const salio = await envio.enviar(async () => {
      await llamar({ ruta: '/auth/password/olvido', metodo: 'POST', cuerpo: { email: correo } });
    });
    if (salio) alPedir();
  }

  return (
    <form
      className="pila pila--apretada"
      onSubmit={(evento) => {
        void pedir(evento);
      }}
    >
      <CampoDeTexto
        etiqueta={TEXTOS.acceso.correo}
        tipo="email"
        nombre="email"
        autocompletar="username"
        requerido
        valor={correo}
        cambiar={setCorreo}
      />
      {envio.error !== null && <Fallo mensaje={envio.error} />}
      <button type="submit" data-variante="primario" disabled={envio.ocupado}>
        {envio.ocupado ? TEXTOS.recuperacion.pidiendo : TEXTOS.recuperacion.pedir}
      </button>
    </form>
  );
}
