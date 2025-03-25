import { Controller, Get, Param, Res, Post, Body, Query } from '@nestjs/common';
import { Response } from 'express';
import { PdfService } from './pdf.service';

interface SubirPdfRequest {
  id: string; // Id de BC
  archivo: string; // Base64
  database: string; // Base de datos
  entorno: string;
  tenant: string;
  client: string;
  secret: string;
  companyId: string;
  empresaCodi: string;
}

@Controller()
export class PdfController {
  constructor(private readonly pdfService: PdfService) {}

  @Get('/pdf/:database/:id') //Get del pdf (http://54.77.231.164:3333/pdf/{database}/{id}). Ejemplo: http://54.77.231.164:3333/pdf/Fac_HitRs/743d8234-dbc4-ee11-9078-000d3adbf495
  async getPdf(
    @Param('database') database: string,
    @Param('id') id: string,
    @Res() res: Response,
    @Param('client_id') client_id: string,
    @Param('client_secret') client_secret: string,
    @Param('tenant') tenant: string,
    @Param('entorno') entorno: string,
    @Param('companyId') companyId: string,
  ) {
    try {
      const result = await this.pdfService.getPdf(database, id, client_id, client_secret, tenant, entorno, companyId);
      if (result.success) {
        // Configura los headers de la respuesta para indicar que es un archivo PDF
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Factura.pdf"`); //Factura es el nombre y siempre tiene que terminar con .pdf

        // Envía el contenido del PDF como respuesta si el success es true
        res.send(result.pdfData);
      } else {
        return res.status(404).send({ error: 'El archivo solicitado no existe' }); // Envía un error
      }
    } catch (error) {
      console.error('Error al descargar el PDF:', error);
      return res.status(500).send({ error: 'Error al descargar el PDF' });
    }
  }

  @Post('/pdf/subirPDF') //Post del pdf para subr a la base de datos
  async subirPdf(@Body() body: SubirPdfRequest, @Res() res: Response) {
    const { id, archivo, database, client, secret, tenant, entorno, companyId} = body;

    //Diferentes errores para que avise del problema por si no se proporciona uno de los datos necesarios
    if (!archivo) {
      return res.status(400).json({ msg: 'No se proporcionó un archivo Base64' });
    } else if (!database) {
      return res.status(400).json({ msg: 'No se proporcionó una base de datos' });
    } else if (!id) {
      return res.status(400).json({ msg: 'No se proporcionó un ID' });
    }

    try {
      const result = await this.pdfService.subirPdf(id, archivo, database, client, secret, tenant, entorno, companyId);
      return res.status(200).json(result);
    } catch (error) {
      console.error('Error al subir el PDF:', error);
      return res.status(500).json({ msg: 'No se ha podido insertar' });
    }
  }

  @Get('sendMail')
  async sendMail(
    @Query('database') database: string,
    @Query('mailTo') mailTo: string,
    @Query('idFactura') idFactura: string,
    @Query('client_id') client_id: string,
    @Query('client_secret') client_secret: string,
    @Query('tenant') tenant: string,
    @Query('entorno') entorno: string,
    @Query('companyId') companyId: string,
  ) {
    let res = await this.pdfService.enviarCorreoSeleccionarPdf(database, mailTo, idFactura, client_id, client_secret, tenant, entorno, companyId);
    if (!res) return 'Ha habido un error al intentar enviar el correo';
    return 'Se han sincronizado todas las incidencias correctamente';
  }

  @Get('espera')
  async espera() {
    let res = await this.pdfService.esperaYVeras();
    if (!res) return 'Ha habido un error al intentar enviar el correo';
    return 'Se han sincronizado todas las incidencias correctamente';
  }
}
