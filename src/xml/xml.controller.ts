import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { xmlService } from './xml.service';

// POST --> CON LA PETICIÓN ENVIAS DATOS, I ESPERAS RESPUESTA (EL PRECIO DE CIERTO PRODUCTO)
// GET ---> SOLO ESPERAS RESPUESTA (LA HORA)
@Controller()
export class xmlController {
    constructor(private readonly xmlService: xmlService) { }

    @Get('getXML')
    async getXML(
        @Query('companyID') companyID: string,
        @Query('database') database: string,
        @Query('client_id') client_id: string,
        @Query('client_secret') client_secret: string,
        @Query('tenant') tenant: string,
        @Query('entorno') entorno: string,
        @Query('documentNo') documentNo: string,
        @Query('endpoint') endpoint: string,
    ) {
        let res = await this.xmlService.getXML(companyID, database, client_id, client_secret, tenant, entorno, documentNo, endpoint);
        if (res == true) return 'Se han sincronizado los almacenes correctamente';
        else return 'Ha habido un error al sincronizar los almacenes';
    }
}
