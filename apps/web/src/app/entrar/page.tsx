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

import { CampoDeTexto } from '../../componentes/ui/Campo';
import { Logotipo } from '../../componentes/ui/Marca';
import { codigoDe, llamar } from '../../lib/api';
import { guardarCsrf } from '../../lib/csrf';
import { TEXTOS } from '../../textos/es';

/** El código de dominio con el que el backend avisa del bloqueo progresivo. */
const BLOQUEADO = 'ACCESO_BLOQUEADO';

/** Lo que devuelve `POST /auth/login`. El token de sesión va en la cookie. */
interface RespuestaDeLogin {
  readonly expiraEn: string;
  readonly csrf: string;
}

function useEntrada() {
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
      // El cuerpo trae el token anti-CSRF de la sesión recién abierta: se
      // guarda en memoria para que la primera mutación no tenga que ir a
      // buscarlo a `GET /auth/sesion` (ADR-021).
      const abierta = await llamar<RespuestaDeLogin>({
        ruta: '/auth/login',
        metodo: 'POST',
        cuerpo: { email: correo, contrasena },
      });
      guardarCsrf(abierta.csrf);
      router.replace('/sucursal');
    } catch (fallo) {
      // El mensaje del bloqueo SÍ se toma del backend, que sabe cuánto falta.
      // El del rechazo se escribe aquí, deliberadamente vago.
      setError(codigoDe(fallo) === BLOQUEADO ? TEXTOS.acceso.bloqueado : TEXTOS.acceso.rechazado);
      setEntrando(false);
    }
  }

  return { correo, setCorreo, contrasena, setContrasena, error, entrando, enviar };
}

export default function Entrar(): ReactNode {
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
        <FormularioDeEntrada />
      </div>
    </main>
  );
}

function FormularioDeEntrada(): ReactNode {
  const entrada = useEntrada();

  return (
    // El manejador se envuelve en una función que NO devuelve la promesa: React
    // espera `void` en `onSubmit`, y devolverle una promesa deja un rechazo sin
    // capturar que no llega a ningún sitio. `void` lo dice explícitamente.
    <form
      onSubmit={(evento) => {
        void entrada.enviar(evento);
      }}
      className="pila pila--apretada"
    >
      <CampoDeTexto
        etiqueta={TEXTOS.acceso.correo}
        tipo="email"
        nombre="email"
        autocompletar="username"
        requerido
        valor={entrada.correo}
        cambiar={entrada.setCorreo}
      />

      <CampoDeTexto
        etiqueta={TEXTOS.acceso.contrasena}
        tipo="password"
        nombre="contrasena"
        autocompletar="current-password"
        requerido
        valor={entrada.contrasena}
        cambiar={entrada.setContrasena}
      />

      {entrada.error !== null && (
        <p role="alert" className="mal">
          {entrada.error}
        </p>
      )}

      <button type="submit" data-variante="primario" disabled={entrada.entrando}>
        {entrada.entrando ? TEXTOS.acceso.entrando : TEXTOS.acceso.entrar}
      </button>
    </form>
  );
}
