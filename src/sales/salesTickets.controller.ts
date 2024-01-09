import { Controller, Get, Post, Body } from '@nestjs/common';
import { salesTicketsService } from './salesTickets.service';

// POST --> CON LA PETICIÓN ENVIAS DATOS, I ESPERAS RESPUESTA (EL PRECIO DE CIERTO PRODUCTO)
// GET ---> SOLO ESPERAS RESPUESTA (LA HORA)
@Controller()
export class salesTicketsController {
  constructor(private readonly salesTicketsService: salesTicketsService) {}

  @Get('syncSalesTickets')
  async salesTickets() {
    let res = await this.salesTicketsService.syncSalesTickets();
    if (res == true) return 'Se han sincronizado los tickets correctamente';
    else return 'Ha habido un error al sincronizar los tickets';
  }
}
