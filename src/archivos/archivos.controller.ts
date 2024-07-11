import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { archivosService } from './archivos.service';

// POST --> CON LA PETICIÓN ENVIAS DATOS, I ESPERAS RESPUESTA (EL PRECIO DE CIERTO PRODUCTO)
// GET ---> SOLO ESPERAS RESPUESTA (LA HORA)
@Controller()
export class archivosController {
  constructor(private readonly archivosService: archivosService) {}

  @Get('syncArchivos')
  async archivos(
    @Query('companyNAME') comapanyNAME: string,
    @Query('database') database: string,
    @Query('client_id') client_id: string,
    @Query('client_secret') client_secret: string,
    @Query('tenant') tenant: string,
    @Query('entorno') entorno: string,
  ) {
    let res = await this.archivosService.syncArchivos(comapanyNAME, database, client_id, client_secret, tenant, entorno);
    if (res == true) return 'Se han sincronizado los archivos correctamente';
    else return 'Ha habido un error al sincronizar los archivos';
  }
}
