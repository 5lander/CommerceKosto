/**
 * El conteo físico — SPEC §3, D6 y D7.
 *
 * **DOS CONTROLADORES, Y LA LÍNEA QUE LOS SEPARA ES CLAUDE.md §4.3.**
 * `ConteosController` es lo que `BODEGA` usa: crear la hoja, anotarla,
 * confirmarla y cerrar el mes. `ConciliacionController` devuelve el stock
 * teórico, la diferencia y su valorización, exige `count.read`, y `BODEGA` no
 * lo tiene.
 *
 *     stock teórico → diferencia → consumo → cantidad de la receta
 *
 * **NINGUNA RESPUESTA DE ESTE ARCHIVO LLEVA STOCK TEÓRICO**, ni la hoja, ni la
 * lista, ni lo que devuelve confirmar. Y no se filtra al final: se construye
 * desde otra consulta, con otro tipo, en otro caso de uso — que es lo que §4.3
 * pide cuando dice «proyecciones distintas por rol, no un filtro sobre una
 * respuesta completa».
 *
 * **EL CIERRE DEL MES VIVE AQUÍ Y NO EN `/periodos`** porque D6 lo describe
 * como un paso del conteo: «se cierra manualmente al cargar el conteo físico».
 * Pide `count.write` **y** `period.close`: quien cuenta no sella el mes.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';

import {
  itemId as aItemId,
  locationId as aLocationId,
  physicalCountId as aPhysicalCountId,
} from '../../../../shared/domain/identity/identificadores';
import { Requiere } from '../../../../shared/infrastructure/http/autorizacion';
import { EsquemaPipe } from '../../../../shared/infrastructure/http/esquema.pipe';
import { IdentificadorDeRuta } from '../../../../shared/infrastructure/http/identificador-de-ruta.pipe';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import { SesionActual } from '../../../iam/infrastructure/http/decoradores';
import {
  CerrarPeriodoDelConteo,
  ConfirmarConteo,
  CrearConteo,
  GuardarLineasDeConteo,
  LeerConciliacion,
  LeerHojaDeConteo,
  ListarConteos,
} from '../../application/casos-de-uso/conteos';
import {
  CONSULTA_DE_CONTEOS,
  CUERPO_DE_CONTEO,
  CUERPO_DE_LINEAS,
  type ConciliacionDto,
  type ConsultaDeConteos,
  type ConteoBasicoDto,
  type CuerpoDeConteo,
  type CuerpoDeLineas,
  type HojaDeConteoDto,
  type RegistroDeConteoDto,
} from './conteos.dto';
import { comoConciliacionDto, comoConteoBasicoDto, comoHojaDto } from './presentacion-de-conteos';

/** Las cuatro escrituras del conteo, en un solo objeto inyectable. */
export interface PiezasDeEscritura {
  readonly crear: CrearConteo;
  readonly lineas: GuardarLineasDeConteo;
  readonly confirmar: ConfirmarConteo;
  readonly cierre: CerrarPeriodoDelConteo;
}

export class EscriturasDeConteo {
  public readonly crear: CrearConteo;
  public readonly lineas: GuardarLineasDeConteo;
  public readonly confirmar: ConfirmarConteo;
  public readonly cierre: CerrarPeriodoDelConteo;

  public constructor(piezas: PiezasDeEscritura) {
    this.crear = piezas.crear;
    this.lineas = piezas.lineas;
    this.confirmar = piezas.confirmar;
    this.cierre = piezas.cierre;
  }
}

export class LecturasDeConteo {
  public constructor(
    public readonly listar: ListarConteos,
    public readonly hoja: LeerHojaDeConteo,
  ) {}
}

@Controller('conteos')
export class ConteosController {
  public constructor(
    private readonly escrituras: EscriturasDeConteo,
    private readonly lecturas: LecturasDeConteo,
  ) {}

  /** Abre la hoja de un mes. El corte es el fin de ese mes, no el día de hoy. */
  @Post()
  @Requiere('count.write')
  public async crear(
    @SesionActual() sesion: SesionActiva,
    @Body(new EsquemaPipe(CUERPO_DE_CONTEO)) cuerpo: CuerpoDeConteo,
  ): Promise<RegistroDeConteoDto> {
    const id = await this.escrituras.crear.ejecutar(sesion, {
      locationId: aLocationId(cuerpo.locationId),
      anio: cuerpo.anio,
      mes: cuerpo.mes,
      note: cuerpo.note,
    });
    return { id };
  }

  @Get()
  @Requiere('count.write')
  public async listar(
    @SesionActual() sesion: SesionActiva,
    @Query(new EsquemaPipe(CONSULTA_DE_CONTEOS)) consulta: ConsultaDeConteos,
  ): Promise<readonly ConteoBasicoDto[]> {
    const conteos = await this.lecturas.listar.ejecutar(sesion, {
      locationId: aLocationId(consulta.locationId),
    });
    return conteos.map(comoConteoBasicoDto);
  }

  /**
   * La hoja para contar: los ítems almacenables y lo que se lleva anotado.
   *
   * **A CIEGAS.** Sin stock teórico, sin diferencia, sin semáforo. Y con TODOS
   * los ítems, tengan saldo o no: si trajera solo los que el libro conoce, la
   * presencia de una fila ya diría algo del inventario.
   */
  @Get(':countId/hoja')
  @Requiere('count.write')
  public async hoja(
    @SesionActual() sesion: SesionActiva,
    @Param('countId', IdentificadorDeRuta) countId: string,
  ): Promise<HojaDeConteoDto> {
    const hoja = await this.lecturas.hoja.ejecutar(sesion, {
      countId: aPhysicalCountId(countId),
    });
    return comoHojaDto(hoja);
  }

  /**
   * Reescribe la hoja entera.
   *
   * Es un `PUT` y no un `PATCH` porque la pantalla es una grilla: lo que el
   * usuario ve al guardar es exactamente lo que queda. Un ítem que desaparece
   * de la lista deja de estar contado, que es lo que significa borrar su
   * anotación.
   */
  @Put(':countId/lineas')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Requiere('count.write')
  public async guardarLineas(
    @SesionActual() sesion: SesionActiva,
    @Param('countId', IdentificadorDeRuta) countId: string,
    @Body(new EsquemaPipe(CUERPO_DE_LINEAS)) cuerpo: CuerpoDeLineas,
  ): Promise<void> {
    await this.escrituras.lineas.ejecutar(sesion, {
      countId: aPhysicalCountId(countId),
      lineas: cuerpo.lineas.map((linea) => ({
        itemId: aItemId(linea.itemId),
        cantidad: linea.cantidad,
      })),
    });
  }

  /**
   * Congela el conteo. **Devuelve 204 y nada más**: la conciliación que acaba
   * de calcularse no viaja de vuelta, porque quien confirma puede ser `BODEGA`.
   */
  @Post(':countId/confirmacion')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Requiere('count.write')
  public async confirmar(
    @SesionActual() sesion: SesionActiva,
    @Param('countId', IdentificadorDeRuta) countId: string,
  ): Promise<void> {
    await this.escrituras.confirmar.ejecutar(sesion, { countId: aPhysicalCountId(countId) });
  }

  /** Cierra el mes de la ubicación del conteo. Los dos permisos, no uno. */
  @Post(':countId/cierre-de-periodo')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Requiere('count.write', 'period.close')
  public async cerrarPeriodo(
    @SesionActual() sesion: SesionActiva,
    @Param('countId', IdentificadorDeRuta) countId: string,
  ): Promise<void> {
    await this.escrituras.cierre.ejecutar(sesion, { countId: aPhysicalCountId(countId) });
  }
}

/**
 * La conciliación: teórico, diferencia y valorización.
 *
 * Controlador aparte **porque el permiso es otro**, no por orden. `BODEGA`
 * recibe 403 aquí, y hay una prueba que lo comprueba por endpoint.
 */
@Controller('conteos')
export class ConciliacionController {
  public constructor(private readonly conciliacion: LeerConciliacion) {}

  @Get(':countId')
  @Requiere('count.read')
  public async leer(
    @SesionActual() sesion: SesionActiva,
    @Param('countId', IdentificadorDeRuta) countId: string,
  ): Promise<ConciliacionDto> {
    const resultado = await this.conciliacion.ejecutar(sesion, {
      countId: aPhysicalCountId(countId),
    });
    return comoConciliacionDto(resultado);
  }
}
