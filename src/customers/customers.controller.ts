import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { customersService } from './customers.service';

// POST --> CON LA PETICIÓN ENVIAS DATOS, I ESPERAS RESPUESTA (EL PRECIO DE CIERTO PRODUCTO)
// GET ---> SOLO ESPERAS RESPUESTA (LA HORA)
@Controller()
export class customersController {
  constructor(private readonly customersService: customersService) {}

  @Get('syncCustomers')
  async customers(
    @Query('companyID') companyID: string,
    @Query('database') database: string,
    @Query('client_id') client_id: string,
    @Query('client_secret') client_secret: string,
    @Query('tenant') tenant: string,
    @Query('entorno') entorno: string,
  ) {
    let res = await this.customersService.syncCustomers(companyID, database, client_id, client_secret, tenant, entorno);
    if (res == true) return 'Se han sincronizado los clientes correctamente';
    else return 'Ha habido un error al sincronizar los clientes';
  }
}
