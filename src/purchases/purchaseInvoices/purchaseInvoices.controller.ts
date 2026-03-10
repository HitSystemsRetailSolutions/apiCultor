import { Controller, Get, Query } from '@nestjs/common';
import { purchaseInvoicesService } from './purchaseInvoices.service';

@Controller()
export class purchaseInvoicesController {
  constructor(private purchaseInvoicesService: purchaseInvoicesService) {}

  @Get('syncPurchaseInvoices')
  async syncPurchaseInvoices(
    @Query('companyID') companyID: string,
    @Query('database') database: string,
    @Query('client_id') client_id: string,
    @Query('client_secret') client_secret: string,
    @Query('tenant') tenant: string,
    @Query('entorno') entorno: string,
  ) {
    return this.purchaseInvoicesService.syncPurchaseInvoices(companyID, database, client_id, client_secret, tenant, entorno);
  }

  @Get('getPurchaseInvoiceByNumber')
  async getPurchaseInvoiceByNumber(
    @Query('companyID') companyID: string,
    @Query('client_id') client_id: string,
    @Query('client_secret') client_secret: string,
    @Query('tenant') tenant: string,
    @Query('entorno') entorno: string,
    @Query('invoiceNumber') invoiceNumber: string,
  ) {
    return this.purchaseInvoicesService.getPurchaseInvoiceByNumber(companyID, client_id, client_secret, tenant, entorno, invoiceNumber);
  }
}
