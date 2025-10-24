import { Controller, Get, Post, Body, Query, Res, Param } from '@nestjs/common';
import { salesSilemaRecapManualService } from './salesSilemaRecapManual.service';

@Controller()
export class salesSilemaRecapManualController {
  constructor(private readonly salesSilemaRecapManualService: salesSilemaRecapManualService) {}

  @Get('syncSalesSilemaRecapManual')
  async salesSilemaRecapManual(
    @Query('TicketsArray') TicketsArray: Array<String>,
    @Query('client') client: string,
    @Query('dataInici') dataInici: string,
    @Query('dataFi') dataFi: string,
    @Query('dataFactura') dataFactura: string,
    @Query('companyID') companyID: string,
    @Query('database') database: string,
    @Query('client_id') client_id: string,
    @Query('client_secret') client_secret: string,
    @Query('tenant') tenant: string,
    @Query('entorno') entorno: string,
  ) {
    let res = await this.salesSilemaRecapManualService.syncSalesSilemaRecapitulativaManual(TicketsArray, client, dataInici, dataFi, dataFactura, companyID, database, client_id, client_secret, tenant, entorno);
    if (res == true) return 'Se han sincronizado los tickets correctamente';
    else return 'Ha habido un error al sincronizar los tickets';
  }
}
