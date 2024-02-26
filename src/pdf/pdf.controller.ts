import { Controller, Get, Post, Body, Query, Param } from '@nestjs/common';
import { PdfService } from './pdf.service';

// POST --> CON LA PETICIÓN ENVIAS DATOS, I ESPERAS RESPUESTA (EL PRECIO DE CIERTO PRODUCTO)
// GET ---> SOLO ESPERAS RESPUESTA (LA HORA)
@Controller()
export class PdfController {
  constructor(private readonly pdfService: PdfService) {}

  @Get('pdf/:pdfName')
  async getPdf(@Param('pdfName') pdfName: string) {
    try {
      const result = await this.pdfService.getPdf(pdfName);
      if (result.success) {
        return result.pdfData;
      } else {
        return { error: 'Error al descargar el PDF' };
      }
    } catch (error) {
      console.error('Error al descargar el PDF:', error);
      return { error: 'Error al descargar el PDF' };
    }
  }
}