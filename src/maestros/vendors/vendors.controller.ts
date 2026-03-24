import { Controller, Get, Query } from '@nestjs/common';
import { vendorsService } from './vendors.service';

@Controller()
export class vendorsController {
    constructor(private readonly vendorsService: vendorsService) { }

    @Get('syncVendors')
    async vendors(
        @Query('companyID') companyID: string,
        @Query('database') database: string,
        @Query('client_id') client_id: string,
        @Query('client_secret') client_secret: string,
        @Query('tenant') tenant: string,
        @Query('entorno') entorno: string,
    ) {
        let res = await this.vendorsService.syncVendors(companyID, database, client_id, client_secret, tenant, entorno);
        if (res == true) return 'Se han sincronizado los proveedores correctamente';
        else return 'Ha habido un error al sincronizar los proveedores';
    }
}
