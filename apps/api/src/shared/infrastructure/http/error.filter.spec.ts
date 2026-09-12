/**
 * Lo que se prueba aqui es la frase de CLAUDE.md §3 hecha comportamiento: "el
 * mensaje al usuario y el detalle del log son cosas distintas".
 *
 * Se prueba la funcion pura `errorResponseFor` y no el filtro entero: el caso
 * que mas importa —un 5xx inesperado— no se puede provocar por HTTP sin
 * escribir un endpoint que solo exista para romperse, y probarlo a traves del
 * filtro exigiria dobles de `ArgumentsHost` y `ServerResponse` que solo se
 * pueden construir con `as unknown as`.
 */

import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { PeriodoSinDatosError } from '../../../modules/analytics/domain/errores';
import { TokenDeRestablecimientoInvalidoError } from '../../../modules/iam/domain/errores';
import { ValorDecimalInvalidoError } from '../../domain/decimal/nucleo';
import { IdentificadorInvalidoError } from '../../domain/identity/identificadores';
import { UnidadDeUsoInvalidaError } from '../../domain/unidad/unidad-de-uso';
import { LimiteDeSolicitudesError } from '../../domain/limite-de-tasa/politicas';
import { CsrfInvalidoError } from '../../domain/errors/csrf-invalido';
import { diagnosticoDe, errorResponseFor } from './error.filter';

describe('errorResponseFor', () => {
  it('responde siempre con la forma { code, message } y nada mas', () => {
    const { body } = errorResponseFor(new NotFoundException('El item no existe'));

    expect(Object.keys(body).sort()).toEqual(['code', 'message']);
  });

  describe('errores 4xx — el mensaje SI sale', () => {
    it('conserva el texto, que es lo que el llamante necesita para corregir su peticion', () => {
      const { status, body } = errorResponseFor(new NotFoundException('El item no existe'));

      expect(status).toBe(HttpStatus.NOT_FOUND);
      expect(body).toEqual({ code: 'NOT_FOUND', message: 'El item no existe' });
    });

    it('junta los mensajes cuando vienen en lista (validacion)', () => {
      const { body } = errorResponseFor(
        new HttpException({ message: ['name es obligatorio', 'unit no existe'] }, HttpStatus.BAD_REQUEST),
      );

      expect(body).toEqual({ code: 'BAD_REQUEST', message: 'name es obligatorio; unit no existe' });
    });

    it('un estado 4xx fuera del catalogo no rompe: sale como INTERNAL_ERROR', () => {
      const { status, body } = errorResponseFor(new HttpException('raro', HttpStatus.I_AM_A_TEAPOT));

      expect(status).toBe(HttpStatus.I_AM_A_TEAPOT);
      expect(body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('errores 5xx — el mensaje NO sale', () => {
    const FILTRACION = 'connect ECONNREFUSED costeo_app@10.0.3.14:5432 en tabla recipe_line';

    it('un fallo inesperado no revela nada de su causa', () => {
      // Rutas, nombres de tabla, host y puerto de la base: reconocimiento
      // gratis para quien esta sondeando.
      const { status, body } = errorResponseFor(new Error(FILTRACION));

      expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(body.code).toBe('INTERNAL_ERROR');
      expect(body.message).not.toContain('ECONNREFUSED');
      expect(body.message).not.toContain('recipe_line');
      expect(body.message).not.toContain('5432');
    });

    it('tampoco lo revela una HttpException de 500 construida a mano', () => {
      // El caso que se escapa si el filtro solo mira si es una HttpException.
      const { body } = errorResponseFor(new HttpException(FILTRACION, HttpStatus.INTERNAL_SERVER_ERROR));

      expect(body.code).toBe('INTERNAL_ERROR');
      expect(body.message).not.toContain('recipe_line');
    });

    it('remite a la cabecera de correlacion, que es como se llega al detalle', () => {
      expect(errorResponseFor(new Error(FILTRACION)).body.message).toContain('x-correlation-id');
    });
  });

  it('lo que no es un Error tampoco lo tumba', () => {
    const { status, body, cabeceras } = errorResponseFor('una cadena lanzada desde una libreria');

    expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(cabeceras).toEqual({});
  });

  describe('el limite de tasa (D-16.24)', () => {
    const AHORA = new Date('2026-09-10T12:00:00.000Z');

    it('LIMITE_DE_SOLICITUDES es 429 con Retry-After en segundos, y el mensaje dice el minuto', () => {
      const error = new LimiteDeSolicitudesError({
        kind: 'password.olvido',
        bloqueadoHasta: new Date(AHORA.getTime() + 90_000),
        ahora: AHORA,
      });

      const { status, body, cabeceras } = errorResponseFor(error);

      expect(status).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(body).toEqual({
        code: 'LIMITE_DE_SOLICITUDES',
        message: 'Demasiadas solicitudes. Vuelve a intentarlo en 2 minutos.',
      });
      expect(cabeceras).toEqual({ 'Retry-After': '90' });
    });

    it('un error de dominio sin espera no lleva la cabecera', () => {
      const { cabeceras } = errorResponseFor(new TokenDeRestablecimientoInvalidoError());

      expect(cabeceras).toEqual({});
    });
  });
});

describe('el token anti-CSRF (ADR-021)', () => {
  it('sale como 403 con su propio code, distinguible de PERMISO_DENEGADO', () => {
    const { status, body, cabeceras } = errorResponseFor(new CsrfInvalidoError('ausente'));

    expect(status).toBe(HttpStatus.FORBIDDEN);
    expect(body.code).toBe('CSRF_INVALIDO');
    expect(cabeceras).toEqual({});
  });

  it('el motivo NO sale al cliente: solo el texto accionable', () => {
    const { body } = errorResponseFor(new CsrfInvalidoError('no_coincide'));

    expect(body.message).not.toContain('no_coincide');
    expect(body.message).toContain('Recarga');
  });
});

/**
 * Los tres bordes que hasta P16-A2 salian como 500 (INC-012).
 *
 * Se prueban AQUI, en la funcion pura, ademas de por HTTP: lo que se comprueba
 * es que las tres clases son `ErrorDeDominio` y no `Error` a secas —que es lo
 * unico que decide si el filtro las traduce o las esconde—, y eso no depende de
 * ninguna ruta. La prueba por HTTP vive en `test/integracion/frontera-http.spec.ts`.
 */
describe('los tres errores de borde que eran 500 (P16-A2, INC-012)', () => {
  it('un identificador mal formado es 400 y el mensaje dice que se esperaba un UUID', () => {
    const { status, body } = errorResponseFor(new IdentificadorInvalidoError('ItemId', 'no-soy-uuid'));

    expect(status).toBe(HttpStatus.BAD_REQUEST);
    expect(body.code).toBe('ENTRADA_INVALIDA');
    expect(body.message).toContain('no-soy-uuid');
    expect(body.message).toContain('UUID');
  });

  it('una unidad de uso mal escrita es 400 y el mensaje trae ejemplos', () => {
    const { status, body } = errorResponseFor(new UnidadDeUsoInvalidaError('KG'));

    expect(status).toBe(HttpStatus.BAD_REQUEST);
    expect(body.code).toBe('ENTRADA_INVALIDA');
    expect(body.message).toContain('"kg"');
  });

  it('un decimal mal formado es 400 y NO revela el metodo interno que lo lanzo', () => {
    const error = new ValorDecimalInvalidoError('1,5', 'motivo cualquiera', 'Money.fromDecimalString');
    const { status, body } = errorResponseFor(error);

    expect(status).toBe(HttpStatus.BAD_REQUEST);
    expect(body.code).toBe('ENTRADA_INVALIDA');
    expect(body.message).not.toContain('Money.fromDecimalString');
    expect(error.detalle).toEqual({ contexto: 'Money.fromDecimalString' });
  });

  it('el valor citado sale recortado y sin caracteres de control', () => {
    const salto = String.fromCharCode(10);
    const { body } = errorResponseFor(
      new IdentificadorInvalidoError('ItemId', `a${salto}${'b'.repeat(200)}`),
    );

    expect(body.message).not.toContain(salto);
    expect(body.message.length).toBeLessThan(200);
  });
});

/**
 * El segundo 404 (D-16.2). El contrato es el `code`, no el estado: los dos
 * salen como 404 y la pantalla los separa por ahi.
 */
describe('un mes sin abrir (D-16.2)', () => {
  it('PERIODO_SIN_DATOS es 404 con code propio, no RECURSO_NO_ENCONTRADO', () => {
    const { status, body } = errorResponseFor(new PeriodoSinDatosError('2026-3'));

    expect(status).toBe(HttpStatus.NOT_FOUND);
    expect(body.code).toBe('PERIODO_SIN_DATOS');
    expect(body.message).toContain('mes sin abrir');
  });
});

/**
 * LA REVISION DE P16-A2: `detalle` no lo leia nadie.
 *
 * La cabecera de `error-de-dominio.ts` prometia desde P0 que el contexto
 * interno «viaja al log», y el filtro solo escribia la traza de los 5xx. Al
 * pasar tres errores de borde de 500 a 400, ese contexto dejo de aparecer en
 * ninguna parte. Ahora existe `diagnosticoDe`, y esto es lo que clava que
 * exista: que lleva el `code` y el `detalle`, y que lo limpia.
 */
describe('diagnosticoDe — lo que el cliente no ve y el log si', () => {
  it('lleva el codigo y el detalle que el mensaje publico se calla', () => {
    const error = new ValorDecimalInvalidoError('1,5', 'motivo cualquiera', 'Money.fromDecimalString');

    const linea = diagnosticoDe(error);

    expect(linea).toContain('ENTRADA_INVALIDA');
    expect(linea).toContain('contexto=Money.fromDecimalString');
    // Y sigue sin salir por la respuesta, que es la otra mitad de la regla.
    expect(errorResponseFor(error).body.message).not.toContain('Money.fromDecimalString');
  });

  it('un error sin detalle sale con su codigo a secas, no con un igual suelto', () => {
    expect(diagnosticoDe(new CsrfInvalidoError('ausente'))).toContain('CSRF_INVALIDO');
    expect(diagnosticoDe(new UnidadDeUsoInvalidaError('KG'))).toBe('ENTRADA_INVALIDA');
  });

  it('limpia el detalle: un salto de linea no parte la linea del log en dos', () => {
    const salto = String.fromCharCode(10);
    const error = new PeriodoSinDatosError(`2026-3${salto}fila inventada`);

    expect(diagnosticoDe(error)).not.toContain(salto);
  });
});
