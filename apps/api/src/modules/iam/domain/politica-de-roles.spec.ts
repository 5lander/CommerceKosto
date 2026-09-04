import { describe, expect, it } from 'vitest';

import {
  mensajeDelProblemaDeRol,
  problemaDeAsignacion,
  problemaDeRevocacion,
  type Actor,
  type ProblemaDeRol,
} from './politica-de-roles';

const ADMIN = 'usuario-admin';
const OTRO = 'usuario-objetivo';

function actor(cambios: Partial<Actor> = {}): Actor {
  return { userId: ADMIN, objetivoUserId: OTRO, objetivoEsOwner: false, ...cambios };
}

function asignar(rol: string, tieneUbicacion: boolean, cambios: Partial<Actor> = {}) {
  return problemaDeAsignacion({ asignacion: { rol, tieneUbicacion }, actor: actor(cambios) });
}

describe('politica de roles', () => {
  describe('asignaciones legitimas', () => {
    it('ADMIN sin ubicacion', () => {
      expect(asignar('ADMIN', false)).toBeNull();
    });

    it('GERENTE_LOCAL con ubicacion', () => {
      expect(asignar('GERENTE_LOCAL', true)).toBeNull();
    });

    it('BODEGA con ubicacion', () => {
      expect(asignar('BODEGA', true)).toBeNull();
    });
  });

  describe('la ubicacion no es opcional ni sobra', () => {
    it('GERENTE_LOCAL sin ubicacion se rechaza', () => {
      expect(asignar('GERENTE_LOCAL', false)).toEqual({ clase: 'falta_ubicacion', rol: 'GERENTE_LOCAL' });
    });

    it('ADMIN con ubicacion se rechaza', () => {
      expect(asignar('ADMIN', true)).toEqual({ clase: 'sobra_ubicacion', rol: 'ADMIN' });
    });
  });

  it('un rol inventado se rechaza antes que nada', () => {
    expect(asignar('SUPERADMIN', false)).toEqual({ clase: 'rol_desconocido', rol: 'SUPERADMIN' });
  });

  it('OWNER no se asigna por esta via', () => {
    expect(asignar('OWNER', false)).toEqual({ clase: 'owner_no_se_asigna' });
  });

  describe('las dos reglas que la base no puede expresar', () => {
    it('nadie modifica sus propios roles', () => {
      expect(asignar('ADMIN', false, { objetivoUserId: ADMIN })).toEqual({ clase: 'no_sobre_uno_mismo' });
    });

    it('un ADMIN no toca al OWNER: podria quedarse con la company', () => {
      expect(asignar('ADMIN', false, { objetivoEsOwner: true })).toEqual({ clase: 'owner_no_se_toca' });
    });

    it('esas dos ganan incluso a un rol invalido: el objetivo se mira primero', () => {
      expect(asignar('NO_EXISTE', false, { objetivoEsOwner: true })).toEqual({ clase: 'owner_no_se_toca' });
    });

    it('valen igual al revocar', () => {
      expect(problemaDeRevocacion(actor({ objetivoEsOwner: true }))).toEqual({ clase: 'owner_no_se_toca' });
      expect(problemaDeRevocacion(actor({ objetivoUserId: ADMIN }))).toEqual({ clase: 'no_sobre_uno_mismo' });
      expect(problemaDeRevocacion(actor())).toBeNull();
    });
  });

  it('todo problema tiene mensaje', () => {
    const clases: ProblemaDeRol['clase'][] = [
      'rol_desconocido',
      'falta_ubicacion',
      'sobra_ubicacion',
      'owner_no_se_asigna',
      'owner_no_se_toca',
      'no_sobre_uno_mismo',
    ];

    for (const clase of clases) {
      const problema =
        clase === 'rol_desconocido' || clase === 'falta_ubicacion' || clase === 'sobra_ubicacion'
          ? ({ clase, rol: 'X' } as ProblemaDeRol)
          : ({ clase } as ProblemaDeRol);

      expect(mensajeDelProblemaDeRol(problema).length).toBeGreaterThan(0);
    }
  });
});
