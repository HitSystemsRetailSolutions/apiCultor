import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { initConfigService } from './initConfig.service';

// POST --> CON LA PETICIÓN ENVIAS DATOS, I ESPERAS RESPUESTA (EL PRECIO DE CIERTO PRODUCTO)
// GET ---> SOLO ESPERAS RESPUESTA (LA HORA)
@Controller()
export class initConfigController {
  constructor(private readonly initConfigService: initConfigService) {}

  @Get('initConfig')
  async initConfig(
    @Query('companyID') companyID: string,
    @Query('client_id') client_id: string,
    @Query('client_secret') client_secret: string,
    @Query('tenant') tenant: string,
    @Query('entorno') entorno: string,
    @Query('database') database: string,
  ) {
    const res = await this.initConfigService.initConfig(companyID, database, client_id, client_secret, tenant, entorno);
    if (res == true) return `Se ha hecho la configuración inicial correctamente`;
    else return `Error al configurar`;
  }
}
