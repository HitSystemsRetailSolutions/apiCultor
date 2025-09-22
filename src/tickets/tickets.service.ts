import { Injectable } from '@nestjs/common';
import { getTokenService } from '../connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConection.service';
import { getAzureSASTokenService } from 'src/connection/azureSASToken.service';
import axios from 'axios';
import * as mqtt from 'mqtt';
import * as moment from 'moment-timezone';
import { locationsService } from 'src/locations/locations.service';
import { customersService } from 'src/customers/customers.service';
import { salesFacturasService } from 'src/sales/salesFacturas.service';
const { format } = require('@fast-csv/format');
import { BlobServiceClient } from '@azure/storage-blob';
import * as path from 'path';
import * as fs from 'fs';
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
dayjs.extend(utc);

@Injectable()
export class ticketsService {
  private client = mqtt.connect({
    host: process.env.MQTT_HOST,
    username: process.env.MQTT_USER,
    password: process.env.MQTT_PASSWORD,
  });
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
    private locations: locationsService,
    private azureSASTokenService: getAzureSASTokenService,
    private customers: customersService,
    private salesFacturas: salesFacturasService,
  ) { }

  async syncTickets(companyID: string, database: string, client_id: string, client_secret: string, tenant: string, entorno: string, botiga: string[], companyName: string) {
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    if (!token) {
      this.logError('Error al obtener el token', { client_id, tenant });
      return false;
    }
    for (const licencia of botiga) {

      let timestamp;
      let records = await this.sql.runSql(`SELECT * FROM records WHERE concepte = 'BC_Tickets_${licencia}'`, database);
      if (records.recordset.length > 0) {
        timestamp = new Date(records.recordset[0].TimeStamp).toISOString().slice(0, 19).replace('T', ' ');
      } else {
        const year = new Date().getFullYear();
        const month = (new Date().getMonth() + 1).toString().padStart(2, '0');
        let tsResult = await this.sql.runSql(`SELECT MIN(Data) as timestamp FROM [v_venut_${year}-${month}] WHERE Botiga = ${licencia}`, database);
        timestamp = new Date(tsResult.recordset[0].timestamp).toISOString().slice(0, 19).replace('T', ' ');
        await this.sql.runSql(`INSERT INTO records (timestamp, concepte) VALUES ('${timestamp}', 'BC_Tickets_${licencia}')`, database);
      }
      let tickets;
      try {
        const timestampDate = new Date(timestamp);
        const now = new Date();
        const months = this.getMonthsBetween(timestampDate, now);
        const unionQueries = months
          .map((m) => `SELECT * FROM [v_venut_${m}]`)
          .join('\nUNION ALL\n');

        const query =
          `;WITH all_articles AS (
                SELECT Codi, Nom, TipoIva FROM articles
                UNION ALL
                SELECT Codi, Nom, TipoIva FROM articles_zombis
           ),
           v_venut_union AS (
             ${unionQueries}
           )
          SELECT 
            v.Botiga,
            v.Data,
            d.MEMO AS Dependenta,
            v.Num_tick,
            v.Plu,
            v.Quantitat,
            v.Import,
            ti.Iva,
            v.Tipus_venta,
            v.FormaMarcar,
            CASE
                WHEN v.otros LIKE '%tarjeta%' THEN 'Paytef'
                WHEN v.otros LIKE '%3g%' THEN '3g'
                ELSE 'Efectivo'
            END AS MetodoPago,
            c.nif AS NIF_Client
          FROM v_venut_union v
          LEFT JOIN Dependentes d ON d.Codi = v.Dependenta
          OUTER APPLY (
              SELECT
                  CASE 
                      WHEN CHARINDEX('[Id:', v.otros) > 0 
                          AND CHARINDEX(']', v.otros, CHARINDEX('[Id:', v.otros)) > 0
                      THEN SUBSTRING(
                              v.otros,
                              CHARINDEX('[Id:', v.otros) + 4,
                              CHARINDEX(']', v.otros, CHARINDEX('[Id:', v.otros)) 
                                  - CHARINDEX('[Id:', v.otros) - 4
                          )
                      ELSE NULL
                  END AS ClientCode
          ) extracted
          LEFT JOIN constantsclient cc ON cc.valor = extracted.ClientCode
          LEFT JOIN clients c ON c.codi = cc.codi
          LEFT JOIN all_articles a ON a.Codi = v.Plu
          LEFT JOIN TipusIva ti ON ti.Tipus = a.TipoIva
          WHERE v.data >= '${timestamp}' AND v.botiga = ${licencia}
          ORDER BY v.Data, v.Num_tick;
          `
        tickets = await this.sql.runSql(query, database);
      } catch (error) {
        this.logError(`❌ Error al ejecutar la consulta SQL en la base de datos '${database}'`, error);
        return false;
      }
      if (tickets.recordset.length == 0) {
        this.client.publish('/Hit/Serveis/Apicultor/Log', 'No hay registros de previsiones de ventas');
        console.warn(`⚠️ Advertencia: No se encontraron registros de previsiones de ventas`);
        continue;
      }

      try {
        const nifsClientes = Array.from(new Set(tickets.recordset.map(ticket => ticket.NIF_Client))).filter(nif => nif);
        for (const nif of nifsClientes) {
          try {
            await this.customers.getCustomerFromAPI(companyID, database, nif, client_id, client_secret, tenant, entorno);
          } catch (err) {
            this.logError(`⚠️ Error al obtener cliente con NIF ${nif} para la tienda ${licencia}`, err);
          }
        }

        try {
          await this.locations.getLocationFromAPI(companyID, database, licencia, client_id, client_secret, tenant, entorno);
        } catch (err) {
          this.logError(`⚠️ Error al obtener localización para la tienda ${licencia}`, err);
        }
        const formatDate = (date, fmt = "YYYY-MM-DD") => dayjs(date).format(fmt);
        const formatDateUTC = (date, fmt = "YYYY-MM-DD-HHmm") => dayjs.utc(date).format(fmt);
        const ticketsConDia = tickets.recordset.map(ticket => ({
          ...ticket,
          dia: formatDate(ticket.Data),
        }));
        // 🔹 Obtener días únicos
        const dias = Array.from(new Set(ticketsConDia.map(t => t.dia)));
        console.log(`Días a procesar para la tienda ${licencia}:`, dias);

        for (const dia of dias) {
          console.log(`Procesando día ${dia} para la tienda ${licencia}`);
          const ticketsDia = { recordset: ticketsConDia.filter(t => t.dia === dia) };
          const primerTicket = ticketsDia.recordset[0];
          const ultimoTicket = ticketsDia.recordset[ticketsDia.recordset.length - 1];

          if (!primerTicket || !ultimoTicket) {
            this.logError(`⚠️ No se encontraron tickets válidos para el día ${dia} en la tienda ${licencia}`, {});
            continue;
          }

          try {

            const ultimaFechaSincronizada = ultimoTicket.Data;
            const nombreArchivo = `v_venut_${licencia}_${formatDateUTC(primerTicket.Data)}-${formatDateUTC(ultimoTicket.Data)}.csv`;
            console.log(`Generando CSV para los tickets del día ${dia} en la tienda ${licencia}: ${nombreArchivo}`);

            // Generar CSV con los tickets del día
            console.log(`Exportando ${ticketsDia.recordset.length} tickets a CSV...`);
            await this.exportTicketsToCsv(ticketsDia, `./csvTickets/${nombreArchivo}`);

            //Convertir csv a base64
            const base64Csv = await this.csvToBase64(`./csvTickets/${nombreArchivo}`);

            // Llamar al codeunit de BC para importar el CSV a la tabla intermedia de tickets
            await this.callImport(base64Csv, nombreArchivo, entorno, tenant, client_id, client_secret, companyName);

            // Llamar al codeunit de BC para convertir los tickets en facturas (esto es lo que tarda más porque la tarea la hace BC y tiene sus comprobaciones)
            await this.ticketsToInvoice(licencia, formatDate(ultimoTicket.Data), entorno, tenant, client_id, client_secret, companyName);

            // Obtener el ids de la facturas sin registrar
            const invoiceNumber = `VENTAS_${licencia}_${formatDate(ultimaFechaSincronizada)}`;
            console.log(`Buscando factura con externalDocumentNumber: ${invoiceNumber}`);

            const idsFactura = await this.getInvoiceID(companyID, invoiceNumber, client_id, client_secret, tenant, entorno);

            // Registrar la factura para que no se pueda editar
            for (const idFactura of idsFactura || []) {
              await this.salesFacturas.postInvoice(companyID, idFactura, client_id, client_secret, tenant, entorno, "salesInvoices");
            }
            // Eliminar archivo temporal
            await fs.promises.unlink(`./csvTickets/${nombreArchivo}`).catch(err => {
              this.logError(`⚠️ No se pudo eliminar el archivo ${nombreArchivo}`, err);
            });

            // Actualizar último timestamp en Records
            if (ultimaFechaSincronizada) {
              const ts = new Date(ultimaFechaSincronizada).toISOString().slice(0, 19).replace("T", " ");
              await this.sql.runSql(`UPDATE records SET TimeStamp = '${ts}' WHERE concepte = 'BC_Tickets_${licencia}'`, database);
            }

          } catch (error) {
            this.logError(`❌ Error procesando tickets del día ${dia} en la tienda ${licencia}`, error);
            continue;
          }
        }
        return true;

      } catch (error) {
        this.logError("❌ Error general al procesar tickets", error);
        return false;
      }
    }
  }

  async exportTicketsToCsv(tickets, outputPath) {
    // Si el archivo ya existe, eliminarlo primero
    if (fs.existsSync(outputPath)) {
      await fs.promises.unlink(`${outputPath}`).catch(err => {
        this.logError(`⚠️ No se pudo eliminar el archivo ${outputPath}`, err);
      });
    }
    return new Promise<void>((resolve, reject) => {
      const ws = fs.createWriteStream(outputPath);
      const csvStream = format({ headers: true, delimiter: ';' });

      csvStream.pipe(ws)
        .on('finish', () => {
          console.log(`✅ CSV generado en: ${outputPath}`);
          resolve();
        })
        .on('error', reject);

      tickets.recordset.forEach(record => {
        const tmst = moment.utc(record.Data).tz('Europe/Madrid', true).format('YYYY-MM-DDTHH:mm:ss.SSSZ');

        csvStream.write({
          Botiga: record.Botiga,
          Data: tmst,
          Dependenta: record.Dependenta,
          Num_tick: record.Num_tick,
          Plu: record.Plu,
          Quantitat: record.Quantitat,
          Import: record.Import,
          IVA: `IVA${record.Iva}`,
          Tipus_venta: record.Tipus_venta,
          FormaMarcar: record.FormaMarcar,
          MetodoPago: record.MetodoPago,
          NIF: record.NIF_Client || '',
          Procesado: false
        });
      });
      csvStream.end();
    });
  }

  private async uploadCsvToAzure(localFilePath: string, containerUrlWithSAS: string, blobName?: string) {
    try {
      // 1. Crear client del contenidor amb la URL + SAS
      const containerClient = new BlobServiceClient(containerUrlWithSAS).getContainerClient('tickets');

      // 2. Definir el nom del blob (si no es passa, es fa servir el nom del fitxer local)
      const finalBlobName = blobName || path.basename(localFilePath);
      const blockBlobClient = containerClient.getBlockBlobClient(finalBlobName);

      // 3. Llegir el fitxer local
      const fileStream = fs.createReadStream(localFilePath);
      const stat = fs.statSync(localFilePath);

      console.log(`⬆️ Pujant ${localFilePath} a Azure Blob Storage (SAS)...`);
      await blockBlobClient.uploadStream(fileStream, stat.size, 5, {
        blobHTTPHeaders: { blobContentType: 'text/csv' },
      });

      console.log(`✅ CSV pujat correctament: ${blockBlobClient.url}`);
      return blockBlobClient.url;
    } catch (err) {
      this.logError('❌ Error pujant el CSV a Azure amb SAS', err);
      throw err;
    }
  }

  private async csvToBase64(filePath: string): Promise<string> {
    try {
      console.log(`Convirtiendo CSV a Base64: ${filePath}`);
      return new Promise((resolve, reject) => {
        fs.readFile(filePath, (err, data) => {
          if (err) {
            reject(`❌ Error llegint el fitxer: ${err.message}`);
            return;
          }
          const base64Content = data.toString("base64");
          resolve(base64Content);
        });
      });
    } catch (error) {
      this.logError(`❌ Error al pasar el csv a Base64: ${filePath}`, error);
      throw error;
    }
  }

  private getMonthsBetween(startDate: Date, endDate: Date) {
    const months = [];
    const date = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    while (date <= endDate) {
      const y = date.getFullYear();
      const m = (date.getMonth() + 1).toString().padStart(2, '0');
      months.push(`${y}-${m}`);
      date.setMonth(date.getMonth() + 1);
    }
    return months;
  }

  async callImport(base64Csv: string, fileName: string, entorno: string, tenant: string, client_id: string, client_secret: string, companyName: string) {
    console.log("Iniciando importación en Business Central desde Base64...");

    let token = await this.token.getToken2(client_id, client_secret, tenant);

    // Escapar correctamente los valores para XML
    const safeCsv = this.escapeXml(base64Csv);
    const safeFileName = this.escapeXml(fileName);

    const soapEnvelope = `
      <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
                    xmlns:tns="urn:microsoft-dynamics-schemas/codeunit/ImportVVenut">
        <soap:Header/>
        <soap:Body>
          <tns:ImportFromBase64>
            <tns:base64Csv>${safeCsv}</tns:base64Csv>
            <tns:fileName>${safeFileName}</tns:fileName>
          </tns:ImportFromBase64>
        </soap:Body>
      </soap:Envelope>`.trim();

    const response = await axios.post(
      `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${entorno}/WS/${companyName}/Codeunit/ImportVVenut`,
      soapEnvelope,
      {
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "text/xml; charset=utf-8",
          SOAPAction:
            "urn:microsoft-dynamics-schemas/codeunit/ImportVVenut:ImportFromBase64",
        },
      }
    );
    console.log("✅ Respuesta de BC:", response.data);
  }

  async ticketsToInvoice(botiga: string, fecha: string, entorno: string, tenant: string, client_id: string, client_secret: string, companyName: string) {
    console.log("Iniciando conversión de tickets a facturas en Business Central...");
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    const soapEnvelope = `
      <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
                    xmlns:tns="urn:microsoft-dynamics-schemas/codeunit/Ticketstoinvoice">
        <soap:Header/>
        <soap:Body>
          <tns:ConsolidateTickets>
            <tns:processDate>${fecha}</tns:processDate>
            <tns:locationCode>${botiga}</tns:locationCode>
          </tns:ConsolidateTickets>
        </soap:Body>
      </soap:Envelope>`.trim();
    const response = await axios.post(
      `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${entorno}/WS/${companyName}/Codeunit/Ticketstoinvoice`,
      soapEnvelope,
      {
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "text/xml; charset=utf-8",
          SOAPAction:
            "urn:microsoft-dynamics-schemas/codeunit/Ticketstoinvoice:ConsolidateTickets",
        },
      }
    );
    console.log("✅ Respuesta de BC:", response.data);
  }
  async getInvoiceID(companyID: string, invoiceNumber: string, client_id: string, client_secret: string, tenant: string, entorno: string): Promise<string[] | null> {
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    if (!token) {
      this.logError('Error al obtener el token', { client_id, tenant });
      return null;
    }
    const url = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices?$filter=externalDocumentNumber eq '${invoiceNumber}'`;
    try {
      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      if (response?.data?.value && response.data.value.length > 0) {
        //devolver todos los ids si hay más de uno
        return response?.data?.value?.map(inv => inv.id) ?? [];
      }
    } catch (error) {
      this.logError('Error al obtener el ID de la factura', { companyID, invoiceNumber, error });
    }
    return null;
  }

  private logError(message: string, error: any) {
    this.client.publish('/Hit/Serveis/Apicultor/Log', JSON.stringify({ message, error: error.response?.data || error.message }));
    console.error(message, error.response?.data || error.message);
  }

  private escapeXml(unsafe: string): string {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

}
