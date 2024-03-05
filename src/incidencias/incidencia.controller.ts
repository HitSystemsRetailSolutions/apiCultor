import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { Response } from 'express';
import { IncidenciaService } from './incidencia.service';

@Controller()
export class IncidenciaController {
  constructor(private readonly incidenciaService: IncidenciaService) {}

  @Get('syncItemCategories')
  async itemCategories(
    @Query('companyNAME') companyNAME: string,
    @Query('database') database: string,
  ) {
    let res = await this.incidenciaService.syncIncidencias(companyNAME, database);
    if (res == true) return 'Se han sincronizado las incidencias correctamente';
    else return 'Ha habido un error al sincronizar las incidencias';
  }
}