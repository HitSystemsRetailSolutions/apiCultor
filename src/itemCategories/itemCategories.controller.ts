import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { itemCategoriesService } from './itemCategories.service';

// POST --> CON LA PETICIÓN ENVIAS DATOS, I ESPERAS RESPUESTA (EL PRECIO DE CIERTO PRODUCTO)
// GET ---> SOLO ESPERAS RESPUESTA (LA HORA)
@Controller()
export class itemCategoriesController {
  constructor(private readonly itemCategoriesService: itemCategoriesService) {}

  @Get('syncItemCategories')
  async itemCategories(
    @Query('companyID') companyID: string,
    @Query('database') database: string,
  ) {
    let res = await this.itemCategoriesService.syncItemCategories(
      companyID,
      database,
    );
    if (res == true) return 'Se han sincronizado las familias correctamente';
    else return 'Ha habido un error al sincronizar las familias';
  }
}
