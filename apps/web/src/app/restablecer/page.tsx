'use client';

/**
 * Pantalla 1b (segunda mitad) — restablecer la contraseña desde el enlace del
 * correo: `/restablecer?token=…`.
 *
 * **EL TOKEN SE GASTA ANTES DE MIRAR LA CONTRASEÑA** (P16-A1): la API lo hace así
 * para que nadie pueda reintentar con el mismo token contra el que ya falló. La
 * consecuencia para quien restablece es dura —una contraseña que no cumple la
 * política obliga a pedir otro enlace—, y por eso aquí se comprueba antes de
 * enviar lo que se puede comprobar sin la API: que las dos coinciden y que tienen
 * el largo mínimo. **La política entera la sigue decidiendo la API** (lista de
 * filtradas, que no contenga el correo): esto solo evita gastar el enlace en un
 * error de tecleo.
 *
 * **CUALQUIER 400 OFRECE PEDIR OTRO ENLACE.** La API devuelve el mismo mensaje
 * para un token inexistente, usado o caducado —a propósito, son indistinguibles—,
 * y en los tres casos, igual que tras una contraseña rechazada, lo único útil es
 * un enlace nuevo.
 */

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import type { ReactNode, SyntheticEvent } from 'react';

import { CampoDeTexto } from '../../componentes/ui/Campo';
import { Cargando, Error as Fallo } from '../../componentes/ui/Estados';
import { llamar } from '../../lib/api';
import { useEnvio } from '../../lib/useEnvio';
import { TEXTOS } from '../../textos/es';

/**
 * El largo mínimo de la política de contraseñas de la API (`LARGO_MINIMO`, P1).
 * Aquí es ayuda, no regla: si la API lo cambia, lo que manda es su 400.
 */
const LARGO_MINIMO_DE_CONTRASENA = 12;

/** El límite de tasa se comprueba ANTES de tocar el token: tras un 429 el enlace sigue valiendo. */
const LIMITE_DE_SOLICITUDES = 'LIMITE_DE_SOLICITUDES';

export default function Restablecer(): ReactNode {
  return (
    <main className="pantalla pantalla--angosta">
      <div className="pila">
        <div className="pila pila--minima">
          <h1 className="titulo">{TEXTOS.recuperacion.restablecerTitulo}</h1>
          <p className="subtitulo">{TEXTOS.recuperacion.restablecerAyuda}</p>
        </div>
        {/* `useSearchParams` en una página estática exige su límite de suspensión. */}
        <Suspense fallback={<Cargando />}>
          <ConElToken />
        </Suspense>
      </div>
    </main>
  );
}

function ConElToken(): ReactNode {
  const token = useSearchParams().get('token');
  const [hecho, setHecho] = useState(false);

  if (token === null || token === '') return <SinEnlaceValido mensaje={TEXTOS.recuperacion.sinToken} />;
  if (hecho) {
    return (
      <div className="pila pila--apretada">
        <p role="status" className="panel panel--relleno">
          {TEXTOS.recuperacion.hecho}
        </p>
        <Link href="/entrar" className="enlace">
          {TEXTOS.recuperacion.volverAEntrar}
        </Link>
      </div>
    );
  }
  return (
    <FormularioDeRestablecimiento
      token={token}
      alTerminar={() => {
        setHecho(true);
      }}
    />
  );
}

function SinEnlaceValido({ mensaje }: { readonly mensaje: string }): ReactNode {
  return (
    <div className="pila pila--apretada">
      <Fallo mensaje={mensaje} />
      <Link href="/olvide" className="enlace">
        {TEXTOS.recuperacion.pedirOtro}
      </Link>
    </div>
  );
}

/** Lo que se comprueba sin la API, o `null` si se puede enviar. */
function problemaLocal(contrasena: string, repetida: string): string | null {
  if (contrasena.length < LARGO_MINIMO_DE_CONTRASENA) return TEXTOS.recuperacion.corta;
  return contrasena === repetida ? null : TEXTOS.recuperacion.noCoinciden;
}

function useRestablecimiento(token: string, alTerminar: () => void) {
  const [contrasena, setContrasena] = useState('');
  const [repetida, setRepetida] = useState('');
  const [problema, setProblema] = useState<string | null>(null);
  const envio = useEnvio();

  async function guardar(evento: SyntheticEvent): Promise<void> {
    evento.preventDefault();
    const local = problemaLocal(contrasena, repetida);
    setProblema(local);
    if (local !== null) return;
    const salio = await envio.enviar(async () => {
      await llamar({ ruta: '/auth/password/restablecimiento', metodo: 'POST', cuerpo: { token, contrasena } });
    });
    if (salio) alTerminar();
  }

  return { contrasena, setContrasena, repetida, setRepetida, problema, envio, guardar };
}

function CamposDeContrasena({
  restablecimiento,
}: {
  readonly restablecimiento: ReturnType<typeof useRestablecimiento>;
}): ReactNode {
  return (
    <>
      <CampoDeTexto
        etiqueta={TEXTOS.recuperacion.nueva}
        tipo="password"
        nombre="nueva"
        autocompletar="new-password"
        requerido
        valor={restablecimiento.contrasena}
        cambiar={restablecimiento.setContrasena}
      />
      <CampoDeTexto
        etiqueta={TEXTOS.recuperacion.repetir}
        tipo="password"
        nombre="repetida"
        autocompletar="new-password"
        requerido
        valor={restablecimiento.repetida}
        cambiar={restablecimiento.setRepetida}
      />
      <p className="nota">{TEXTOS.recuperacion.politica}</p>
    </>
  );
}

function FormularioDeRestablecimiento({
  token,
  alTerminar,
}: {
  readonly token: string;
  readonly alTerminar: () => void;
}): ReactNode {
  const restablecimiento = useRestablecimiento(token, alTerminar);
  const { problema, envio, guardar } = restablecimiento;
  const conLimite = envio.codigo === LIMITE_DE_SOLICITUDES;
  if (envio.error !== null && !conLimite) return <SinEnlaceValido mensaje={envio.error} />;

  return (
    <form
      className="pila pila--apretada"
      onSubmit={(evento) => {
        void guardar(evento);
      }}
    >
      <CamposDeContrasena restablecimiento={restablecimiento} />
      {problema !== null && (
        <p role="alert" className="mal">
          {problema}
        </p>
      )}
      {conLimite && envio.error !== null && <Fallo mensaje={envio.error} />}
      <button type="submit" data-variante="primario" disabled={envio.ocupado}>
        {envio.ocupado ? TEXTOS.recuperacion.guardando : TEXTOS.recuperacion.guardar}
      </button>
    </form>
  );
}
