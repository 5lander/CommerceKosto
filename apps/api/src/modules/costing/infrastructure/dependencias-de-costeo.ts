/**
 * El objeto de parametros de `costing`, inyectado por propiedad.
 *
 * Mismo patron y misma razon que en `iam`, `catalog`, `pricing` y `recipes`:
 * `application` no puede importar NestJS, asi que los casos de uso no llevan
 * decorador y el modulo los construye con `useFactory`.
 *
 * LOS CUATRO SON PUERTOS DE OTROS MODULOS. `costing` no tiene repositorio
 * propio y no toca ninguna tabla: el motor es dominio puro y lo que necesita se
 * lo dan `recipes`, `pricing` y `catalog` por sus casos de uso exportados. Es
 * lo que hace que el diff de este paquete no incluya un solo `tx.`.
 */

import { Inject, Injectable } from '@nestjs/common';

import { ListarItems } from '../../catalog/application/casos-de-uso/items';
import { LeerAjustes } from '../../pricing/application/casos-de-uso/ajustes';
import { CostosDeItems } from '../../pricing/application/casos-de-uso/costos-de-items';
import { LeerCarta } from '../../recipes/application/casos-de-uso/carta';

@Injectable()
export class DependenciasDeCosteoNest {
  @Inject(LeerCarta)
  public readonly leerCarta!: LeerCarta;

  @Inject(CostosDeItems)
  public readonly costosDeItems!: CostosDeItems;

  @Inject(ListarItems)
  public readonly listarItems!: ListarItems;

  @Inject(LeerAjustes)
  public readonly leerAjustes!: LeerAjustes;
}
