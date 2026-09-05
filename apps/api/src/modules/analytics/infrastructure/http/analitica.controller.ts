/**
 * Las seis vistas y las dos cargas — SPEC §15 a §18.
 *
 * **TRES CONTROLADORES, Y LA LÍNEA QUE LOS SEPARA ES CLAUDE.md §4.3.**
 *
 * | | |
 * |---|---|
 * | `CargaController` | Lo que se teclea cada mes: ventas y costos fijos |
 * | `AnaliticaController` | Las cinco vistas. **`BODEGA` recibe 403 en todas** |
 * | `ReposicionController` | El semáforo `REPONER`/`OK`, **sin la cantidad** |
 *
 * Las cinco vistas llevan consumo teórico, stock teórico, diferencias y costos:
 * cuatro de los seis datos prohibidos para `BODEGA`. Lo único que le
 * corresponde es el semáforo, y SPEC §4 lo dice con estas palabras: «para
 * reposición, BODEGA recibe un semáforo (`REPONER` / `OK`) **sin la cantidad
 * que lo origina**».
 *
 * **EL SEMÁFORO SE SIRVE DESDE OTRO CASO DE USO Y CON OTRO TIPO**, no filtrando
 * la vista de inventario. Un campo que se calcula y luego se quita ya viajó por
 * el cable alguna vez, y basta con que alguien retire el filtro para publicarlo.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';

import { locationId as aLocationId, productId as aProductId } from '../../../../shared/domain/identity/identificadores';
import { Requiere } from '../../../../shared/infrastructure/http/autorizacion';
import { EsquemaPipe } from '../../../../shared/infrastructure/http/esquema.pipe';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import { SesionActual } from '../../../iam/infrastructure/http/decoradores';
import {
  comoCosto,
  comoVenta,
  ConsultarCostosFijos,
  ConsultarVentas,
  RegistrarCostosFijos,
  RegistrarVentas,
} from '../../application/casos-de-uso/carga';
import {
  ConsultarFoodCostReal,
  ConsultarInventarioValorizado,
  ConsultarMenuEngineering,
  ConsultarPuntoDeEquilibrio,
  ConsultarReposicion,
  ConsultarResumen,
} from '../../application/casos-de-uso/vistas';
import {
  CONSULTA_DEL_MES,
  CUERPO_DE_COSTOS,
  CUERPO_DE_VENTAS,
  type ConsultaDelMes,
  type CostoDto,
  type CuerpoDeCostos,
  type CuerpoDeVentas,
  type FilaDeReposicionDto,
  type FoodCostRealDto,
  type InventarioDto,
  type MenuDto,
  type PuntoDeEquilibrioDto,
  type ResumenDto,
  type VentaDto,
} from './analitica.dto';
import {
  comoEquilibrioDto,
  comoFoodCostDto,
  comoInventarioDto,
  comoMenuDto,
  comoReposicionDto,
  comoResumenDto,
} from './presentacion';

/** Las dos cargas del mes, agrupadas para no pasar de tres parámetros. */
export class CargasDelMes {
  public readonly ventas: RegistrarVentas;
  public readonly costos: RegistrarCostosFijos;
  public readonly leerVentas: ConsultarVentas;
  public readonly leerCostos: ConsultarCostosFijos;

  public constructor(piezas: {
    readonly ventas: RegistrarVentas;
    readonly costos: RegistrarCostosFijos;
    readonly leerVentas: ConsultarVentas;
    readonly leerCostos: ConsultarCostosFijos;
  }) {
    this.ventas = piezas.ventas;
    this.costos = piezas.costos;
    this.leerVentas = piezas.leerVentas;
    this.leerCostos = piezas.leerCostos;
  }
}

/** Las cinco vistas, agrupadas por lo mismo. */
export class VistasDelMes {
  public readonly menu: ConsultarMenuEngineering;
  public readonly foodCost: ConsultarFoodCostReal;
  public readonly equilibrio: ConsultarPuntoDeEquilibrio;
  public readonly inventario: ConsultarInventarioValorizado;
  public readonly resumen: ConsultarResumen;

  public constructor(piezas: {
    readonly menu: ConsultarMenuEngineering;
    readonly foodCost: ConsultarFoodCostReal;
    readonly equilibrio: ConsultarPuntoDeEquilibrio;
    readonly inventario: ConsultarInventarioValorizado;
    readonly resumen: ConsultarResumen;
  }) {
    this.menu = piezas.menu;
    this.foodCost = piezas.foodCost;
    this.equilibrio = piezas.equilibrio;
    this.inventario = piezas.inventario;
    this.resumen = piezas.resumen;
  }
}

@Controller('analitica')
export class CargaController {
  public constructor(private readonly cargas: CargasDelMes) {}

  /**
   * Las unidades vendidas del mes, **en lote**.
   *
   * Es lo que hace posible la grilla de CLAUDE.md §10: «una grilla editable con
   * el período anterior precargado, no un formulario por producto». Reemplaza
   * la carga entera del mes.
   */
  @Post('ventas')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Requiere('sales.write')
  public async registrarVentas(
    @SesionActual() sesion: SesionActiva,
    @Body(new EsquemaPipe(CUERPO_DE_VENTAS)) cuerpo: CuerpoDeVentas,
  ): Promise<void> {
    await this.cargas.ventas.ejecutar(sesion, {
      locationId: aLocationId(cuerpo.locationId),
      anio: cuerpo.anio,
      mes: cuerpo.mes,
      ventas: cuerpo.ventas.map((venta) =>
        comoVenta({ productId: aProductId(venta.productId), unidades: venta.unidades }),
      ),
    });
  }

  @Get('ventas')
  @Requiere('sales.read')
  public async ventas(
    @SesionActual() sesion: SesionActiva,
    @Query(new EsquemaPipe(CONSULTA_DEL_MES)) consulta: ConsultaDelMes,
  ): Promise<readonly VentaDto[]> {
    const ventas = await this.cargas.leerVentas.ejecutar(sesion, mesDe(consulta));
    return ventas.map((venta) => ({ productId: venta.productId, unidades: venta.unidades }));
  }

  /** T6: los costos del mes, con su clasificación explícita (SPEC §17). */
  @Post('costos-fijos')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Requiere('cost.write')
  public async registrarCostos(
    @SesionActual() sesion: SesionActiva,
    @Body(new EsquemaPipe(CUERPO_DE_COSTOS)) cuerpo: CuerpoDeCostos,
  ): Promise<void> {
    await this.cargas.costos.ejecutar(sesion, {
      locationId: aLocationId(cuerpo.locationId),
      anio: cuerpo.anio,
      mes: cuerpo.mes,
      costos: cuerpo.costos.map(comoCosto),
    });
  }

  @Get('costos-fijos')
  @Requiere('cost.read')
  public async costos(
    @SesionActual() sesion: SesionActiva,
    @Query(new EsquemaPipe(CONSULTA_DEL_MES)) consulta: ConsultaDelMes,
  ): Promise<readonly CostoDto[]> {
    return this.cargas.leerCostos.ejecutar(sesion, mesDe(consulta));
  }
}

/**
 * Las cinco vistas. **`analytics.read`, que `BODEGA` no tiene.**
 *
 * Hay una prueba de confidencialidad por endpoint, y todas comprueban lo mismo:
 * 403. No hay proyección reducida de estas vistas para `BODEGA` — la reducción
 * que le corresponde es el semáforo, y vive en su propio controlador.
 */
@Controller('analitica')
export class AnaliticaController {
  public constructor(private readonly vistas: VistasDelMes) {}

  @Get('resumen')
  @Requiere('analytics.read')
  public async resumen(
    @SesionActual() sesion: SesionActiva,
    @Query(new EsquemaPipe(CONSULTA_DEL_MES)) consulta: ConsultaDelMes,
  ): Promise<ResumenDto> {
    return comoResumenDto(await this.vistas.resumen.ejecutar(sesion, mesDe(consulta)));
  }

  @Get('menu-engineering')
  @Requiere('analytics.read')
  public async menu(
    @SesionActual() sesion: SesionActiva,
    @Query(new EsquemaPipe(CONSULTA_DEL_MES)) consulta: ConsultaDelMes,
  ): Promise<MenuDto> {
    return comoMenuDto(await this.vistas.menu.ejecutar(sesion, mesDe(consulta)));
  }

  /** SPEC §16, con `diferenciaConciliacion` a la vista: R7 tiene que dar 0. */
  @Get('food-cost-real')
  @Requiere('analytics.read')
  public async foodCost(
    @SesionActual() sesion: SesionActiva,
    @Query(new EsquemaPipe(CONSULTA_DEL_MES)) consulta: ConsultaDelMes,
  ): Promise<FoodCostRealDto> {
    return comoFoodCostDto(await this.vistas.foodCost.ejecutar(sesion, mesDe(consulta)));
  }

  @Get('punto-de-equilibrio')
  @Requiere('analytics.read')
  public async equilibrio(
    @SesionActual() sesion: SesionActiva,
    @Query(new EsquemaPipe(CONSULTA_DEL_MES)) consulta: ConsultaDelMes,
  ): Promise<PuntoDeEquilibrioDto> {
    return comoEquilibrioDto(await this.vistas.equilibrio.ejecutar(sesion, mesDe(consulta)));
  }

  @Get('inventario')
  @Requiere('analytics.read')
  public async inventario(
    @SesionActual() sesion: SesionActiva,
    @Query(new EsquemaPipe(CONSULTA_DEL_MES)) consulta: ConsultaDelMes,
  ): Promise<InventarioDto> {
    return comoInventarioDto(await this.vistas.inventario.ejecutar(sesion, mesDe(consulta)));
  }
}

/**
 * El semáforo de reposición — lo único de P8 que `BODEGA` recibe.
 *
 * Controlador aparte **porque el permiso es otro**, no por orden.
 */
@Controller('analitica')
export class ReposicionController {
  public constructor(private readonly reposicion: ConsultarReposicion) {}

  @Get('reposicion')
  @Requiere('replenishment.read')
  public async listar(
    @SesionActual() sesion: SesionActiva,
    @Query(new EsquemaPipe(CONSULTA_DEL_MES)) consulta: ConsultaDelMes,
  ): Promise<readonly FilaDeReposicionDto[]> {
    const filas = await this.reposicion.ejecutar(sesion, mesDe(consulta));
    return filas.map(comoReposicionDto);
  }
}

function mesDe(consulta: ConsultaDelMes): {
  readonly locationId: ReturnType<typeof aLocationId>;
  readonly anio: number;
  readonly mes: number;
} {
  return {
    locationId: aLocationId(consulta.locationId),
    anio: consulta.anio,
    mes: consulta.mes,
  };
}
