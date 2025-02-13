import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { traspasosService } from './traspasos.service';

// POST --> CON LA PETICIÓN ENVIAS DATOS, I ESPERAS RESPUESTA (EL PRECIO DE CIERTO PRODUCTO)
// GET ---> SOLO ESPERAS RESPUESTA (LA HORA)
@Controller()
export class traspasosController {
  constructor(private readonly signingsService: traspasosService) {}

  @Get('syncTraspasos')
  async signings(
    @Query('companyNAME') comapanyNAME: string,
    @Query('database') database: string,
    @Query('client_id') client_id: string,
    @Query('client_secret') client_secret: string,
    @Query('tenant') tenant: string,
    @Query('entorno') entorno: string,
  ) {
    let res = await this.signingsService.syncSignings(comapanyNAME, database, client_id, client_secret, tenant, entorno);
    if (res == true) return 'Se han sincronizado los fichajes correctamente';
    else return 'Ha habido un error al sincronizar los fichajes';
  }
}
