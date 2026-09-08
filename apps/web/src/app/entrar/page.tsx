'use client';

/**
 * Pantalla 1 — entrar.
 *
 * **NO DISTINGUE «no existe» DE «contraseña incorrecta»**, y el backend tampoco:
 * decirlo permitiría averiguar quién tiene cuenta en el sistema. El único caso
 * que sí se distingue es el bloqueo por intentos, porque ahí la persona necesita
 * saber que tiene que esperar y no que se equivocó de contraseña.
 *
 * La cookie de sesión la pone el servidor con `Set-Cookie`, y es `HttpOnly`.
 * **Esta pantalla nunca ve el token**, y por eso no puede filtrarlo.
 *
 * **P14 puso aquí el LOGOTIPO y no el isotipo.** Es lo que dice el manual
 * (p. 16): «el logotipo presenta la marca, el isotipo la recuerda». Esta es la
 * única pantalla donde la marca se presenta; en las demás ya se la conoce.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ReactNode, SyntheticEvent } from 'react';

import { Logotipo } from '../../componentes/ui/Marca';
import { ErrorDeApi, llamar } from '../../lib/api';
import { TEXTOS } from '../../textos/es';

/** El código de dominio con el que el backend avisa del bloqueo progresivo. */
const BLOQUEADO = 'ACCESO_BLOQUEADO';

export default function Entrar(): ReactNode {
  const router = useRouter();
  const [correo, setCorreo] = useState('');
  const [contrasena, setContrasena] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);

  async function enviar(evento: SyntheticEvent): Promise<void> {
    evento.preventDefault();
    setError(null);
    setEntrando(true);

    try {
      await llamar({ ruta: '/auth/login', metodo: 'POST', cuerpo: { email: correo, contrasena } });
      router.replace('/sucursal');
    } catch (fallo) {
      // El mensaje del bloqueo SÍ se toma del backend, que sabe cuánto falta.
      // El del rechazo se escribe aquí, deliberadamente vago.
      const bloqueado = fallo instanceof ErrorDeApi && fallo.codigo === BLOQUEADO;
      setError(bloqueado ? TEXTOS.acceso.bloqueado : TEXTOS.acceso.rechazado);
      setEntrando(false);
    }
  }

  return (
    <main className="pantalla pantalla--angosta">
      {/*
        El hueco de `.pila` son 21 px, por encima de los 13,6 px de área de
        resguardo que el manual exige alrededor del logotipo a este tamaño
        (t × φ² = 30,9 % de su alto). La cuenta está en `global.css`.
      */}
      <div className="pila">
        <Logotipo />

        <p className="nota">{TEXTOS.firma}</p>

        <h1 className="titulo">{TEXTOS.acceso.titulo}</h1>

        {/*
          El manejador se envuelve en una funcion que NO devuelve la promesa: React
          espera `void` en `onSubmit`, y devolverle una promesa deja un rechazo sin
          capturar que no llega a ningun sitio. `void` lo dice explicitamente.
        */}
        <form
          onSubmit={(evento) => {
            void enviar(evento);
          }}
          className="pila pila--apretada"
        >
          <label className="campo">
            {TEXTOS.acceso.correo}
            <input
              type="email"
              name="email"
              autoComplete="username"
              required
              value={correo}
              onChange={(e) => {
                setCorreo(e.target.value);
              }}
            />
          </label>

          <label className="campo">
            {TEXTOS.acceso.contrasena}
            <input
              type="password"
              name="contrasena"
              autoComplete="current-password"
              required
              value={contrasena}
              onChange={(e) => {
                setContrasena(e.target.value);
              }}
            />
          </label>

          {error !== null && (
            <p role="alert" className="mal">
              {error}
            </p>
          )}

          <button type="submit" data-variante="primario" disabled={entrando}>
            {entrando ? TEXTOS.acceso.entrando : TEXTOS.acceso.entrar}
          </button>
        </form>
      </div>
    </main>
  );
}
