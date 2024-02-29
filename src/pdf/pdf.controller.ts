import { Controller, Get, Param, Res, Post, Body } from '@nestjs/common';
import { Response } from 'express';
import { PdfService } from './pdf.service';

interface SubirPdfRequest {
  id: string; // Id de BC
  archivo: string; // Base64
  database: string // Base de datos
}

@Controller()
export class PdfController {
  constructor(private readonly pdfService: PdfService) {}

  @Get('/pdf/:database/:id')
  async getPdf(@Param('database') database: string, @Param('id') id: string, @Res() res: Response) {
    try {
      const result = await this.pdfService.getPdf(database, id);
      if (result.success) {
        // Configura los headers de la respuesta para indicar que es un archivo PDF
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Factura.pdf"`); //Factura es el nombre

        // Envía el contenido del PDF como respuesta
        res.send(result.pdfData);
      } else {
        return res.status(404).send({ error: 'El archivo solicitado no existe' });
      }
    } catch (error) {
      console.error('Error al descargar el PDF:', error);
      return res.status(500).send({ error: 'Error al descargar el PDF' });
    }
  }

  @Post('/pdf/subirPDF')
  async subirPdf(@Body() body: SubirPdfRequest, @Res() res: Response) {
    const { id, archivo, database } = body;

    if (!archivo) {
      return res.status(400).json({ msg: "No se proporcionó un archivo Base64" });
    } else if (!database){
      return res.status(400).json({ msg: "No se proporcionó una base de datos" });
    } else if (!id){
      return res.status(400).json({ msg: "No se proporcionó un ID" });
    }
    
    try {
      const result = await this.pdfService.subirPdf(id, archivo, database);
      return res.status(200).json(result);
    } catch (error) {
      console.error('Error al subir el PDF:', error);
      return res.status(500).json({ msg: "No se ha podido insertar" });
    }
  }
}