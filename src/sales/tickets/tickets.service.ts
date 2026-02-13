import { Injectable } from '@nestjs/common';
import { getTokenService } from 'src/connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConnection.service';
import { getAzureSASTokenService } from 'src/connection/azureSASToken.service';
import axios from 'axios';
import * as mqtt from 'mqtt';
import * as moment from 'moment-timezone';
import { locationsService } from 'src/maestros/locations/locations.service';
import { customersService } from 'src/maestros/customers/customers.service';
import { itemsService } from 'src/maestros/items/items.service';
import { invoicesService } from 'src/sales/invoices/invoices.service';
import { helpersService } from 'src/helpers/helpers.service';
const { format } = require('@fast-csv/format');
import { BlobServiceClient } from '@azure/storage-blob';
import * as path from 'path';
import * as fs from 'fs';
import { Mutex } from 'async-mutex';
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
  private locks = new Map<string, Mutex>();

  constructor(
    private token: getTokenService,
    private sql: runSqlService,
    private locations: locationsService,
    private azureSASTokenService: getAzureSASTokenService,
    private customers: customersService,
    private invoices: invoicesService,
    private items: itemsService,
    private helpers: helpersService,
  ) { }

  private getLock(key: string): Mutex {
    if (!this.locks.has(key)) {
      this.locks.set(key, new Mutex());
    }
    return this.locks.get(key);
  }

  async syncTickets(companyID: string, database: string, client_id: string, client_secret: string, tenant: string, entorno: string, botiga: string[], diaManual?: string) {
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    if (!token) {
      this.logError('Error al obtener el token', { client_id, tenant });
      return false;
    }
    for (const licencia of botiga) {
      if (this.getLock(licencia).isLocked()) {
        console.log(`⏳ Esperando liberación del bloqueo para la tienda ${licencia} (Tickets)...`);
      }

      await this.getLock(licencia).runExclusive(async () => {
        let timestamp;
        let records = await this.sql.runSql(`SELECT * FROM records WHERE concepte = 'BC_Tickets_${licencia}'`, database);
        if (records.recordset.length > 0) {
          timestamp = new Date(records.recordset[0].TimeStamp).toISOString().slice(0, 19).replace('T', ' ');
        } else {
          const fixedDate = new Date(`2026-01-01T00:00:00Z`);
          timestamp = fixedDate.toISOString().slice(0, 19).replace('T', ' ');
          await this.sql.runSql(`INSERT INTO records (timestamp, concepte) VALUES ('${timestamp}', 'BC_Tickets_${licencia}')`, database);
        }
        let tickets;
        try {
          const timestampDate = new Date(timestamp);
          const now = new Date();

          let months: string[];
          let dateFilter: string;

          if (diaManual) {
            // Si es manual, solo miramos el mes del día solicitado. Forzamos formato ISO para evitar errores de locale.
            const manualDate = dayjs(diaManual).format("YYYY-MM-DD");
            months = [dayjs(diaManual).format("YYYY-MM")];
            dateFilter = `v.data BETWEEN CONVERT(DATETIME, '${manualDate} 00:00:00', 120) AND CONVERT(DATETIME, '${manualDate} 23:59:59', 120)`;
          } else {
            // Si es automático, miramos desde el último timestamp hasta ahora
            months = this.getMonthsBetween(timestampDate, now);
            dateFilter = `v.data > CONVERT(DATETIME, '${timestamp}', 120)`;
          }

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
                CASE WHEN v.estat <> '' THEN v.estat ELSE v.Botiga END AS Botiga,
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
              LEFT JOIN constantsclient cc ON cc.valor COLLATE SQL_Latin1_General_CP1_CI_AS = extracted.ClientCode
              LEFT JOIN clients c ON c.codi = cc.codi
              LEFT JOIN all_articles a ON a.Codi = v.Plu
              LEFT JOIN TipusIva ti ON ti.Tipus = a.TipoIva
              WHERE ${dateFilter} AND CASE WHEN v.Estat <> '' THEN v.Estat ELSE v.Botiga END = ${licencia}
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
          return;
        }

        try {
          // --- PASO 1: Sincronización de Maestros ---
          // Sincronizamos clientes, localizaciones y artículos antes de procesar tickets
          const nifsClientes = Array.from(new Set(tickets.recordset.map(ticket => (ticket as any).NIF_Client)))
            .filter(nif => nif && nif !== '22222222T') as string[];

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

          const plus = Array.from(new Set(tickets.recordset.map((ticket: any) => ticket.Plu as string))).filter(plu => plu);
          for (const plu of plus as string[]) {
            try {
              await this.items.getItemFromAPI(companyID, database, plu, client_id, client_secret, tenant, entorno);
            } catch (err) {
              this.logError(`⚠️ Error al obtener el artículo con PLU ${plu} para la tienda ${licencia}`, err);
            }
          }

          // --- PASO 2: Preparación de Días a Procesar ---
          const formatDate = (date, fmt = "YYYY-MM-DD") => dayjs(date).format(fmt);
          const formatDateUTC = (date, fmt = "YYYY-MM-DD-HHmm") => dayjs.utc(date).format(fmt);
          const ticketsConDia = tickets.recordset.map(ticket => ({
            ...ticket,
            dia: formatDate(ticket.Data as any),
          }));

          const hoy = dayjs().format("YYYY-MM-DD");

          let dias: string[];
          if (diaManual) {
            dias = [diaManual];
            console.log(`Modo manual: Procesando solo el día ${diaManual} para la tienda ${licencia}`);
          } else {
            // No procesamos el día actual para evitar tickets incompletos
            dias = Array.from(new Set(ticketsConDia.map(t => (t as any).dia)))
              .filter(dia => dia !== hoy) as string[];
            console.log(`Días a procesar para la tienda ${licencia} (sin incluir el actual ${hoy}):`, dias);
          }

          for (const dia of dias) {
            console.log(`Procesando día ${dia} para la tienda ${licencia}`);
            const ticketsDia = { recordset: ticketsConDia.filter(t => t.dia === dia) };
            const primerTicket = ticketsDia.recordset[0];
            const ultimoTicket = ticketsDia.recordset[ticketsDia.recordset.length - 1];

            if (!primerTicket || !ultimoTicket) {
              this.logError(`⚠️ No se encontraron tickets válidos para el día ${dia} en la tienda ${licencia}`, {});
              continue;
            }

            // --- PASO 3: Validaciones de Integridad ---
            try {
              const diaStr = dia as string;
              const year = diaStr.split('-')[0];
              const month = diaStr.split('-')[1];
              const day = Number(diaStr.split('-')[2]);

              // Comprobar saltos de ticket (números consecutivos)
              const ticketsRange = await this.sql.runSql(
                `SELECT MIN(num_tick) AS primerTick, MAX(num_tick) AS ultimTick
                 FROM [v_venut_${year}-${month}]
                 WHERE (CASE WHEN estat <> '' THEN estat ELSE botiga END) = ${licencia} AND DAY(Data) = ${day}`, database);
              const pTick = ticketsRange?.recordset[0]?.primerTick;
              const uTick = ticketsRange?.recordset[0]?.ultimTick;

              if (pTick && uTick) {
                const countRes = await this.sql.runSql(
                  `SELECT COUNT(DISTINCT num_tick) AS nTicks
                      FROM (
                          SELECT (CASE WHEN estat <> '' THEN estat ELSE botiga END) AS Botiga, Data, Num_tick FROM [v_venut_${year}-${month}]
                          UNION ALL
                          SELECT (CASE WHEN estat <> '' THEN estat ELSE botiga END) AS Botiga, Data, Num_tick FROM [V_Anulats_${year}-${month}]
                      ) v
                      WHERE Botiga = ${licencia} AND DAY(Data) = ${day} AND num_tick BETWEEN ${pTick} AND ${uTick}`, database
                );
                const nTicks = countRes.recordset[0]?.nTicks ?? 0;
                const esperat = uTick - pTick + 1;
                if (nTicks !== esperat) {
                  this.logError(`❌ Saltos de ticket detectados en tienda ${licencia} el día ${dia}. Esperados: ${esperat}, Encontrados: ${nTicks}. Se salta el día.`, {});
                  continue;
                }
              }

              // Comprobar descuadre de ventas contra movimiento de cierre Z
              const ventasTotal = await this.sql.runSql(
                `SELECT ISNULL(ROUND(SUM(import), 2),0) AS import
                 FROM [v_venut_${year}-${month}]
                 WHERE (CASE WHEN estat <> '' THEN estat ELSE botiga END) = ${licencia} AND DAY(Data) = ${day}`, database
              );
              const zMovements = await this.sql.runSql(
                `SELECT ISNULL(ROUND(SUM(import), 2),0) AS import
                 FROM [V_Moviments_${year}-${month}]
                 WHERE botiga = ${licencia} AND Tipus_moviment = 'Z' AND DAY(Data) = ${day} AND Import > 0`, database
              );
              const importVenut = ventasTotal.recordset[0]?.import || 0;
              const importZ = zMovements.recordset[0]?.import || 0;

              if (Math.abs(importZ - importVenut) > 0.05) { // Margen de 5 céntimos por redondeos
                this.logError(`❌ Descuadre de ventas vs Z en tienda ${licencia} el día ${dia}. Ventas: ${importVenut}, Z: ${importZ}. Se salta el día.`, {});
                continue;
              }
            } catch (valErr) {
              this.logError(`⚠️ Error ejecutando validaciones para el día ${dia}`, valErr);
              continue;
            }

            // --- PASO 4: Transferencia a Business Central ---
            try {
              const ultimaFechaSincronizada = ultimoTicket.Data;
              const nombreArchivo = `v_venut_${licencia}_${formatDateUTC(primerTicket.Data)}-${formatDateUTC(ultimoTicket.Data)}.csv`;
              console.log(`Generando CSV para los tickets del día ${dia} en la tienda ${licencia}: ${nombreArchivo}`);

              // 4.1 Generar CSV temporal
              console.log(`Exportando ${ticketsDia.recordset.length} tickets a CSV...`);
              await this.exportTicketsToCsv(ticketsDia, `./csvTickets/${nombreArchivo}`);

              // 4.2 Cargar CSV a tabla intermedia en BC
              const base64Csv = await this.csvToBase64(`./csvTickets/${nombreArchivo}`);

              await this.callImport(base64Csv, nombreArchivo, entorno, tenant, client_id, client_secret, companyID);

              // 4.3 Consolidar tickets en facturas
              await this.ticketsToInvoice(licencia, formatDate(ultimoTicket.Data), entorno, tenant, client_id, client_secret, companyID);

              // 4.4 Registrar (Post) facturas creadas
              // Usamos VENTAS_ por consistencia, truncando a 35 para BC.
              const rawInvoiceNumber = `VENTAS_${licencia}_${formatDate(ultimaFechaSincronizada, "YYYYMMDD")}`;
              const invoiceNumber = rawInvoiceNumber.length > 35 ? rawInvoiceNumber.substring(0, 35) : rawInvoiceNumber;
              console.log(`Buscando factura con externalDocumentNumber: ${invoiceNumber}`);

              const idsFactura = await this.getInvoiceID(companyID, invoiceNumber, client_id, client_secret, tenant, entorno);

              for (const idFactura of idsFactura || []) {
                await this.invoices.postInvoice(companyID, idFactura, client_id, client_secret, tenant, entorno, "salesInvoices");
              }

              // --- FINAL: Éxito ---
              // Solo si todo ha salido bien (import, convertir, registrar), avanzamos el timestamp local
              if (ultimaFechaSincronizada && !diaManual) {
                const ts = new Date(ultimaFechaSincronizada).toISOString().slice(0, 19).replace("T", " ");
                await this.sql.runSql(`UPDATE records SET TimeStamp = '${ts}' WHERE concepte = 'BC_Tickets_${licencia}'`, database);
              }

              // Limpiar archivo temporal
              await fs.promises.unlink(`./csvTickets/${nombreArchivo}`).catch(err => {
                this.logError(`⚠️ No se pudo eliminar el archivo ${nombreArchivo}`, err);
              });

            } catch (error) {
              // Si algo falló en BC, la transacción en BC se ha revertido.
              // No actualizamos timestamp local, así que reintentará el día entero en la próxima ejecución.
              this.logError(`❌ Error procesando tickets del día ${dia} en la tienda ${licencia}`, error);
              continue;
            }
          }
        } catch (error) {
          this.logError("❌ Error general al procesar tickets", error);
          return false;
        }
      });
    }
    return true;
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
          NIF: this.helpers.normalizeNIF(record.NIF_Client || ''),
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

  async callImport(base64Csv: string, fileName: string, entorno: string, tenant: string, client_id: string, client_secret: string, companyId: string) {
    console.log("Iniciando importación en Business Central desde Base64...");

    let token = await this.token.getToken2(client_id, client_secret, tenant);

    const getcompanyName = await axios.get(
      `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyId})`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );
    const companyName = getcompanyName.data.name;
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

  async ticketsToInvoice(botiga: string, fecha: string, entorno: string, tenant: string, client_id: string, client_secret: string, companyId: string) {
    console.log("Iniciando conversión de tickets a facturas en Business Central...");
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    const getcompanyName = await axios.get(
      `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyId})`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );
    const companyName = getcompanyName.data.name;
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
    const url = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices?$filter=startswith(externalDocumentNumber, '${invoiceNumber}')`;
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
    const errorDetail = error?.response?.data || error?.message || 'Error desconocido';
    this.client.publish('/Hit/Serveis/Apicultor/Log', JSON.stringify({ message, error: errorDetail }));
    console.error(message, errorDetail);
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
