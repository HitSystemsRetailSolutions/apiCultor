import { Controller, Get, Post, Body } from '@nestjs/common';
import { itemsService } from './items.service';

// POST --> CON LA PETICIÓN ENVIAS DATOS, I ESPERAS RESPUESTA (EL PRECIO DE CIERTO PRODUCTO)
// GET ---> SOLO ESPERAS RESPUESTA (LA HORA)
@Controller()
export class itemsController {
  constructor(private readonly itemsService: itemsService) {}

  @Get('syncItems')
  async items() {
    let res = await this.itemsService.syncItems();
    if (res == true) return 'Se han sincronizado los artículos correctamente';
    else return 'Ha habido un error al sincronizar los artículos';
  }
}
