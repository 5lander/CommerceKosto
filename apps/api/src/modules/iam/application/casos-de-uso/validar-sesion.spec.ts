/**
 * P15 — la ubicacion ajena no pasa, ni siquiera para un OWNER.
 *
 * EL AGUJERO QUE ESTO CIERRA. `exigirUbicacionEnAlcance` salia temprano cuando
 * el alcance era de company: «un OWNER puede con todas», y no se comprobaba
 * nada mas. La consecuencia era que un `locationId` de OTRA company atravesaba
 * la funcion entera y `GET /costeo?locationId=<ajena>` respondia **200**.
 *
 * NO HABIA FUGA —RLS filtra, y lo devuelto eran los productos del propio
 * usuario— pero salian todos con `activo: false` y coste cero. Para un producto
 * cuyo valor entero es que el numero sea correcto, eso es peor que un error:
 * quien se equivoca de identificador lee «todos mis platos cuestan cero» y se lo
 * cree. Ademas incumple CLAUDE.md 4.4, que exige validar la pertenencia en todo
 * acceso por ID.
 *
 * Lo encontro el pentest de P15, no una revision de codigo.
 *
 * Sin base de datos: es una funcion pura sobre el contexto de sesion.
 */

import { describe, expect, it } from 'vitest';

import type {
  CompanyId,
  LocationId,
  SessionId,
  UserId,
} from '../../../../shared/domain/identity/identificadores';
import { UbicacionFueraDeAlcanceError } from '../../domain/errores';
import type { AlcanceDeUsuario } from '../ports/repositorio-de-autenticacion.port';
import { exigirUbicacionEnAlcance, type SesionActiva } from './validar-sesion';

const MIA = '11111111-1111-4111-8111-111111111111' as LocationId;
const OTRA_MIA = '22222222-2222-4222-8222-222222222222' as LocationId;
const AJENA = '99999999-9999-4999-8999-999999999999' as LocationId;

function sesion(alcance: AlcanceDeUsuario): SesionActiva {
  return {
    sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as SessionId,
    userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as UserId,
    companyId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' as CompanyId,
    permisos: [],
    alcance,
    ubicacionesDeCompany: [MIA, OTRA_MIA],
    csrfToken: 'no-lo-mira-esta-prueba',
  };
}

const DUENO = sesion({ clase: 'company' });
const GERENTE = sesion({ clase: 'ubicaciones', ids: [MIA] });

describe('exigirUbicacionEnAlcance', () => {
  it('un OWNER pasa por cualquier ubicacion DE SU company', () => {
    expect(() => {
      exigirUbicacionEnAlcance(DUENO, MIA);
    }).not.toThrow();
    expect(() => {
      exigirUbicacionEnAlcance(DUENO, OTRA_MIA);
    }).not.toThrow();
  });

  it('un OWNER NO pasa por una ubicacion de otra company', () => {
    // El caso que respondia 200. Es la razon de ser de esta prueba.
    expect(() => {
      exigirUbicacionEnAlcance(DUENO, AJENA);
    }).toThrow(UbicacionFueraDeAlcanceError);
  });

  it('un gerente pasa por la suya', () => {
    expect(() => {
      exigirUbicacionEnAlcance(GERENTE, MIA);
    }).not.toThrow();
  });

  it('un gerente no pasa por otra ubicacion de su propia company', () => {
    expect(() => {
      exigirUbicacionEnAlcance(GERENTE, OTRA_MIA);
    }).toThrow(UbicacionFueraDeAlcanceError);
  });

  it('un gerente tampoco pasa por una ubicacion ajena', () => {
    expect(() => {
      exigirUbicacionEnAlcance(GERENTE, AJENA);
    }).toThrow(UbicacionFueraDeAlcanceError);
  });

  it('una company sin ubicaciones no deja pasar nada', () => {
    // El caso degenerado: `[]` significa vacio, no «todas». Es la misma
    // convencion que el puerto exige para `alcance`, y por el mismo motivo.
    const recien = { ...DUENO, ubicacionesDeCompany: [] as readonly LocationId[] };

    expect(() => {
      exigirUbicacionEnAlcance(recien, MIA);
    }).toThrow(UbicacionFueraDeAlcanceError);
  });
});
