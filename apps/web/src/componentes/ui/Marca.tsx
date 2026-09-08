/**
 * La marca — P14.
 *
 * ============================================================================
 * LOS DOS DIBUJOS SALEN DEL MANUAL, NO DE UNA INTERPRETACIÓN DEL MANUAL
 * ============================================================================
 *
 * `public/marca/isotipo.svg` y `public/marca/logotipo.svg` se extrajeron de las
 * curvas de Bézier del propio PDF (`docs/Manual de Marca/`, pp. 13-16), que está
 * exportado desde Chromium y lleva la geometría como operadores de trazado. No
 * son un redibujo: son los mismos puntos, el mismo grosor (11,803) y los mismos
 * remates redondos que el manual publica en su tabla de construcción.
 *
 * La comprobación de que la extracción es correcta es que la geometría
 * reproduce las fórmulas del manual sin que se le impusieran:
 *
 *   - la caja del isotipo mide 61,803 × 100, o sea W = H / φ;
 *   - el trazo mide 11,803, que es t = R − R/φ;
 *   - la panza es una elipse de rx 26,75 y ry 25, con rx = ry × 1,07;
 *   - el arco recorre 180° y su rotura cae en −21,25°, que es −90 + 180/φ².
 *
 * ============================================================================
 * CUÁL SE USA DÓNDE · manual p. 16
 * ============================================================================
 *
 * «El logotipo presenta la marca. El isotipo la recuerda.» Por eso el logotipo
 * está en la pantalla de entrar —donde la marca se presenta— y el isotipo en la
 * barra de las pantallas de trabajo, donde solo hace falta recordarla.
 *
 * Los mínimos del manual —140 px de ancho el logotipo, 16 px el isotipo— son
 * tokens (`--logotipo-min`, `--isotipo-min`) y los hace cumplir el CSS.
 *
 * **Se sirven como `<img>` y no en línea** para que el navegador los cachee una
 * vez y no viajen dentro del HTML de cada pantalla. El logotipo pesa 9,9 kB.
 */

import type { ReactNode } from 'react';

import { TEXTOS } from '../../textos/es';

/**
 * El isotipo es DECORATIVO cuando acompaña al nombre escrito al lado: quien usa
 * un lector de pantalla ya oye «Platise» del texto, y repetirlo desde el
 * `alt` de la imagen lo diría dos veces.
 */
export function Isotipo(): ReactNode {
  return <img src="/marca/isotipo.svg" alt="" aria-hidden="true" className="marca marca--isotipo" />;
}

/** El logotipo SÍ lleva texto alternativo: cuando aparece, es la marca entera. */
export function Logotipo(): ReactNode {
  return <img src="/marca/logotipo.svg" alt={TEXTOS.producto} className="marca marca--logotipo" />;
}
