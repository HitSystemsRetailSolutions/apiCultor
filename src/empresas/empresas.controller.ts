import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { empresasService } from './empresas.service';

// POST --> CON LA PETICIÓN ENVIAS DATOS, I ESPERAS RESPUESTA (EL PRECIO DE CIERTO PRODUCTO)
// GET ---> SOLO ESPERAS RESPUESTA (LA HORA)
@Controller()
export class empresasController {
  constructor(private readonly empresasService: empresasService) {}

  @Get('syncEmployees')
  async employees(
    @Query('name') name: string,
    @Query('displayName') displayName: string,
  ) {
    const res = await this.empresasService.crearEmpresa();
    if (res == true) return 'Se ha creado la empresa correctamente';
    else return 'Ha habido un error al crear la empresa';
  }
}