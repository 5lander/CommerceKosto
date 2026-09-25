/**
 * `ipDelCliente`, probada con peticiones de mentira: un socket y unas
 * cabeceras. Lo que se prueba es la regla de D-16.49 en cada borde —cuando se
 * cree `X-Forwarded-For`, cuando no, y que nunca salga algo que no sea una IP—
 * porque `login_attempt.ip` es `INET` y la primera basura reventaria el login.
 */

import { describe, expect, it } from 'vitest';

import { esProxyDeConfianzaValido, ipDelCliente, normalizarIp, type PeticionConOrigen } from './ip-del-cliente';

const CADDY = '172.28.0.5';
const RED_DE_COMPOSE = '172.28.0.0/24';
const CLIENTE = '203.0.113.7';

function peticion(remoteAddress: string | undefined, reenviada?: string | string[]): PeticionConOrigen {
  return {
    socket: { remoteAddress },
    headers: reenviada === undefined ? {} : { 'x-forwarded-for': reenviada },
  };
}

describe('normalizarIp', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['0.0.0.0', '0.0.0.0'],
    ['255.255.255.255', '255.255.255.255'],
    ['  10.0.0.1 ', '10.0.0.1'],
  ])('una IPv4 valida sale tal cual: %s', (entrada, esperada) => {
    expect(normalizarIp(entrada)).toBe(esperada);
  });

  it.each(['256.0.0.1', '1.2.3', '1.2.3.4.5', '01.2.3.4', '1.2.3.4:5678', 'a.b.c.d', '', 'localhost'])(
    'lo que no es una IPv4 estricta no es una IPv4: %s',
    (entrada) => {
      expect(normalizarIp(entrada)).toBeNull();
    },
  );

  it.each([
    ['::ffff:127.0.0.1', '127.0.0.1'],
    ['::FFFF:203.0.113.7', '203.0.113.7'],
    ['::ffff:cb00:7107', '203.0.113.7'],
    ['0:0:0:0:0:ffff:7f00:1', '127.0.0.1'],
  ])('una IPv4 mapeada en IPv6 se devuelve como la IPv4: %s', (entrada, esperada) => {
    expect(normalizarIp(entrada)).toBe(esperada);
  });

  it.each([
    ['::1', '0:0:0:0:0:0:0:1'],
    ['::', '0:0:0:0:0:0:0:0'],
    ['2001:DB8::1', '2001:db8:0:0:0:0:0:1'],
    ['2001:0db8:0000:0000:0000:0000:0000:0001', '2001:db8:0:0:0:0:0:1'],
    ['fe80::1234:5678', 'fe80:0:0:0:0:0:1234:5678'],
    ['64:ff9b::192.0.2.33', '64:ff9b:0:0:0:0:c000:221'],
  ])('una IPv6 sale canonica, en minusculas y sin ceros a la izquierda: %s', (entrada, esperada) => {
    expect(normalizarIp(entrada)).toBe(esperada);
  });

  it.each(['fe80::1%eth0', '2001:db8:::1', '1:2:3:4:5:6:7:8:9', '1:2:3:4:5:6:7', '12345::1', 'g::1', ':::', '::1::'])(
    'una IPv6 mal formada, o con zona, no es una IP: %s',
    (entrada) => {
      expect(normalizarIp(entrada)).toBeNull();
    },
  );

  it('IPv6 con IPv4 embebida invalida tampoco', () => {
    expect(normalizarIp('::ffff:300.1.1.1')).toBeNull();
  });
});

describe('esProxyDeConfianzaValido', () => {
  it.each(['172.28.0.0/24', '10.0.0.0/8', '0.0.0.0/0', '203.0.113.7/32', '127.0.0.1', '::1', 'fd00::5', ' 172.28.0.1 '])(
    'acepta IPv4, CIDR v4 e IPv6 exacta: %s',
    (entrada) => {
      expect(esProxyDeConfianzaValido(entrada)).toBe(true);
    },
  );

  it.each(['172.28.0.0/33', 'fd00::/64', 'caddy', '172.28.0', '', '172.28.0.0/', '*'])(
    'rechaza CIDR v6, nombres y prefijos imposibles: %s',
    (entrada) => {
      expect(esProxyDeConfianzaValido(entrada)).toBe(false);
    },
  );
});

describe('ipDelCliente', () => {
  describe('sin proxy de confianza (desarrollo)', () => {
    it('es la IP del socket', () => {
      expect(ipDelCliente(peticion(CLIENTE), [])).toBe(CLIENTE);
    });

    it('X-Forwarded-For se IGNORA aunque venga: quien la manda es el cliente', () => {
      expect(ipDelCliente(peticion(CLIENTE, '198.51.100.9'), [])).toBe(CLIENTE);
    });

    it('la IPv4 mapeada del socket sale como IPv4', () => {
      expect(ipDelCliente(peticion('::ffff:127.0.0.1'), [])).toBe('127.0.0.1');
    });

    it('sin direccion en el socket, null', () => {
      expect(ipDelCliente(peticion(undefined), [])).toBeNull();
    });
  });

  describe('con el par del socket en la lista', () => {
    it('toma el ULTIMO salto de X-Forwarded-For', () => {
      expect(ipDelCliente(peticion(CADDY, `10.9.9.9, ${CLIENTE}`), [RED_DE_COMPOSE])).toBe(CLIENTE);
    });

    it('con un solo salto, ese', () => {
      expect(ipDelCliente(peticion(CADDY, CLIENTE), [RED_DE_COMPOSE])).toBe(CLIENTE);
    });

    it('acepta la IP exacta ademas del CIDR, y la IPv6 exacta', () => {
      expect(ipDelCliente(peticion(CADDY, CLIENTE), [CADDY])).toBe(CLIENTE);
      expect(ipDelCliente(peticion('::1', CLIENTE), ['0:0:0:0:0:0:0:1'])).toBe(CLIENTE);
      expect(ipDelCliente(peticion('::1', CLIENTE), ['::1'])).toBe(CLIENTE);
    });

    it('la lista compara en forma canonica: `127.0.0.1` casa con el `::ffff:127.0.0.1` del socket', () => {
      expect(ipDelCliente(peticion('::ffff:127.0.0.1', CLIENTE), ['127.0.0.1'])).toBe(CLIENTE);
    });

    it('la cabecera repetida se trata como una lista: manda el ultimo de la ultima', () => {
      expect(ipDelCliente(peticion(CADDY, ['10.1.1.1, 10.2.2.2', `10.3.3.3,${CLIENTE}`]), [RED_DE_COMPOSE])).toBe(
        CLIENTE,
      );
    });

    it('el ultimo salto se normaliza tambien', () => {
      expect(ipDelCliente(peticion(CADDY, '::ffff:203.0.113.7'), [RED_DE_COMPOSE])).toBe(CLIENTE);
      expect(ipDelCliente(peticion(CADDY, '2001:DB8::1'), [RED_DE_COMPOSE])).toBe('2001:db8:0:0:0:0:0:1');
    });

    it.each(['203.0.113.7:443', 'for=203.0.113.7', 'unknown', '', '   ', 'a, b', '256.1.1.1', 'fe80::1%eth0'])(
      'si el ultimo salto no es una IP, cae al socket: %s',
      (reenviada) => {
        expect(ipDelCliente(peticion(CADDY, reenviada), [RED_DE_COMPOSE])).toBe(CADDY);
      },
    );

    it('sin cabecera, el socket', () => {
      expect(ipDelCliente(peticion(CADDY), [RED_DE_COMPOSE])).toBe(CADDY);
    });

    it('una lista vacia tras el ultimo coma cae al socket, no a una cadena vacia', () => {
      expect(ipDelCliente(peticion(CADDY, `${CLIENTE},`), [RED_DE_COMPOSE])).toBe(CADDY);
    });
  });

  describe('con el par del socket FUERA de la lista', () => {
    it('una IP vecina de la red no entra: la mascara manda', () => {
      expect(ipDelCliente(peticion('172.28.1.5', CLIENTE), [RED_DE_COMPOSE])).toBe('172.28.1.5');
    });

    it('/32 es una sola direccion', () => {
      expect(ipDelCliente(peticion('172.28.0.6', CLIENTE), ['172.28.0.5/32'])).toBe('172.28.0.6');
    });

    it('/0 es todo IPv4, y aun asi una IPv6 no entra por un CIDR v4', () => {
      expect(ipDelCliente(peticion('8.8.8.8', CLIENTE), ['0.0.0.0/0'])).toBe(CLIENTE);
      expect(ipDelCliente(peticion('::1', CLIENTE), ['0.0.0.0/0'])).toBe('0:0:0:0:0:0:0:1');
    });

    it('una entrada mal escrita en la lista no confia en nadie', () => {
      expect(ipDelCliente(peticion(CADDY, CLIENTE), ['caddy', '172.28.0.0/33'])).toBe(CADDY);
    });
  });

  it('lo que sale siempre es una IP canonica o null: nunca la cabecera cruda', () => {
    const salidas = [
      ipDelCliente(peticion(CADDY, ' 203.0.113.7 '), [RED_DE_COMPOSE]),
      ipDelCliente(peticion('::ffff:172.28.0.5', '::FFFF:203.0.113.7'), [RED_DE_COMPOSE]),
      ipDelCliente(peticion(undefined, CLIENTE), [RED_DE_COMPOSE]),
    ];

    expect(salidas).toEqual([CLIENTE, CLIENTE, null]);
  });
});
