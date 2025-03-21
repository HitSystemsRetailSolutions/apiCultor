import { Injectable } from '@nestjs/common';
import { getTokenService } from '../connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConection.service';
import * as nodemailer from 'nodemailer';
import axios from 'axios';
import * as mailgunTransport from 'nodemailer-mailgun-transport';

@Injectable()
export class PdfService {
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) {}

  async enviarCorreoConPdf(pdfData, mailTo) {
    try {
      // Configuración del transporte SMTP para Gmail
      const transporter = nodemailer.createTransport({
        service: 'gmail', //El correo que pongas aqui tiene que tener activado una configuracion de la cuenta de Google que es: Seguridad -> Acceso de aplicaciones poco seguras
        auth: {
          user: process.env.EMAIL_USERNAME, // Reemplaza con tu dirección de correo de Gmail
          pass: process.env.EMAIL_PASSWORD, // Reemplaza con tu contraseña de Gmail
        },
      });
      //console.log(transporter);
      //console.log("--------------------------------------------------");
      // Opciones del correo electrónico
      const mailOptions = {
        from: process.env.EMAIL_USERNAME, // Debe ser la misma que la dirección de correo de Gmail utilizada en 'auth.user'
        to: mailTo,
        subject: 'PDF adjunto',
        text: 'Adjunto encontrarás el PDF solicitado.',
        attachments: [
          {
            filename: 'factura.pdf', //archivo es el nombre y siempre tiene que terminar con .pdf
            content: pdfData,
            encoding: 'base64',
          },
        ],
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

  async enviarCorreoSMTPConPdf(pdfData, mailTo) {
    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SLS_SMTPSERVER,
        port: process.env.SLN_SMTPSERVERPORT,
        secure: process.env.SLB_SMTPUSESSL,
        auth: {
          user: process.env.SLS_SMTPUSERNAME,
          pass: process.env.SLS_SMTPPASSWORD,
        },
      });

      const mailOptions = {
        from: process.env.SLS_DEFAULTDE,
        to: mailTo,
        subject: 'PDF adjunto',
        text: 'Adjunto encontrarás el PDF solicitado.',
        attachments: [
          {
            filename: 'factura.pdf',
            content: pdfData,
            encoding: 'base64',
          },
        ],
      };

      const info = await transporter.sendMail(mailOptions);
      console.log('Correo enviado:', info);

      return { success: true };
    } catch (error) {
      console.error('Error al enviar el correo electrónico:', error);
      return { success: false, message: 'Error al enviar el correo electrónico' };
    }
  }

  async enviarCorreoSeleccionarPdf(database, mailTo, idFactura, client_id, client_secret, tenant, entorno, companyID) {
    try {
      // Obtén todos los fragmentos asociados con el archivo
      const fragmentos = await this.obtenerFragmentosDeArchivo(idFactura, database,client_id, client_secret, tenant, entorno, companyID);

      // Verifica si el archivo existe
      if (!fragmentos || fragmentos.length === 0) {
        console.log('Archivo solicitado no existe');
        return { success: false, message: 'El archivo solicitado no existe' };
      }

      // Concatena todos los fragmentos para reconstruir el archivo original
      const archivoCompleto = Buffer.concat(fragmentos);

      // Envía el PDF por correo electrónico
      await this.enviarCorreoConPdf(archivoCompleto, mailTo);
    } catch (error) {
      console.error('Error al enviar el correo:', error);
      return { success: false, message: 'Error al enviar el correo' };
    }
  }

  async obtenerFragmentosDeArchivo(id: string, database: string, client_id: string, client_secret: string, tenant: string, entorno: string, companyID: string) {
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    // Realiza una consulta SQL para recuperar los fragmentos asociados con el archivo
    const res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices(${id})`, {
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
    });
    const year = res.data.value[0].postingDate.split('-')[0];
    const sql = `
      SELECT BC_PDF FROM BC_SyncSales_${year} WHERE BC_IdSale = '${id}' ORDER BY HIT_DataFactura;
    `;
    let pdf;
    try {
      pdf = await this.sql.runSql(sql, database);
    } catch {
      console.log('Error');
    }
    return pdf.recordset.map((row) => Buffer.from(row.BC_PDF, 'hex'));
  }

  async getPdf(database: string, id: string, client_id: string, client_secret: string, tenant: string, entorno: string, companyID: string) {
    try {
      // Obtén todos los fragmentos asociados con el archivo
      const fragmentos = await this.obtenerFragmentosDeArchivo(id, database, client_id, client_secret, tenant, entorno, companyID);

      // Verifica si el archivo existe
      if (!fragmentos || fragmentos.length === 0) {
        console.log('Archivo solicitado no existe');
        return { success: false, message: 'El archivo solicitado no existe' };
      }

      // Concatena todos los fragmentos para reconstruir el archivo original
      const archivoCompleto = Buffer.concat(fragmentos);

      // Envía el PDF por correo electrónico
      await this.enviarCorreoConPdf(archivoCompleto, process.env.miCorreo);

      // Devuelve el PDF
      return { success: true, pdfData: archivoCompleto };
    } catch (error) {
      console.error('Error al descargar el archivo:', error);
      return { success: false, message: 'Error al descargar el archivo' };
    }
  }

  async esperaYVeras() {
    // Función de sleep
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    // Esperar 5 segundos
    await sleep(5000);
    return true;
  }

  async subirPdf(id: string, archivoBase64: string, database: string, client_id: string, client_secret: string, tenant: string, entorno: string, companyID: string) {
    // Convierte el Base64 a Buffer
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    const bufferArchivo = Buffer.from(archivoBase64, 'base64');
    const chunks = [];
    const chunkSize = bufferArchivo.length; // Tamaño de cada fragmento en bytes
    for (let i = 0; i < bufferArchivo.length; i += chunkSize) {
      const chunk = bufferArchivo.slice(i, i + chunkSize);
      chunks.push(chunk.toString('hex'));
    }

    try {
      const res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices(${id})`, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      });
      const year = res.data.postingDate.split('-')[0];
      for (let i = 0; i < chunks.length; i++) {    
        const sql = `UPDATE BC_SyncSales_${year} SET BC_PDF=0x${chunks[i]}, BC_Number=${res.data.number} WHERE BC_IdSale='${id}'`;
        let pdf;
        try {
          pdf = await this.sql.runSql(sql, database);
        } catch {
          console.log('Error');
        }
      }
      // let url1 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices(${id})`;
      // let url2 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices(${id})/salesInvoiceLines`;
      // let res1 = await axios
      //   .get(url1, {
      //     headers: {
      //       Authorization: 'Bearer ' + token,
      //       'Content-Type': 'application/json',
      //     },
      //   })
      //   .catch((error) => {
      //     throw new Error(`Failed get salesInvoices(${id})`);
      //   });
      // let res2 = await axios
      //   .get(url2, {
      //     headers: {
      //       Authorization: 'Bearer ' + token,
      //       'Content-Type': 'application/json',
      //     },
      //   })
      //   .catch((error) => {
      //     throw new Error(`Failed get salesInvoices(${id})/salesInvoiceLines`);
      //   });
      // for (let i = 0; i < res2.data.value.length; i++) {
      //   let x = res1.data;
      //   let y = res2.data.value[i];
      //   let año = x.invoiceDate.toString().split('-')[0];
      //   let BC_Number = x.number;
      //   let BC_TaxCode = y.taxCode;
      //   let BC_TaxPercent = y.taxPercent;
      //   let BC_AmountExcludingTax = y.amountExcludingTax;
      //   let BC_TotalTaxAmount = y.totalTaxAmount;
      //   let sql2 = `INSERT INTO [BC_SyncSalesTaxes_${año}] (ID, BC_Number, BC_TaxCode, BC_TaxPercent, BC_AmountExcludingTax, BC_TotalTaxAmount) VALUES
      //   (NEWID(), ${BC_Number}, '${BC_TaxCode}', ${BC_TaxPercent}, ${BC_AmountExcludingTax}, ${BC_TotalTaxAmount})`;
      //   let factura;
      //   try {
      //     factura = await this.sql.runSql(sql2, database);
      //   } catch {
      //     console.log('Error');
      //   }
      // }
      return { msg: 'Se ha insertado correctamente' };
    } catch (error) {
      console.error('Error al insertar el PDF en la base de datos:', error);
      throw error;
    }
  }
}
