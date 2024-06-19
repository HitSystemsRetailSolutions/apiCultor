import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { employeesService } from './employees.service';

// POST --> CON LA PETICIÓN ENVIAS DATOS, I ESPERAS RESPUESTA (EL PRECIO DE CIERTO PRODUCTO)
// GET ---> SOLO ESPERAS RESPUESTA (LA HORA)
@Controller()
export class employeesController {
  constructor(private readonly employeesService: employeesService) {}

  @Get('syncEmployees')
  async employees(
    @Query('companyID') companyID: string,
    @Query('database') database: string,
    @Query('client_id') client_id: string,
    @Query('client_secret') client_secret: string,
    @Query('tenant') tenant: string,
    @Query('entorno') entorno: string,
  ) {
    const res = await this.employeesService.syncEmployees(companyID, database, client_id, client_secret, tenant, entorno);
    if (res == true) return 'Se han sincronizado los empleados correctamente';
    else return 'Ha habido un error al sincronizar los empleados';
  }
}
