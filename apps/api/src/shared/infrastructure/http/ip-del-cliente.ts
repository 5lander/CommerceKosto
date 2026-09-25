/**
 * La IP del cliente, con el proxy delante — D-16.36, D-16.49, INC-022.
 *
 * DETRAS DE CADDY TODA PETICION LLEGA CON LA IP DE CADDY. `socket.remoteAddress`
 * es la direccion del contenedor `caddy` en la red de compose, para todos los
 * usuarios a la vez. Con esa IP, el bloqueo por IP del login (25 fallos por
 * hora) seria un bloqueo GLOBAL, y un limite por IP nuevo no mediria nada.
 * La IP real viaja en `X-Forwarded-For`, que Caddy anade por defecto.
 *
 * PERO `X-Forwarded-For` LA ESCRIBE QUIEN HACE LA PETICION. Si se creyera
 * siempre, un atacante podria (a) esquivar cualquier limite por IP cambiandola
 * en cada intento y (b) peor, ENVENENAR la cuenta de otra IP para bloquear a
 * un tercero. Por eso la regla es una sola y esta aqui:
 *
 *   SE LEE EL ULTIMO SALTO DE `X-Forwarded-For` SOLO SI EL SOCKET ES DE UN
 *   PROXY DE CONFIANZA (`PROXY_DE_CONFIANZA`). Si no, la IP es la del socket.
 *
 * El ultimo salto y no el primero: el primero lo puso el cliente (o quien
 * quiso); el ultimo lo puso el proxy en el que se confia, con lo que vio en
 * su propio socket. Con un solo proxy delante, ese es el cliente.
 *
 * LA LISTA ES EXPLICITA Y VACIA POR DEFECTO. En desarrollo no hay proxy y el
 * socket es la verdad; en produccion es la IP fija de Caddy en la red de
 * compose (`172.28.0.10`), no la subred: en la subred estan la pasarela y los
 * demas contenedores. No hay "confia en todo" ni "confia en privadas": una
 * lista amplia es exactamente el envenenamiento de arriba con otro nombre.
 *
 * LO QUE SALE ES UNA IP O `null`, NUNCA OTRA COSA. `login_attempt.ip` y
 * `session.ip` son `INET`: un valor con puerto, un `for=` de RFC 7239 o basura
 * tras un `split(',')` reventaria el INSERT justo en el camino del login. Se
 * valida con expresiones regulares (IPv4 estricta e IPv6, sin zona) y, si la
 * cabecera no parsea, se cae a la IP del socket. `::ffff:a.b.c.d` —lo que Node
 * entrega cuando escucha en `::` y llega IPv4— se normaliza a `a.b.c.d`, para
 * que `127.0.0.1` en la lista signifique lo que dice.
 *
 * Lo usan el login, el back office, `LimitadorDeTasa` y el `ThrottlerGuard`
 * global (`limitador-global.guard.ts`). No hay otra copia.
 */

/** Lo que hace falta de una `IncomingMessage`, en forma estructural para poder fabricarla en las pruebas. */
export interface PeticionConOrigen {
  readonly socket: { readonly remoteAddress?: string | undefined };
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

const OCTETO = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4 = new RegExp(`^${OCTETO}(?:\\.${OCTETO}){3}$`, 'u');
const CIDR_V4 = new RegExp(`^(${OCTETO}(?:\\.${OCTETO}){3})/(3[0-2]|[12]?\\d)$`, 'u');
const GRUPO_V6 = /^[0-9a-f]{1,4}$/iu;

const GRUPOS_V6 = 8;
const BITS_POR_OCTETO = 8;
const BITS_POR_GRUPO = 16;
const BITS_V4 = 32;
const BASE_HEX = 16;
/** Un `::` como mucho: `split('::')` da dos partes o ninguna vale. */
const PARTES_DE_UN_DOBLE_DOS_PUNTOS = 2;
const GRUPOS_ANTES_DE_LA_V4_MAPEADA = 5;
const MARCA_V4_MAPEADA = 0xffff;
const MASCARA_DE_GRUPO = 0xffff;
const MASCARA_DE_OCTETO = 0xff;
const OCTETOS_POR_GRUPO_MAS_UNO = 1 << BITS_POR_OCTETO;

function esIpv4(valor: string): boolean {
  return IPV4.test(valor);
}

/** Los cuatro octetos como entero sin signo de 32 bits. Solo con una IPv4 ya validada. */
function comoEntero(ipv4: string): number {
  return (
    ipv4.split('.').reduce((acumulado, octeto) => acumulado * OCTETOS_POR_GRUPO_MAS_UNO + Number(octeto), 0) >>> 0
  );
}

/** Los dos grupos hexadecimales de una IPv4 embebida en una IPv6. */
function gruposDeIpv4(ipv4: string): readonly number[] {
  const entero = comoEntero(ipv4);
  return [(entero >>> BITS_POR_GRUPO) & MASCARA_DE_GRUPO, entero & MASCARA_DE_GRUPO];
}

function gruposDe(parte: string): readonly number[] | null {
  if (parte === '') {
    return [];
  }
  const grupos: number[] = [];
  const trozos = parte.split(':');
  for (const [indice, trozo] of trozos.entries()) {
    const esElUltimo = indice === trozos.length - 1;
    if (esElUltimo && trozo.includes('.')) {
      if (!esIpv4(trozo)) {
        return null;
      }
      grupos.push(...gruposDeIpv4(trozo));
      continue;
    }
    if (!GRUPO_V6.test(trozo)) {
      return null;
    }
    grupos.push(Number.parseInt(trozo, BASE_HEX));
  }
  return grupos;
}

/**
 * Los ocho grupos de una IPv6, o `null` si no lo es. Acepta `::`, la IPv4
 * embebida al final y mayusculas; rechaza la zona (`%eth0`) porque `INET` no
 * la admite.
 */
function gruposDeIpv6(valor: string): readonly number[] | null {
  if (valor.includes('%')) {
    return null;
  }
  const dobles = valor.split('::');
  if (dobles.length > PARTES_DE_UN_DOBLE_DOS_PUNTOS) {
    return null;
  }
  const izquierda = gruposDe(dobles[0] ?? '');
  const derecha = dobles.length === 1 ? [] : gruposDe(dobles[1] ?? '');
  if (izquierda === null || derecha === null) {
    return null;
  }
  const faltan = GRUPOS_V6 - izquierda.length - derecha.length;
  if (dobles.length === 1 ? faltan !== 0 : faltan < 1) {
    return null;
  }
  return [...izquierda, ...Array.from({ length: faltan }, () => 0), ...derecha];
}

function esIpv4Mapeada(grupos: readonly number[]): boolean {
  return (
    grupos.slice(0, GRUPOS_ANTES_DE_LA_V4_MAPEADA).every((g) => g === 0) &&
    grupos[GRUPOS_ANTES_DE_LA_V4_MAPEADA] === MARCA_V4_MAPEADA
  );
}

function ipv4DeLosGrupos(grupos: readonly number[]): string {
  const alto = grupos[GRUPOS_V6 - PARTES_DE_UN_DOBLE_DOS_PUNTOS] ?? 0;
  const bajo = grupos[GRUPOS_V6 - 1] ?? 0;
  return [
    alto >>> BITS_POR_OCTETO,
    alto & MASCARA_DE_OCTETO,
    bajo >>> BITS_POR_OCTETO,
    bajo & MASCARA_DE_OCTETO,
  ].join('.');
}

/**
 * Una IP en su forma canonica, o `null` si el texto no es una IP.
 *
 *   IPv4              tal cual (`203.0.113.7`)
 *   IPv4 mapeada      la IPv4 (`::ffff:203.0.113.7` → `203.0.113.7`)
 *   IPv6              ocho grupos en minusculas sin ceros a la izquierda
 *                     (`2001:DB8::1` → `2001:db8:0:0:0:0:0:1`)
 *
 * La forma canonica es lo que permite comparar con la lista de confianza y
 * lo que hace que la misma direccion produzca siempre la misma clave.
 */
export function normalizarIp(cruda: string): string | null {
  const valor = cruda.trim();
  if (esIpv4(valor)) {
    return valor;
  }
  const grupos = gruposDeIpv6(valor);
  if (grupos === null) {
    return null;
  }
  if (esIpv4Mapeada(grupos)) {
    return ipv4DeLosGrupos(grupos);
  }
  return grupos.map((g) => g.toString(BASE_HEX)).join(':');
}

function dentroDelCidr(ip: string, cidr: RegExpExecArray): boolean {
  if (!esIpv4(ip)) {
    return false;
  }
  const red = cidr[1] ?? '';
  const prefijo = Number(cidr[2]);
  const mascara = prefijo === 0 ? 0 : (~0 << (BITS_V4 - prefijo)) >>> 0;
  return ((comoEntero(ip) & mascara) >>> 0) === ((comoEntero(red) & mascara) >>> 0);
}

/** Una entrada de `PROXY_DE_CONFIANZA`: IPv4, IPv4 con prefijo CIDR, o IPv6 exacta. */
export function esProxyDeConfianzaValido(entrada: string): boolean {
  return CIDR_V4.test(entrada.trim()) || normalizarIp(entrada) !== null;
}

function esDeConfianza(ip: string, proxies: readonly string[]): boolean {
  return proxies.some((entrada) => {
    const cidr = CIDR_V4.exec(entrada.trim());
    return cidr === null ? normalizarIp(entrada) === ip : dentroDelCidr(ip, cidr);
  });
}

/** El ultimo salto de `X-Forwarded-For`, normalizado; `null` si no hay cabecera o no es una IP. */
function ultimoSaltoReenviado(peticion: PeticionConOrigen): string | null {
  const cruda = peticion.headers['x-forwarded-for'];
  const unida = Array.isArray(cruda) ? cruda.join(',') : (cruda ?? '');
  const ultimo = unida.split(',').at(-1) ?? '';
  return ultimo.trim() === '' ? null : normalizarIp(ultimo);
}

/**
 * @param proxiesDeConfianza `Configuration.proxiesDeConfianza` en la app;
 *   `PROXY_DE_CONFIANZA` leida a mano en el back office. Vacia = el socket.
 * @returns la IP del cliente en forma canonica, o `null` si el socket no tiene
 *   direccion (un socket de Unix, o una peticion ya cerrada).
 */
export function ipDelCliente(peticion: PeticionConOrigen, proxiesDeConfianza: readonly string[]): string | null {
  const cruda = peticion.socket.remoteAddress;
  const socket = cruda === undefined ? null : normalizarIp(cruda);
  if (socket === null || !esDeConfianza(socket, proxiesDeConfianza)) {
    return socket;
  }
  return ultimoSaltoReenviado(peticion) ?? socket;
}
