import { Injectable } from '@nestjs/common';
import { getTokenService } from '../conection/getToken.service';
import { runSqlService } from 'src/conection/sqlConection.service';
import * as nodemailer from 'nodemailer';
import axios from 'axios';
import * as mailgunTransport from 'nodemailer-mailgun-transport';

@Injectable()
export class PdfService {
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
          pass: process.env.EMAIL_PASSWORD // Reemplaza con tu contraseña de Gmail
        }
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

  async enviarCorreoSMTPConPdf(pdfData, mailTo) {
    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SLS_SMTPSERVER,
        port: process.env.SLN_SMTPSERVERPORT,
        secure: process.env.SLB_SMTPUSESSL,
        auth: {
          user: process.env.SLS_SMTPUSERNAME,
          pass: process.env.SLS_SMTPPASSWORD
        }
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
            encoding: 'base64'
          }
        ]
      };

      const info = await transporter.sendMail(mailOptions);
      console.log('Correo enviado:', info);

      return { success: true };
    } catch (error) {
      console.error('Error al enviar el correo electrónico:', error);
      return { success: false, message: 'Error al enviar el correo electrónico' };
    }
  }

  async enviarCorreoSeleccionarPdf(database, mailTo, idFactura) {
    try {
      // Obtén todos los fragmentos asociados con el archivo
      const fragmentos = await this.obtenerFragmentosDeArchivo(idFactura, database);

      // Verifica si el archivo existe
      if (!fragmentos || fragmentos.length === 0) {
        console.log("Archivo solicitado no existe")
        return { success: false, message: "El archivo solicitado no existe" };
      }

      // Concatena todos los fragmentos para reconstruir el archivo original
      const archivoCompleto = Buffer.concat(fragmentos);

      // Envía el PDF por correo electrónico
      await this.enviarCorreoConPdf(archivoCompleto, mailTo);
    } catch (error) {
      console.error("Error al enviar el correo:", error);
      return { success: false, message: "Error al enviar el correo" };
    }
  }

  async obtenerFragmentosDeArchivo(id: string, database: string) {
    // Realiza una consulta SQL para recuperar los fragmentos asociados con el archivo
    const sql = `
      SELECT BC_PDF FROM BC_SyncSales_2024 WHERE BC_IdSale = '${id}' ORDER BY HIT_DataFactura;
    `;
    let pdf;
    try {
      pdf = await this.sql.runSql(sql, database,);
    } catch {
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
      await this.enviarCorreoConPdf(archivoCompleto, process.env.miCorreo);

      // Devuelve el PDF
      return { success: true, pdfData: archivoCompleto };
    } catch (error) {
      console.error("Error al descargar el archivo:", error);
      return { success: false, message: "Error al descargar el archivo" };
    }
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
      for (let i = 0; i < chunks.length; i++) {
        const descripcion = `part ${i}`;
        /*
        const sql = `
          INSERT INTO archivo (id, nombre, extension, descripcion, archivo)
          VALUES (newid(), '${nombre}', 'PDF', '${descripcion}', 0x${chunks[i]})
        `;
        */

        let res = await axios
        .get(
          `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices?$filter=id eq '${id}'`,
          {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          },
        )
        .catch((error) => {
          throw new Error('Failed get category');
        });

        let mes = "06";
        let año = "2024";
        let EmpresaCodi = 0;
        let Serie = 'ABC123';
        let DataInici = new Date('2023-01-01T00:00:00Z');
        let DataFi = new Date('2023-12-31T23:59:59Z');
        let DataFactura = new Date('2023-06-15T12:00:00Z');
        let DataEmissio = new Date('2023-06-15T12:00:00Z');
        let DataVenciment = new Date('2023-07-15T12:00:00Z');
        let FormaPagament = 'Tarjeta';
        let Total = 1234.56;
        let ClientCodi = 1001;
        let ClientCodiFac = 'FAC1001';
        let ClientNom = 'Nombre del Cliente';
        let ClientNif = 'NIF12345678';
        let ClientAdresa = 'Calle Falsa 123';
        let ClientCp = '08001';
        let Tel = '123456789';
        let Fax = '987654321';
        let eMail = 'cliente@example.com';
        let ClientLiure = 'Observaciones del Cliente';
        let ClientCiutat = 'Ciudad del Cliente';
        let EmpNom = 'Nombre de la Empresa';
        let EmpNif = 'NIF87654321';
        let EmpAdresa = 'Avenida Siempre Viva 742';
        let EmpCp = '08002';
        let EmpTel = '987654321';
        let EmpFax = '123456789';
        let EmpMail = 'empresa@example.com';
        let EmpLliure = 'Observaciones de la Empresa';
        let EmpCiutat = 'Ciudad de la Empresa';
        let CampMercantil = 'Mercantil';
        let BaseIva1 = 100.0;
        let Iva1 = 21.0;
        let BaseIva2 = 200.0;
        let Iva2 = 10.0;
        let BaseIva3 = 300.0;
        let Iva3 = 4.0;
        let BaseIva4 = 400.0;
        let Iva4 = 0.0;
        let BaseRec1 = 50.0;
        let Rec1 = 5.0;
        let BaseRec2 = 60.0;
        let Rec2 = 6.0;
        let BaseRec3 = 70.0;
        let Rec3 = 7.0;
        let BaseRec4 = 80.0;
        let Rec4 = 8.0;
        let valorIva1 = 21.0;
        let valorIva2 = 20.0;
        let valorIva3 = 12.0;
        let valoraIva4 = 0.0;
        let valorRec1 = 5.0;
        let valorRec2 = 6.0;
        let valorRec3 = 7.0;
        let valorRec4 = 8.0;
        let IvaRec1 = 1.05;
        let IvaRec2 = 0.6;
        let IvaRec3 = 0.28;
        let IvaRec4 = 0.0;
        let Reservat = 'V1.20040304';

        const sql = `UPDATE BC_SyncSales_2024 SET BC_PDF=0x${chunks[i]} WHERE BC_IdSale='${id}'`;
        const sql2 = `INSERT INTO [facturacio_${año}-${mes}_iva] 
        (IdFactura, NumFactura, EmpresaCodi, Serie, DataInici, DataFi, DataFactura, DataEmissio, DataVenciment, FormaPagament, Total, ClientCodi, ClientCodiFac, ClientNom, ClientNif, ClientAdresa, ClientCp, Tel, Fax, eMail, ClientLiure, ClientCiutat, EmpNom, EmpNif, EmpAdresa, EmpCp, EmpTel, EmpFax, EmpMail, EmpLliure, EmpCiutat, CampMercantil, BaseIva1, Iva1, BaseIva2, Iva2, BaseIva3, Iva3, BaseIva4, Iva4, BaseRec1, Rec1, BaseRec2, Rec2, BaseRec3, Rec3, BaseRec4, Rec4, valorIva1, valorIva2, valorIva3, valoraIva4, valorRec1, valorRec2, valorRec3, valorRec4, IvaRec1, IvaRec2, IvaRec3, IvaRec4, Reservat)
        NEWID(), ${id}, ${EmpresaCodi}, ${Serie}, ${DataInici}, ${DataFi}, ${DataFactura}, ${DataEmissio}, ${DataVenciment}, ${FormaPagament}, ${Total}, ${ClientCodi}, ${ClientCodiFac}, ${ClientNom}, ${ClientNif}, ${ClientAdresa}, ${ClientCp}, ${Tel}, ${Fax}, ${eMail}, ${ClientLiure}, ${ClientCiutat}, ${EmpNom}, ${EmpNif}, ${EmpAdresa}, ${EmpCp}, ${EmpTel}, ${EmpFax}, ${EmpMail}, ${EmpLliure}, ${EmpCiutat}, ${CampMercantil}, ${BaseIva1}, ${Iva1}, ${BaseIva2}, ${Iva2}, ${BaseIva3}, ${Iva3}, ${BaseIva4}, ${Iva4}, ${BaseRec1}, ${Rec1}, ${BaseRec2}, ${Rec2}, ${BaseRec3}, ${Rec3}, ${BaseRec4}, ${Rec4}, ${valorIva1}, ${valorIva2}, ${valorIva3}, ${valoraIva4}, ${valorRec1}, ${valorRec2}, ${valorRec3}, ${valorRec4}, ${IvaRec1}, ${IvaRec2}, ${IvaRec3}, ${IvaRec4}, ${Reservat});`;
        let pdf;
        let factura;
        try {
          pdf = await this.sql.runSql(sql, database);
          //factura =  await this.sql.runSql(sql2,database);
        } catch {
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