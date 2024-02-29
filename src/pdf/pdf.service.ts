import { Injectable } from '@nestjs/common';
import { getTokenService } from '../conection/getToken.service';
import { runSqlService } from 'src/conection/sqlConection.service';
import * as nodemailer from 'nodemailer';
import * as mailgunTransport from 'nodemailer-mailgun-transport';

@Injectable()
export class PdfService {
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) {}

  async enviarCorreoConPdf(pdfData) {
    try {
      // Configuración del transporte SMTP para Gmail
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: 'jfunesa@ies-sabadell.cat', // Reemplaza con tu dirección de correo de Gmail
          pass: process.env.miPassword // Reemplaza con tu contraseña de Gmail
        }
      });
  
      // Opciones del correo electrónico
      const mailOptions = {
        from: 'jonatanfunesaguera@gmail.com', // Debe ser la misma que la dirección de correo de Gmail utilizada en 'auth.user'
        to: 'jfunesa@ies-sabadell.cat',
        subject: 'PDF adjunto',
        text: 'Adjunto encontrarás el PDF solicitado.',
        attachments: [
          {
            filename: 'archivo.pdf', //archivo es el nombre
            content: pdfData,
            encoding: 'base64'
          }
        ]
      };
  
      // Envío del correo electrónico
      const info = await transporter.sendMail(mailOptions);
      console.log('Correo enviado:', info);
  
      return { success: true };
    } catch (error) {
      console.error('Error al enviar el correo electrónico:', error);
      return { success: false, message: 'Error al enviar el correo electrónico' };
    }
  }

  async obtenerFragmentosDeArchivo(id: string, database: string) {
    // Realiza una consulta SQL para recuperar los fragmentos asociados con el archivo
    const sql = `
      SELECT BC_PDF FROM BC_SyncSales_2024 WHERE BC_IdSale = '${id}' ORDER BY HIT_DataFactura;
    `;
    let pdf;
    try{
      pdf =  await this.sql.runSql(sql,database,);
    } catch{
        console.log("Error")
    }
    return pdf.recordset.map(row => Buffer.from(row.BC_PDF, 'hex'));
  }

  async getPdf(database: string, id: string) {
    try {
      // Obtén todos los fragmentos asociados con el archivo
      const fragmentos = await this.obtenerFragmentosDeArchivo(id, database);

      // Verifica si el archivo existe
      if (!fragmentos || fragmentos.length === 0) {
        console.log("Archivo solicitado no existe")
        return { success: false, message: "El archivo solicitado no existe" };
      }

      // Concatena todos los fragmentos para reconstruir el archivo original
      const archivoCompleto = Buffer.concat(fragmentos);

      // Envía el PDF por correo electrónico
      await this.enviarCorreoConPdf(archivoCompleto);

      // Devuelve el PDF
      return { success: true, pdfData: archivoCompleto };
    } catch (error) {
      console.error("Error al descargar el archivo:", error);
      return { success: false, message: "Error al descargar el archivo" };
    }
  }

  async subirPdf(id: string, archivoBase64: string, database: string) {
    // Convierte el Base64 a Buffer
    const bufferArchivo = Buffer.from(archivoBase64, 'base64');
    const chunks = [];
    const chunkSize = bufferArchivo.length; // Tamaño de cada fragmento en bytes
    for (let i = 0; i < bufferArchivo.length; i += chunkSize) {
      const chunk = bufferArchivo.slice(i, i + chunkSize);
      chunks.push(chunk.toString('hex'));
    }

    try {
      for (let i = 0; i < chunks.length; i++) {
        const descripcion = `part ${i}`;
        /*
        const sql = `
          INSERT INTO archivo (id, nombre, extension, descripcion, archivo)
          VALUES (newid(), '${nombre}', 'PDF', '${descripcion}', 0x${chunks[i]})
        `;
        */
        const sql = `
          UPDATE BC_SyncSales_2024 SET BC_PDF=0x${chunks[i]} WHERE BC_IdSale='${id}'
        `;
        let pdf;
        try{
          pdf =  await this.sql.runSql(sql,database,);
        } catch{
            console.log("Error")
        }
      }

      return { msg: "Se ha insertado correctamente" };
    } catch (error) {
      console.error('Error al insertar el PDF en la base de datos:', error);
      throw error;
    }
  }
}