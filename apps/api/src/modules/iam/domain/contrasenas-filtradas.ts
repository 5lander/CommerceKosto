/**
 * Lista local de contrasenas conocidas — SEGURIDAD.md §2.2.
 *
 * POR QUE LISTA LOCAL Y NO HIBP. La comprobacion por k-anonimato contra Have I
 * Been Pwned exige una llamada de red DENTRO del flujo de crear una contrasena.
 * Eso significa: un servicio externo en el camino critico de un alta, una
 * credencial que gestionar, y una decision incomoda cuando la llamada falla
 * —aceptar la contrasena sin comprobar, o bloquear el alta—. Las dos salidas
 * son malas. Una lista local no falla, no tiene latencia y no filtra a un
 * tercero ni siquiera el prefijo del hash.
 *
 * QUE CUBRE Y QUE NO. Las contrasenas que un ataque por diccionario prueba en
 * los primeros segundos: las universales y las del teclado, mas las del ambito
 * hispanohablante, que ninguna lista en ingles trae. No cubre el largo de una
 * filtracion real de cientos de millones. Es la primera linea, no la unica: el
 * minimo de 12 caracteres, Argon2id y el bloqueo progresivo son las otras.
 *
 * Se compara NORMALIZADA (minusculas, sin espacios de los bordes), asi que
 * "Password123" y "PASSWORD123" caen con la misma entrada.
 */

export const CONTRASENAS_FILTRADAS: ReadonlySet<string> = new Set([
  '123456', '123456789', '12345678', '1234567890', '111111', '000000', '123123', '654321',
  'password', 'password1', 'password123', 'passw0rd', 'contrasena', 'contrasena1', 'contrasena123',
  'qwerty', 'qwerty123', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1q2w3e4r', '1qaz2wsx', 'qazwsx',
  'iloveyou', 'princess', 'sunshine', 'welcome', 'welcome1', 'monkey', 'dragon', 'football',
  'baseball', 'letmein', 'trustno1', 'superman', 'batman', 'master', 'shadow', 'michael',
  'admin', 'admin123', 'administrador', 'administrator', 'root', 'toor', 'usuario', 'usuario123',
  'invitado', 'guest', 'test', 'test123', 'prueba', 'prueba123', 'demo', 'demo1234',
  'hola', 'hola123', 'holamundo', 'holaquetal', 'buenos', 'gracias', 'familia', 'amigos',
  'tequiero', 'teamo', 'teamomucho', 'miamor', 'amor', 'amor123', 'corazon', 'bebe',
  'mama', 'papa', 'hermano', 'hermana', 'abuela', 'abuelo', 'cumpleanos', 'navidad',
  'ecuador', 'ecuador123', 'quito', 'quito123', 'guayaquil', 'cuenca', 'ambato', 'manabi',
  'barcelona', 'emelec', 'ldu', 'liga', 'barcelonasc', 'realmadrid', 'chelsea', 'juventus',
  'mexico', 'colombia', 'espana', 'argentina', 'chile', 'peru', 'venezuela', 'bolivia',
  'restaurante', 'restaurant', 'cocina', 'comida', 'menu', 'menu123', 'cheff', 'chef123',
  'inventario', 'bodega', 'bodega123', 'almacen', 'sucursal', 'negocio', 'empresa', 'empresa123',
  'costeo', 'costos', 'ventas', 'ventas123', 'caja', 'caja123', 'factura', 'contable',
  'abc123', 'abcd1234', 'abcdefg', 'aaaaaa', 'asdasd', 'asdf1234', '112233', '121212',
  'pokemon', 'naruto', 'minecraft', 'fortnite', 'starwars', 'whatsapp', 'facebook', 'instagram',
  'samsung', 'iphone', 'android', 'windows', 'computadora', 'internet', 'sistema', 'seguridad',
  'secreto', 'privado', 'personal', 'nuevo123', 'cambiar', 'cambiame', 'temporal', 'provisional',
]);
