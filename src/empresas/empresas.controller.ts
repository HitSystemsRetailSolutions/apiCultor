import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { empresasService } from './empresas.service';

// POST --> CON LA PETICIÓN ENVIAS DATOS, I ESPERAS RESPUESTA (EL PRECIO DE CIERTO PRODUCTO)
// GET ---> SOLO ESPERAS RESPUESTA (LA HORA)
@Controller()
export class empresasController {
  constructor(private readonly empresasService: empresasService) {}

  @Get('crearEmpresa')
  async employees(
    @Query('name') name: string,
    @Query('displayName') displayName: string,
    @Query('client_id') client_id: string,
    @Query('client_secret') client_secret: string,
    @Query('tenant') tenant: string,
    @Query('entorno') entorno: string,
    @Query('database') database: string,
    @Query('empresa_id') empresa_id: string,
    @Query('nif') nif: string,
  ) {
    const res = await this.empresasService.crearEmpresa(name, displayName, client_id, client_secret, tenant, entorno, database, empresa_id, nif);
    if (res == true) return `Se ha creado la empresa ${name} correctamente`;
    else return `Error al crear la empresa ${name}`;
  }
}
