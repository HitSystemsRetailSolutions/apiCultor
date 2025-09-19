import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { ticketsService } from './tickets.service';

// POST --> CON LA PETICIÓN ENVIAS DATOS, I ESPERAS RESPUESTA (EL PRECIO DE CIERTO PRODUCTO)
// GET ---> SOLO ESPERAS RESPUESTA (LA HORA)
@Controller()
export class ticketsController {
  constructor(private readonly ticketsService: ticketsService) { }

  @Get('syncTickets')
  async tickets(
    @Query('companyID') companyID: string,
    @Query('database') database: string,
    @Query('client_id') client_id: string,
    @Query('client_secret') client_secret: string,
    @Query('tenant') tenant: string,
    @Query('entorno') entorno: string,
    @Query('botiga') botiga: string[],
    @Query('companyNAME') companyName: string,
  ) {
    let res = await this.ticketsService.syncTickets(companyID, database, client_id, client_secret, tenant, entorno, botiga, companyName);
    if (res == true) return { message: 'Se han sincronizado los tickets correctamente' };
    else return 'Ha habido un error al sincronizar las previsiones de ventas';
  }
}
