import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { Response } from 'express';
import { IncidenciaService } from './incidencia.service';

@Controller()
export class IncidenciaController {
  constructor(private readonly incidenciaService: IncidenciaService) {}

  @Get('syncIncidencias')
  async incidencias(
    @Query('companyID') companyID: string,
    @Query('database') database: string,
    @Query('client_id') client_id: string,
    @Query('client_secret') client_secret: string,
    @Query('tenant') tenant: string,
    @Query('entorno') entorno: string,
  ) {
    let res1 = await this.incidenciaService.syncIncidencias(companyID, database, client_id, client_secret, tenant, entorno);
    if (!res1) return 'Ha habido un error al sincronizar las incidencias';
    // let res2 = await this.incidenciaService.syncInc_Adjuntos(companyNAME, database, client_id, client_secret, tenant, entorno);
    // if (!res2) return 'Ha habido un error al sincronizar las inc_Adjuntos';

    return 'Se han sincronizado todas las incidencias correctamente';
  }
}
