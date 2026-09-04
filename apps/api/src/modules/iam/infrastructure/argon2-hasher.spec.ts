/**
 * El hasher no necesita base de datos, asi que se prueba en unitarias.
 *
 * La prueba que importa no es que hashee: es que **verificar contra un usuario
 * inexistente cuesta trabajo de verdad**. Sin eso, el tiempo de respuesta
 * distingue "el correo no existe" de "la contrasena es incorrecta", y con esa
 * diferencia se enumera el padron de usuarios sin acertar ninguna contrasena.
 */

import { describe, expect, it } from 'vitest';

import { Argon2Hasher } from './argon2-hasher';

const CONTRASENA = 'una contrasena razonablemente larga';

/** Un hash de Argon2id cuesta decenas de ms; una rama vacia, menos de uno. */
const PISO_DE_TRABAJO_MS = 5;

describe('Argon2Hasher', () => {
  const hasher = new Argon2Hasher();

  it('produce un hash de argon2id, con sus parametros dentro', async () => {
    const hash = await hasher.hash(CONTRASENA);

    expect(hash).toMatch(/^\$argon2id\$/u);
    expect(hash).toContain('m=65536');
    expect(hash).toContain('t=3');
    expect(hash).toContain('p=1');
  });

  it('el mismo texto produce hashes DISTINTOS: la sal es aleatoria', async () => {
    const [a, b] = await Promise.all([hasher.hash(CONTRASENA), hasher.hash(CONTRASENA)]);

    expect(a).not.toBe(b);
  });

  it('verifica la contrasena correcta', async () => {
    const hash = await hasher.hash(CONTRASENA);

    await expect(hasher.verificar(hash, CONTRASENA)).resolves.toBe(true);
  });

  it('rechaza la incorrecta', async () => {
    const hash = await hasher.hash(CONTRASENA);

    await expect(hasher.verificar(hash, `${CONTRASENA} `)).resolves.toBe(false);
  });

  describe('usuario inexistente', () => {
    it('devuelve false sin lanzar', async () => {
      await expect(hasher.verificar(null, CONTRASENA)).resolves.toBe(false);
    });

    it('HACE EL TRABAJO igual: no es una rama vacia', async () => {
      // Se calienta primero el hash ficticio, que se calcula una sola vez: lo
      // que se mide es la verificacion, no la construccion del doble.
      await hasher.verificar(null, CONTRASENA);

      const antes = performance.now();
      await hasher.verificar(null, CONTRASENA);
      const transcurrido = performance.now() - antes;

      expect(transcurrido).toBeGreaterThan(PISO_DE_TRABAJO_MS);
    });
  });

  describe('necesitaRehash', () => {
    it('un hash recien creado no lo necesita', async () => {
      const hash = await hasher.hash(CONTRASENA);

      expect(hasher.necesitaRehash(hash)).toBe(false);
    });

    it('uno con parametros mas debiles SI', () => {
      // El unico momento en que se puede endurecer una contrasena es cuando el
      // usuario acaba de escribirla en claro. Si esta comprobacion no existiera,
      // los hashes de 2026 seguirian con los parametros de 2026 para siempre.
      const debil = '$argon2id$v=19$m=4096,t=1,p=1$c29tZXNhbHRzYWx0$hgSHT8xJc1RTZgo3wBoWQ3RSFB6PLQyFqTBQKrLJdaU';

      expect(hasher.necesitaRehash(debil)).toBe(true);
    });
  });
});
