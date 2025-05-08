import { Controller, Get, Post, Body, Query, Res, Param } from '@nestjs/common';
import { salesSilemaRecapService } from './salesSilemaRecap.service';

@Controller()
export class salesSilemaRecapController {
  constructor(private readonly salesSilemaRecapService: salesSilemaRecapService) {}

  @Get('syncSalesSilemaRecap')
  async salesSilemaRecap(
    @Query('periodoRecap') periodoRecap: string,
    @Query('month') month: string,
    @Query('year') year: string,
    @Query('companyID') companyID: string,
    @Query('database') database: string,
    @Query('client_id') client_id: string,
    @Query('client_secret') client_secret: string,
    @Query('tenant') tenant: string,
    @Query('entorno') entorno: string,
  ) {
    let res = await this.salesSilemaRecapService.syncRecapPeriodo(periodoRecap, month, year, companyID, database, client_id, client_secret, tenant, entorno);
    if (res == true) return 'Se han sincronizado los tickets correctamente';
    else return 'Ha habido un error al sincronizar los tickets';
  }
}
