import { Injectable } from '@nestjs/common';
import { getTokenService } from 'src/connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConnection.service';
import axios from 'axios';
import * as mqtt from 'mqtt';

@Injectable()
export class documentAttachmentsService {
  private client = mqtt.connect({
    host: process.env.MQTT_HOST,
    username: process.env.MQTT_USER,
    password: process.env.MQTT_PASSWORD,
  });

  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) { }

  async syncDocumentAttachments(companyID: string, database: string, nombreFactura: string, id: string, client_id: string, client_secret: string, tenant: string, entorno: string) {
    const token = await this.token.getToken2(client_id, client_secret, tenant);

    const safeNombreFactura = String(nombreFactura).replace(/'/g, "''");
    const query = `SELECT * FROM archivo WHERE descripcion = '${safeNombreFactura}' and extension = 'PDF'`;
    const pdf = await this.sql.runSql(query, database);

    if (!pdf.recordset || pdf.recordset.length === 0) {
      this.logError(`No se encontro el archivo con nombre ${nombreFactura} en la base de datos ${database}`, null);
      return false;
    }

    const fileContent = pdf.recordset[0]?.archivo;
    if (!fileContent) {
      this.logError(`El archivo PDF de la factura ${nombreFactura} no contiene datos validos`, null);
      return false;
    }

    const pdfBuffer = Buffer.isBuffer(fileContent)
      ? fileContent
      : this.hexToBuffer(String(fileContent));

    const url = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/documentAttachments`;
    const fileName = `${nombreFactura}.pdf`;

    const body = {
      parentId: id,
      parentType: 'Purchase Invoice',
      fileName,
    };

    const config = {
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
    };

    try {
      console.log('Enviando archivo a Business Central...');
      const response = await axios.post(url, body, config);
      const attachmentUrl = response.data?.['@odata.id'] || this.getAttachmentUrl(url, response.data?.id);
      await this.uploadAttachmentContent(attachmentUrl, pdfBuffer, token);
      console.log('Archivo adjuntado correctamente.');
      return true;
    } catch (error) {
      this.logError('Error al subir el archivo:', error);
      return false;
    }
  }

  private hexToBuffer(hexString: string): Buffer {
    const cleanHex = hexString.startsWith('0x') ? hexString.slice(2) : hexString;
    return Buffer.from(cleanHex, 'hex');
  }

  private getAttachmentUrl(url: string, attachmentId?: string): string {
    if (!attachmentId) {
      throw new Error('Business Central no devolvio el id del documentAttachment creado');
    }
    return `${url}(${attachmentId})`;
  }

  private async uploadAttachmentContent(attachmentUrl: string, pdfBuffer: Buffer, token: string) {
    const contentUrl = `${attachmentUrl}/attachmentContent`;

    await axios.patch(contentUrl, pdfBuffer, {
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/pdf',
        'If-Match': '*',
      },
    });
  }

  private logError(message: string, error: any) {
    const errorDetail = error?.response?.data || error?.message || 'Error desconocido';
    this.client.publish('/Hit/Serveis/Apicultor/Log', JSON.stringify({ message, error: errorDetail }));
    console.error(message, errorDetail);
  }
}
