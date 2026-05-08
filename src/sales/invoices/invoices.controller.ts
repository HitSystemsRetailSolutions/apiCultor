import { Controller, Get, Post, Body, Query, Res, Param } from '@nestjs/common';
import { invoicesService } from './invoices.service';
import fs = require('fs');
// POST --> CON LA PETICIÓN ENVIAS DATOS, I ESPERAS RESPUESTA (EL PRECIO DE CIERTO PRODUCTO)
// GET ---> SOLO ESPERAS RESPUESTA (LA HORA)

interface updateRegistroRequest {
  companyId: string;
  database: string; // Base de datos
  id: string; // Id de BC
  client: string;
  secret: string;
  tenant: string;
  entorno: string;
  endpoint: string;
}
@Controller()
export class invoicesController {
  constructor(private readonly invoicesService: invoicesService) { }

  @Get('syncSalesFacturas')
  async salesFacturas(
    @Query('companyID') companyID: string,
    @Query('database') database: string,
    @Query('idFactura') idFacturas: string[],
    @Query('tabla') tabla: string,
    @Query('client_id') client_id: string,
    @Query('client_secret') client_secret: string,
    @Query('tenant') tenant: string,
    @Query('entorno') entorno: string,
  ) {
    let res = await this.invoicesService.syncSalesFacturas(companyID, database, idFacturas, tabla, client_id, client_secret, tenant, entorno);
    if (res == true) return 'Se han sincronizado las facturas correctamente';
    else return 'Ha habido un error al sincronizar las facturas';
  }
  @Get('updateRegistro')
  async updateRegistro(
    @Query('companyID') companyID: string,
    @Query('database') database: string,
    @Query('idFactura') idFactura: string,
    @Query('client_id') client: string,
    @Query('client_secret') secret: string,
    @Query('tenant') tenant: string,
    @Query('entorno') entorno: string,
    @Query('endpoint') endpoint: string) {
    let res = await this.invoicesService.updateRegistro(companyID, database, idFactura, client, secret, tenant, entorno, endpoint);
    if (!res) return 'Ha habido un error al actualizar el registro';
    return 'Se han actualizado las facturas correctamente';
  }

  @Get('getInvoiceByNumber')
  async getInvoiceByNumber(
    @Query('companyID') companyID: string,
    @Query('invoiceNumber') invoiceNumber: string,
    @Query('client_id') client_id: string,
    @Query('client_secret') client_secret: string,
    @Query('tenant') tenant: string,
    @Query('entorno') entorno: string,
    @Query('database') database: string,
  ) {
    let res = await this.invoicesService.getInvoiceByNumber(companyID, invoiceNumber, client_id, client_secret, tenant, entorno, database);
    return res;
  }
  @Get('rellenarBCSyncSales')
  async rellenarBCSyncSales(
    @Query('companyID') companyID: string,
    @Query('database') database: string,
    @Query('idFactura') idFactura: string[],
    @Query('client_id') client: string,
    @Query('client_secret') secret: string,
    @Query('tenant') tenant: string,
    @Query('entorno') entorno: string,
    @Query('year') year: string
  ) {
    let res = await this.invoicesService.rellenarBCSyncSales(companyID, database, idFactura, client, secret, tenant, entorno, year);
    if (!res) return 'Ha habido un error al actualizar el registro';
    return 'Se han actualizado las facturas correctamente';
  }
}
