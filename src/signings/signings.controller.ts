import { Controller, Get, Post, Body } from '@nestjs/common';
import { signingsService } from './signings.service';

// POST --> CON LA PETICIÓN ENVIAS DATOS, I ESPERAS RESPUESTA (EL PRECIO DE CIERTO PRODUCTO)
// GET ---> SOLO ESPERAS RESPUESTA (LA HORA)
@Controller()
export class signingsController {
  constructor(private readonly signingsService: signingsService) {}

  @Get('syncsignings')
  async signings() {
    let res = await this.signingsService.syncsignings();
    if (res == true) return 'Se han sincronizado los empleados correctamente';
    else return 'Ha habido un error al sincronizar los empleados';
  }
}
