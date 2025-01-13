import { Controller, Get, Post, Body, Query, Res, Param } from '@nestjs/common';
import { salesSilemaService } from './salesSilema.service';
import fs = require('fs');
// POST --> CON LA PETICIÓN ENVIAS DATOS, I ESPERAS RESPUESTA (EL PRECIO DE CIERTO PRODUCTO)
// GET ---> SOLO ESPERAS RESPUESTA (LA HORA)
@Controller()
export class salesSilemaController {
  constructor(private readonly salesSilemaService: salesSilemaService) { }

  @Get('syncSalesSilemaRecords')
  async salesSilemaRecords(
    @Query('companyID') companyID: string,
    @Query('database') database: string,
    @Query('botiga') botiga: string,
    @Query('client_id') client_id: string,
    @Query('client_secret') client_secret: string,
    @Query('tenant') tenant: string,
    @Query('entorno') entorno: string,
  ) {
    let res = await this.salesSilemaService.syncSalesSilemaRecords(companyID, database, botiga, client_id, client_secret, tenant, entorno);
    if (res == true) return 'Se han sincronizado los tickets correctamente';
    else return 'Ha habido un error al sincronizar los tickets';
  }

  @Get('syncSalesSilemaDate')
  async salesSilemaDate(
    @Query('dayStart') dayStart: string,
    @Query('dayEnd') dayEnd: string,
    @Query('month') month: string,
    @Query('year') year: string,
    @Query('companyID') companyID: string,
    @Query('database') database: string,
    @Query('botiga') botiga: string,
    @Query('client_id') client_id: string,
    @Query('client_secret') client_secret: string,
    @Query('tenant') tenant: string,
    @Query('entorno') entorno: string,
  ) {
    let res = await this.salesSilemaService.syncSalesSilemaDate(dayStart, dayEnd, month, year, companyID, database, botiga, client_id, client_secret, tenant, entorno);
    if (res == true) return 'Se han sincronizado los tickets correctamente';
    else return 'Ha habido un error al sincronizar los tickets';
  }

  @Get('syncSalesSilema')
  async salesSilema(
    @Query('day') day: string,
    @Query('month') month: string,
    @Query('year') year: string,
    @Query('companyID') companyID: string,
    @Query('database') database: string,
    @Query('botiga') botiga: string,
    @Query('client_id') client_id: string,
    @Query('client_secret') client_secret: string,
    @Query('tenant') tenant: string,
    @Query('entorno') entorno: string,
  ) {
    let res = await this.salesSilemaService.syncSalesSilema(day, month, year, companyID, database, botiga, client_id, client_secret, tenant, entorno);
    if (res == true) return 'Se han sincronizado los tickets correctamente';
    else return 'Ha habido un error al sincronizar los tickets';
  }

  @Get('syncSalesSilemaAbono')
  async salesSilemaAbono(
    @Query('day') day: string,
    @Query('month') month: string,
    @Query('year') year: string,
    @Query('companyID') companyID: string,
    @Query('database') database: string,
    @Query('botiga') botiga: string,
    @Query('client_id') client_id: string,
    @Query('client_secret') client_secret: string,
    @Query('tenant') tenant: string,
    @Query('entorno') entorno: string,
  ) {
    let res = await this.salesSilemaService.syncSalesSilemaAbono(day, month, year, companyID, database, botiga, client_id, client_secret, tenant, entorno);
    if (res == true) return 'Se han sincronizado los tickets correctamente';
    else return 'Ha habido un error al sincronizar los tickets';
  }

  @Get('syncSalesSilemaRecap')
  async salesSilemaRecap(
    @Query('client') client: string,
    @Query('tienda') tienda: string,
    @Query('dayStart') dayStart: string,
    @Query('dayEnd') dayEnd: string,
    @Query('month') month: string,
    @Query('year') year: string,
    @Query('companyID') companyID: string,
    @Query('database') database: string,
    @Query('botiga') botiga: string,
    @Query('client_id') client_id: string,
    @Query('client_secret') client_secret: string,
    @Query('tenant') tenant: string,
    @Query('entorno') entorno: string,
  ) {
    let res = await this.salesSilemaService.syncSalesSilemaRecapitulativa(client, tienda, dayStart, dayEnd, month, year, companyID, database, botiga, client_id, client_secret, tenant, entorno);
    if (res == true) return 'Se han sincronizado los tickets correctamente';
    else return 'Ha habido un error al sincronizar los tickets';
  }

  @Get('syncItemsSilema')
  async syncItemsSilema(
    @Query('companyID') companyID: string,
    @Query('database') database: string,
    @Query('client_id') client_id: string,
    @Query('client_secret') client_secret: string,
    @Query('tenant') tenant: string,
    @Query('entorno') entorno: string,
  ) {
    let res = await this.salesSilemaService.syncItemsSilema(companyID, database, client_id, client_secret, tenant, entorno);
    if (res == true) return 'Se han sincronizado los items correctamente';
    else return 'Ha habido un error al sincronizar los items';
  }
}
