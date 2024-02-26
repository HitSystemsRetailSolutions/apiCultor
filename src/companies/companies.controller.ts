import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { companiesService } from './companies.service';

// POST --> CON LA PETICIÓN ENVIAS DATOS, I ESPERAS RESPUESTA 
// GET ---> SOLO ESPERAS RESPUESTA (LA HORA)
@Controller()
export class companiesController {
  constructor(private readonly companiesService: companiesService) {}

  @Get('getCompaniesId')
  async companies(
  ) {
    let res = await this.companiesService.getCompaniesId();
    if (res == true) return 'OK';
    else return 'Ha habido un error al obtener los IdCompany';
  }
}