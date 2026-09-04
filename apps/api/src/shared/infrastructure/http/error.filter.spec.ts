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

import { errorResponseFor } from './error.filter';

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
    const { status, body } = errorResponseFor('una cadena lanzada desde una libreria');

    expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body.code).toBe('INTERNAL_ERROR');
  });
});
