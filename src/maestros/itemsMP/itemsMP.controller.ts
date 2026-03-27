import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { itemsMPService } from './itemsMP.service';

// POST --> CON LA PETICIÓN ENVIAS DATOS, I ESPERAS RESPUESTA (EL PRECIO DE CIERTO PRODUCTO)
// GET ---> SOLO ESPERAS RESPUESTA (LA HORA)
@Controller()
export class itemsMPController {
  constructor(private readonly itemsMPService: itemsMPService) {}

  @Get('syncItemsMP')
  async items(
    @Query('companyID') companyID: string,
    @Query('database') database: string,
    @Query('client_id') client_id: string,
    @Query('client_secret') client_secret: string,
    @Query('tenant') tenant: string,
    @Query('entorno') entorno: string,
  ) {
    let res = await this.itemsMPService.syncItemsMP(companyID, database, client_id, client_secret, tenant, entorno);
    if (res == true) return 'Se han sincronizado los artículos de compras correctamente';
    else return 'Ha habido un error al sincronizar los artículos de compras';
  }
}
