import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { salesTicketsService } from './salesTickets.service';

// POST --> CON LA PETICIÓN ENVIAS DATOS, I ESPERAS RESPUESTA (EL PRECIO DE CIERTO PRODUCTO)
// GET ---> SOLO ESPERAS RESPUESTA (LA HORA)
@Controller()
export class salesTicketsController {
  constructor(private readonly salesTicketsService: salesTicketsService) { }

  @Get('syncSalesTickets')
  async salesTickets(
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
    let res = await this.salesTicketsService.syncVentas(day, month, year, companyID, database, botiga, client_id, client_secret, tenant, entorno);
    if (res == true) return 'Se han sincronizado los tickets correctamente';
    else return 'Ha habido un error al sincronizar los tickets';
  }
}

