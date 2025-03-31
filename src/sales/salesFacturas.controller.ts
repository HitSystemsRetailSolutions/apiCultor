import { Controller, Get, Post, Body, Query, Res, Param } from '@nestjs/common';
import { salesFacturasService } from './salesFacturas.service';
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
export class salesFacturasController {
  constructor(private readonly salesFacturasService: salesFacturasService) {}

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
    let res = await this.salesFacturasService.syncSalesFacturas(companyID, database, idFacturas, tabla, client_id, client_secret, tenant, entorno);
    if (res == true) return 'Se han sincronizado las facturas correctamente';
    else return 'Ha habido un error al sincronizar las facturas';
  }
  @Post('updateRegistro')
  async updateRegistro(@Body() body: updateRegistroRequest) {
    const { companyId, database, id, client, secret, tenant, entorno, endpoint } = body;
    let res = await this.salesFacturasService.updateRegistro(companyId, database, id, client, secret, tenant, entorno, endpoint);
    if (!res) return 'Ha habido un error al actualizar el registro';
    return 'Se han actualizado las facturas correctamente';
  }
  // @Get('generateXML')
  // async generateXML(
  //   @Query('companyID') companyID: string,
  //   @Query('idFactura') idFactura: string,
  //   @Query('client_id') client_id: string,
  //   @Query('client_secret') client_secret: string,
  //   @Query('tenant') tenant: string,
  //   @Query('entorno') entorno: string,
  // ) {
  //   let res = await this.salesFacturasService.generateXML(companyID, idFactura, client_id, client_secret, tenant, entorno);
  //   if (res.success == true) {
  //     fs.writeFileSync('../nameDeEjemplo.xml', res.xmlData);
  //   } else return 'Ha habido un error al hacerel xml y tal';
  // }

  // @Get('generateXML/:companyID/:idFactura')
  // async generateXMLWeb(
  //   @Param('companyID') companyID: string,
  //   @Param('idFactura') idFactura: string,
  //   @Query('client_id') client_id: string,
  //   @Query('client_secret') client_secret: string,
  //   @Query('tenant') tenant: string,
  //   @Query('entorno') entorno: string,
  //   @Res() response: any,
  // ) {
  //   if (tenant == null) tenant = process.env.tenant;
  //   if (entorno == null) entorno = process.env.entorno;
  //   let res = await this.salesFacturasService.generateXML(companyID, idFactura, client_id, client_secret, tenant, entorno);
  //   if (res.success == true) {
  //     // Configura los headers de la respuesta para indicar que es un archivo XML
  //     response.setHeader('Content-Type', 'application/xml');
  //     response.setHeader('Content-Disposition', `attachment; filename="nombreDeEjemplo.xml"`);

  //     // Envía el contenido del XML como respuesta
  //     response.send(res.xmlData);
  //   } else {
  //     // Maneja el caso en que haya un error al generar el XML
  //     response.status(500).send('Ha habido un error al hacer el XML.');
  //   }
  // }
}
