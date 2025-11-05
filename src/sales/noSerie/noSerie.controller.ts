import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { noSerieService } from './noSerie.service';

// POST --> CON LA PETICIÓN ENVIAS DATOS, I ESPERAS RESPUESTA (EL PRECIO DE CIERTO PRODUCTO)
// GET ---> SOLO ESPERAS RESPUESTA (LA HORA)
@Controller()
export class noSerieController {
    constructor(private readonly noSerieService: noSerieService) { }

    @Get('getNoSerie')
    async getNoSerie(
        @Query('companyID') companyID: string,
        @Query('client_id') client_id: string,
        @Query('client_secret') client_secret: string,
        @Query('tenant') tenant: string,
        @Query('entorno') entorno: string,
        @Query('noSerie') noSerie: string,
    ) {
        let res = await this.noSerieService.getNoSerie(companyID, client_id, client_secret, tenant, entorno, noSerie);
        if (res == true) return 'Se han sincronizado los almacenes correctamente';
        else return 'Ha habido un error al sincronizar los almacenes';
    }
}
