import { Injectable } from '@nestjs/common';
import { getTokenService } from 'src/connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConnection.service';
import * as nodemailer from 'nodemailer';
import axios from 'axios';
import * as mailgunTransport from 'nodemailer-mailgun-transport';
import * as mqtt from 'mqtt';

@Injectable()
export class PdfService {
  private client = mqtt.connect({
    host: process.env.MQTT_HOST,
    username: process.env.MQTT_USER,
    password: process.env.MQTT_PASSWORD,
  });

  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) { }

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
      this.logError('❌ Error al enviar el correo electrónico:', error);
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
      this.logError('❌ Error al enviar el correo electrónico:', error);
      return { success: false, message: 'Error al enviar el correo electrónico' };
    }
  }

  async enviarCorreoSeleccionarPdf(database, mailTo, idFactura, client_id, client_secret, tenant, entorno, companyID) {
    try {
      // Obtén todos los fragmentos asociados con el archivo
      const fragmentos = await this.obtenerFragmentosDeArchivo(idFactura, database, client_id, client_secret, tenant, entorno, companyID);

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
      this.logError('❌ Error al enviar el correo:', error);
      return { success: false, message: 'Error al enviar el correo' };
    }
  }

  async obtenerFragmentosDeArchivo(id, database, client_id, client_secret, tenant, entorno, companyID) {
    try {
      const token = await this.token.getToken2(client_id, client_secret, tenant);

      const res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices(${id})`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      const year = res.data.postingDate.split('-')[0];
      const sql = `SELECT BC_PDF FROM BC_SyncSales_${year} WHERE BC_IdSale = '${id}' ORDER BY HIT_DataFactura;`;
      const result = await this.sql.runSql(sql, database);

      // Convertir los fragmentos a buffers
      return result.recordset.map((row) => Buffer.from(row.BC_PDF, 'hex'));
    } catch (error) {
      this.logError(`❌ Error al obtener los fragmentos del archivo para el ID ${id}:`, error);
      throw error;
    }
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
      this.logError('❌ Error al descargar el archivo:', error);
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

  async subirPdf(id: string, archivoBase64: string, database: string, client_id: string, client_secret: string, tenant: string, entorno: string, companyID: string, endpoint: string) {
    try {
      let token = await this.token.getToken2(client_id, client_secret, tenant);
      // Convierte el Base64 a Buffer
      const bufferArchivo = Buffer.from(archivoBase64, 'base64');

      const res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/${endpoint}(${id})`, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      });

      const { postingDate, number } = res.data;
      const year = postingDate.split('-')[0];

      const pdfHex = bufferArchivo.toString('hex');

      const sql = `UPDATE BC_SyncSales_${year} SET BC_PDF=0x${pdfHex} WHERE BC_IdSale='${id}'`;
      await this.sql.runSql(sql, database);

      return { msg: 'Se ha insertado correctamente' };
    } catch (error) {
      this.logError(`❌ Error al insertar el PDF en la base de datos`, error);
      throw error;
    }
  }

  async reintentarSubidaPdf(id: string[], database: string, client_id: string, client_secret: string, tenant: string, entorno: string, companyID: string, endpoint: string) {
    // Obtener token
    const token = await this.token.getToken2(client_id, client_secret, tenant);
    for (const factura of id) {
      try {
        // Llamada al endpoint para obtener el PDF
        const url = `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/${endpoint}(${factura})/pdfDocument/pdfDocumentContent`;
        const response = await axios.get(url, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          responseType: 'arraybuffer',
        });

        const archivoBase64 = Buffer.from(response.data).toString('base64');

        if (!archivoBase64) {
          this.logError(`❌ No se encontró el contenido del PDF para el ID ${factura}`, new Error('Contenido del PDF no encontrado'));
          throw new Error(`No se encontró el contenido del PDF para el ID ${factura}`);
        }

        // Insertar el PDF en SQL llamando a la función existente
        const resultado = await this.subirPdf(factura, archivoBase64, database, client_id, client_secret, tenant, entorno, companyID, endpoint);
      } catch (error) {
        this.logError(`❌ Error al reintentar la subida del PDF con ID ${factura}:`, error);
        throw error;
      }
    }
    return true;
  }
  private logError(message: string, error: any) {
    const errorDetail = error?.response?.data || error?.message || 'Error desconocido';
    this.client.publish('/Hit/Serveis/Apicultor/Log', JSON.stringify({ message, error: errorDetail }));
    console.error(message, errorDetail);
  }
}
