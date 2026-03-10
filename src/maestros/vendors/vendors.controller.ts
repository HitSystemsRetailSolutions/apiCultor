import { Controller, Get, Query } from '@nestjs/common';
import { vendorsService } from './vendors.service';

@Controller()
export class vendorsController {
  constructor(private vendorsService: vendorsService) {}

  @Get('syncVendors')
  async syncVendors(
    @Query('companyID') companyID: string,
    @Query('database') database: string,
    @Query('client_id') client_id: string,
    @Query('client_secret') client_secret: string,
    @Query('tenant') tenant: string,
    @Query('entorno') entorno: string,
  ) {
    return this.vendorsService.syncVendors(companyID, database, client_id, client_secret, tenant, entorno);
  }
}
