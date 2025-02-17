import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { Response } from 'express';
import { IncidenciaService } from './incidencia.service';

@Controller()
export class IncidenciaController {
  constructor(private readonly incidenciaService: IncidenciaService) { }

  @Get('syncIncidencias')
  async incidencias(
    @Query('companyNAME') companyNAME: string,
    @Query('database') database: string,
    @Query('client_id') client_id: string,
    @Query('client_secret') client_secret: string,
    @Query('tenant') tenant: string,
    @Query('entorno') entorno: string,
  ) {
    let res1 = await this.incidenciaService.syncIncidencias(companyNAME, database, client_id, client_secret, tenant, entorno);
    if (!res1) return 'Ha habido un error al sincronizar las incidencias';
    let res2 = await this.incidenciaService.syncInc_Adjuntos(companyNAME, database, client_id, client_secret, tenant, entorno);
    if (!res2) return 'Ha habido un error al sincronizar las inc_Adjuntos';
    let res3 = await this.incidenciaService.syncInc_Categorias(companyNAME, database, client_id, client_secret, tenant, entorno);
    if (!res3) return 'Ha habido un error al sincronizar las inc_Categorias';
    let res4 = await this.incidenciaService.syncInc_Clientes(companyNAME, database, client_id, client_secret, tenant, entorno);
    if (!res4) return 'Ha habido un error al sincronizar las inc_Clientes';
    let res5 = await this.incidenciaService.syncInc_Historico(companyNAME, database, client_id, client_secret, tenant, entorno);
    if (!res5) return 'Ha habido un error al sincronizar las inc_Historico';
    let res6 = await this.incidenciaService.syncInc_Link_Otros(companyNAME, database, client_id, client_secret, tenant, entorno);
    if (!res6) return 'Ha habido un error al sincronizar las inc_Link_Otros';
    return 'Se han sincronizado todas las incidencias correctamente';
  }
}