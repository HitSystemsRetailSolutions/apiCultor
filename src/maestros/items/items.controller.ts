import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { itemsService } from './items.service';

@Controller()
export class itemsController {
  constructor(private readonly itemsService: itemsService) {}

  @Get('syncItems')
  async items(
    @Query('companyID') companyID: string,
    @Query('database') database: string,
    @Query('client_id') client_id: string,
    @Query('client_secret') client_secret: string,
    @Query('tenant') tenant: string,
    @Query('entorno') entorno: string,
  ) {
    let res = await this.itemsService.syncItems(companyID, database, client_id, client_secret, tenant, entorno);
    if (res == true) return 'Se han sincronizado los artículos correctamente';
    else return 'Ha habido un error al sincronizar los artículos';
  }

  @Get('syncItemsMP')
  async itemsMP(
    @Query('companyID') companyID: string,
    @Query('database') database: string,
    @Query('client_id') client_id: string,
    @Query('client_secret') client_secret: string,
    @Query('tenant') tenant: string,
    @Query('entorno') entorno: string,
    @Query('codiHIT') codiHIT?: string,
  ) {
    let res = await this.itemsService.syncItems(companyID, database, client_id, client_secret, tenant, entorno, codiHIT, 'purchase');
    if (res == true) return 'Se han sincronizado los artículos de compras correctamente';
    else return 'Ha habido un error al sincronizar los artículos de compras';
  }
}
