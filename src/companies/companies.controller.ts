import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { companiesService } from './companies.service';

// POST --> CON LA PETICIÓN ENVIAS DATOS, I ESPERAS RESPUESTA
// GET ---> SOLO ESPERAS RESPUESTA (LA HORA)
@Controller()
export class companiesController {
  constructor(private readonly companiesService: companiesService) {}

  @Get('getCompaniesId')
  async companies(@Query('client_id') client_id: string, @Query('client_secret') client_secret: string, @Query('tenant') tenant: string, @Query('entorno') entorno: string) {
    let res = await this.companiesService.getCompaniesId(client_id, client_secret, tenant, entorno);
    if (res == true) return 'OK';
    else return 'Ha habido un error al obtener los IdCompany';
  }
}
