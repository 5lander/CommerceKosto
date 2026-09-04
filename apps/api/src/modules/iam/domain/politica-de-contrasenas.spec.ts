import { describe, expect, it } from 'vitest';

import {
  LARGO_MAXIMO,
  LARGO_MINIMO,
  mensajeDelProblema,
  problemaDeContrasena,
} from './politica-de-contrasenas';

const CORREO = 'ana.perez@snacklab.ec';

function problema(contrasena: string, correo = CORREO): ReturnType<typeof problemaDeContrasena> {
  return problemaDeContrasena({ contrasena, correo });
}

describe('politica de contrasenas', () => {
  it('acepta una frase larga sin simbolos ni mayusculas', () => {
    // Es el caso que las reglas de composicion rechazarian y que en realidad es
    // de las mas fuertes que un humano recuerda.
    expect(problema('tres cebollas moradas en la nevera')).toBeNull();
  });

  it('rechaza por corta con el minimo dentro del problema', () => {
    expect(problema('corta123')).toEqual({ clase: 'corta', minimo: LARGO_MINIMO });
  });

  it('rechaza por larga: hashear un megabyte es una denegacion de servicio', () => {
    expect(problema('a'.repeat(LARGO_MAXIMO + 1))).toEqual({ clase: 'larga', maximo: LARGO_MAXIMO });
  });

  it('acepta exactamente el largo maximo: el borde no se regala por el otro lado', () => {
    expect(problema(`x${'a'.repeat(LARGO_MAXIMO - 1)}`)).toBeNull();
  });

  describe('lista de filtradas', () => {
    it('rechaza una del diccionario aunque llegue al largo minimo', () => {
      expect(problema('administrador')).toEqual({ clase: 'filtrada' });
    });

    it('la comparacion es insensible a mayusculas y a espacios de los bordes', () => {
      expect(problema('  ADMINISTRADOR  ')).toEqual({ clase: 'filtrada' });
    });

    it('CAZA LA COLA: es lo que la gente escribe cuando le exigen doce caracteres', () => {
      // Sin quitar la cola, la lista seria decorativa: "restaurante" tiene once
      // caracteres y el largo fallaria antes de llegar a consultarla.
      expect(problema('restaurante2026')).toEqual({ clase: 'filtrada' });
      expect(problema('guayaquil123456')).toEqual({ clase: 'filtrada' });
      expect(problema('administrador!!')).toEqual({ clase: 'filtrada' });
    });

    it('una frase que EMPIEZA como una entrada de la lista si pasa', () => {
      // Quitar la cola solo aplica a lo NO alfabetico: "restaurante de barrio"
      // no se reduce a "restaurante".
      expect(problema('restaurante de barrio')).toBeNull();
    });
  });

  describe('el correo dentro de la contrasena', () => {
    it('se rechaza: es el primer candidato de un ataque dirigido', () => {
      expect(problema('ana.perez del 2026')).toEqual({ clase: 'contiene_el_correo' });
    });

    it('no se rechaza por una parte local demasiado corta', () => {
      // Con `ab@x.com`, exigir que la contrasena no contenga "ab" rechazaria
      // cualquier frase con la palabra "abajo" dentro. La regla se aplica solo
      // cuando la coincidencia significa algo.
      expect(problema('cabalgata de abanicos', 'ab@x.com')).toBeNull();
    });
  });

  it('todo problema tiene mensaje, y el mensaje dice que hacer', () => {
    const corta = problema('corta');

    if (corta === null) {
      throw new Error('"corta" deberia ser rechazada por largo');
    }
    expect(mensajeDelProblema(corta)).toContain(String(LARGO_MINIMO));
  });
});
