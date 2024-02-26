import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { salesFacturasService } from './salesFacturas.service';

// POST --> CON LA PETICIÓN ENVIAS DATOS, I ESPERAS RESPUESTA (EL PRECIO DE CIERTO PRODUCTO)
// GET ---> SOLO ESPERAS RESPUESTA (LA HORA)
@Controller()
export class salesFacturasController {
  constructor(private readonly salesFacturasService: salesFacturasService) {}

  @Get('syncSalesFacturas')
  async salesFacturas(
    @Query('companyID') companyID: string,
    @Query('database') database: string,
    @Query('idFactura') idFactura: string,
    @Query('tabla') tabla: string,
  ) {
    let res = await this.salesFacturasService.syncSalesFacturas(
      companyID,
      database,
      idFactura,
      tabla,
    );
    if (res == true) return 'Se han sincronizado las facturas correctamente';
    else return 'Ha habido un error al sincronizar las facturas';
  }
}
