import { Controller, Get, Param, Res, Post, Body } from '@nestjs/common';
import { Response } from 'express';
import { PdfService } from './pdf.service';

interface SubirPdfRequest {
  nombre: string;
  archivo: string; // Base64
}

@Controller()
export class PdfController {
  constructor(private readonly pdfService: PdfService) {}

  @Get('pdf/:pdfName')
  async getPdf(@Param('pdfName') pdfName: string, @Res() res: Response) {
    try {
      const result = await this.pdfService.getPdf(pdfName);
      if (result.success) {
        // Configura los headers de la respuesta para indicar que es un archivo PDF
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${pdfName}.pdf"`);

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

  @Post('subirPDF')
  async subirPdf(@Body() body: SubirPdfRequest, @Res() res: Response) {
    const { nombre, archivo } = body;

    if (!archivo) {
      return res.status(400).json({ msg: "No se proporcionó un archivo Base64" });
    } else if (!nombre){
      return res.status(400).json({ msg: "No se proporcionó un nombre" });
    }
    
    try {
      const result = await this.pdfService.subirPdf(nombre, archivo);
      return res.status(200).json(result);
    } catch (error) {
      console.error('Error al subir el PDF:', error);
      return res.status(500).json({ msg: "No se ha podido insertar" });
    }
  }
}