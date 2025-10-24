import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { ventasPrevisionService } from './ventasPrevision.service';

// POST --> CON LA PETICIÓN ENVIAS DATOS, I ESPERAS RESPUESTA (EL PRECIO DE CIERTO PRODUCTO)
// GET ---> SOLO ESPERAS RESPUESTA (LA HORA)
@Controller()
export class ventasPrevisionController {
  constructor(private readonly ventasPrevisionService: ventasPrevisionService) {}

  @Get('syncVentasPrevisiones')
  async ventasPrevision(
    @Query('companyID') companyID: string,
    @Query('database') database: string,
    @Query('client_id') client_id: string,
    @Query('client_secret') client_secret: string,
    @Query('tenant') tenant: string,
    @Query('entorno') entorno: string,
  ) {
    let res = await this.ventasPrevisionService.syncVentasPrevision(companyID, database, client_id, client_secret, tenant, entorno);
    if (res == true) return 'Se han sincronizado las previsiones de ventas correctamente';
    else return 'Ha habido un error al sincronizar las previsiones de ventas';
  }
}
