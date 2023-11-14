import { Controller, Get, Post, Body } from '@nestjs/common';
import { employeesService } from './employees.service';

// POST --> CON LA PETICIÓN ENVIAS DATOS, I ESPERAS RESPUESTA (EL PRECIO DE CIERTO PRODUCTO)
// GET ---> SOLO ESPERAS RESPUESTA (LA HORA)
@Controller()
export class employeesController {
  constructor(private readonly employeesService: employeesService) {}

  @Get('syncEmployees')
  async employees() {
    let res = await this.employeesService.syncEmployees();
    if (res == true) return 'Se han sincronizado los empleados correctamente';
    else return 'Ha habido un error al sincronizar los empleados';
  }
}
