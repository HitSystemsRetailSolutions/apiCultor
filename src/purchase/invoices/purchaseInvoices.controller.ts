import { Controller, Get, Query } from '@nestjs/common';
import { purchaseInvoicesService } from './purchaseInvoices.service';

@Controller()
export class purchaseInvoicesController {
  constructor(private readonly purchaseInvoicesService: purchaseInvoicesService) { }

  @Get('syncPurchaseFacturas')
  async purchaseFacturas(
    @Query('companyID') companyID: string,
    @Query('database') database: string,
    @Query('idFactura') idFacturas: string[],
    @Query('tabla') tabla: string,
    @Query('client_id') client_id: string,
    @Query('client_secret') client_secret: string,
    @Query('tenant') tenant: string,
    @Query('entorno') entorno: string,
  ) {
    let res = await this.purchaseInvoicesService.syncPurchaseFacturas(companyID, database, idFacturas, tabla, client_id, client_secret, tenant, entorno);
    if (res == true) return 'Se han sincronizado las facturas de compra correctamente';
    else return 'Ha habido un error al sincronizar las facturas de compra';
  }

  @Get('updateRegistroPurchase')
  async updateRegistro(
    @Query('companyID') companyID: string,
    @Query('database') database: string,
    @Query('idFactura') idFactura: string,
    @Query('client_id') client: string,
    @Query('client_secret') secret: string,
    @Query('tenant') tenant: string,
    @Query('entorno') entorno: string,
    @Query('endpoint') endpoint: string) {
    let res = await this.purchaseInvoicesService.updateRegistro(companyID, database, idFactura, client, secret, tenant, entorno, endpoint);
    if (!res) return 'Ha habido un error al actualizar el registro de compra';
    return 'Se han actualizado las facturas de compra correctamente';
  }

  @Get('getPurchaseInvoiceByNumber')
  async getInvoiceByNumber(
    @Query('companyID') companyID: string,
    @Query('invoiceNumber') invoiceNumber: string,
    @Query('client_id') client_id: string,
    @Query('client_secret') client_secret: string,
    @Query('tenant') tenant: string,
    @Query('entorno') entorno: string,
    @Query('database') database: string,
  ) {
    let res = await this.purchaseInvoicesService.getInvoiceByNumber(companyID, invoiceNumber, client_id, client_secret, tenant, entorno, database);
    return res;
  }

  @Get('rellenarBCSyncPurchase')
  async rellenarBCSyncPurchase(
    @Query('companyID') companyID: string,
    @Query('database') database: string,
    @Query('idFactura') idFactura: string[],
    @Query('client_id') client: string,
    @Query('client_secret') secret: string,
    @Query('tenant') tenant: string,
    @Query('entorno') entorno: string,
    @Query('year') year: string
  ) {
    let res = await this.purchaseInvoicesService.rellenarBCSyncPurchase(companyID, database, idFactura, client, secret, tenant, entorno, year);
    if (!res) return 'Ha habido un error al actualizar el registro de compra';
    return 'Se han actualizado las facturas de compra correctamente';
  }
}
