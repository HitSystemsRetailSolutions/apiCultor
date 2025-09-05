import { Injectable } from '@nestjs/common';
import { getTokenService } from '../connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConection.service';
import { itemsService } from 'src/items/items.service';
import { customersService } from 'src/customers/customers.service';
import { locationsService } from 'src/locations/locations.service';
import axios from 'axios';
import * as mqtt from 'mqtt';
import * as pLimit from 'p-limit';

@Injectable()
export class salesTicketsService {
  private client = mqtt.connect({
    host: process.env.MQTT_HOST,
    username: process.env.MQTT_USER,
    password: process.env.MQTT_PASSWORD,
  });

  constructor(
    private tokenService: getTokenService,
    private sqlService: runSqlService,
    private items: itemsService,
    private customers: customersService,
    private locations: locationsService,
  ) { }

  async syncVentas(dayStart, dayEnd, month, year, companyID, database, botiga, client_id: string, client_secret: string, tenant: string, entorno: string) {
    if (tenant === process.env.tenaTenant) return;
    try {
      for (let day = dayStart; day <= dayEnd; day++) {
        console.log(`📅 Procesando ventas para el día ${day}/${month}/${year}...`);
        let token = await this.tokenService.getToken2(client_id, client_secret, tenant);
        const sqlHora = await this.sqlService.runSql(
          `select CONVERT(VARCHAR(8), CONVERT(Time, Data), 108) AS hora, Import from [V_Moviments_${year}-${month}] where botiga = ${botiga} and Tipus_moviment = 'Z' and day(data)=${day} group by Data, Import order by Data`,
          database,
        );
        let horaAnterior = '00:01:00';
        for (let i = 0; i < sqlHora.recordset.length; i++) {
          const horaActual = sqlHora.recordset[i].hora;
          let ventasID_BC = '';
          let numFactura = '';
          try {
            const sqlRangoTicket = await this.sqlService.runSql(
              `SELECT MAX(num_tick) AS maximo, MIN(num_tick) AS minimo FROM [v_venut_${year}-${month}] where botiga=${botiga} and day(data)=${day} and CONVERT(TIME, data) BETWEEN '${horaAnterior}' AND '${horaActual}'`,
              database,
            );

            const sqlVentas = await this.sqlService.runSql(
              `;WITH PrecioUnitarioCalculado AS (
              SELECT  
              v.plu,
              v.Import / NULLIF(v.Quantitat, 0) AS precioUnitario,
              v.quantitat,
              v.data,
              v.Tipus_venta,
              c.codi AS ClientCodi,
              c.nom as nombreTienda,
              i.iva as Iva,
              CASE 
                  WHEN v.Tipus_venta = 'V' THEN 0 
                  WHEN v.Tipus_venta LIKE 'Desc_%' THEN CAST(SUBSTRING(v.Tipus_venta, 6, LEN(v.Tipus_venta) - 5) AS INT) 
                  ELSE NULL 
              END AS descuento
              FROM [v_venut_${year}-${month}] v 
              LEFT JOIN clients c ON v.botiga = c.codi
              LEFT JOIN articles a ON v.plu = a.codi
              LEFT JOIN articles_zombis az ON v.plu = az.codi AND a.codi IS NULL
              LEFT JOIN tipusiva_historial i ON COALESCE(a.TipoIva, az.TipoIva) = i.Tipus
                AND v.data >= COALESCE(i.Desde, '1900-01-01')
                AND (i.Hasta IS NULL OR v.data <= i.Hasta)
              WHERE v.botiga = ${botiga} 
                AND DAY(v.data) = ${day} 
                AND CONVERT(TIME, v.data) BETWEEN '${horaAnterior}' AND '${horaActual}')
              SELECT ROW_NUMBER() OVER (ORDER BY plu) * 1000 AS lineNumber,ClientCodi, nombreTienda, MIN(CONVERT(DATE, data)) AS Data,Plu,round (precioUnitario,5) AS UnitPrice, SUM(quantitat) AS Quantitat,Iva,Descuento
              FROM PrecioUnitarioCalculado puc
              GROUP BY ClientCodi, nombreTienda, plu, precioUnitario, descuento, iva
              order by plu`,
              database,
            );

            horaAnterior = horaActual;

            if (sqlVentas.recordset.length == 0) {
              console.warn(`⚠️ No hay ventas para la tienda ${botiga} del día ${day}/${month}/${year} en el turno de ${horaAnterior} a ${horaActual}`);
              continue;
            }
            const x = sqlVentas.recordset[0];
            const datePart = x.Data.toISOString().split('T')[0];
            numFactura = `${x.nombreTienda}_T${i + 1}_${sqlRangoTicket.recordset[0].minimo}-${sqlRangoTicket.recordset[0].maximo}`;

            console.log(`-------------------SINCRONIZANDO VENTAS ${numFactura} -----------------------`);
            const customerId = await this.customers.getCustomerFromAPI(companyID, database, `22222222T`, client_id, client_secret, tenant, entorno);

            let res;
            try {
              res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices?$filter=externalDocumentNumber eq '${numFactura}'`, {
                headers: {
                  Authorization: 'Bearer ' + token,
                  'Content-Type': 'application/json',
                },
              });
            } catch (error) {
              this.logError(`❌ Error consultando factura en BC con número ${numFactura}`, error);
              continue;
            }

            let salesInvoiceData = {
              externalDocumentNumber: numFactura,
              invoiceDate: datePart,
              postingDate: datePart,
              customerId: customerId,
              salesInvoiceLines: [],
            };

            let salesInvoiceData2 = {
              LocationCode: `${x.ClientCodi}`,
            };

            salesInvoiceData = await this.processInvoiceLines(sqlVentas, salesInvoiceData, database, token, companyID, tenant, entorno, client_id, client_secret);

            if (res.data.value.length === 0) {
              ventasID_BC = await this.createInvoice(salesInvoiceData, salesInvoiceData2, x.ClientCodi, database, client_id, client_secret, token, tenant, entorno, companyID);
            } else {
              ventasID_BC = res.data.value[0].id;
              try {
                await axios.delete(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices(${ventasID_BC})`, {
                  headers: {
                    Authorization: 'Bearer ' + token,
                    'Content-Type': 'application/json',
                  },
                });
                console.log(`🗑️  La factura ${numFactura} se ha eliminado de BC porque ya existia, la volvemos a crear.`);
              } catch (deleteError) {
                this.logError(`❌ Error eliminando la factura ${numFactura} de BC: ${deleteError.message}`, deleteError);
                throw deleteError;
              }
              ventasID_BC = await this.createInvoice(salesInvoiceData, salesInvoiceData2, x.ClientCodi, database, client_id, client_secret, token, tenant, entorno, companyID);
            }
          } catch (error) {
            await this.handleError(error, ventasID_BC, numFactura, token, companyID, tenant, entorno);
            continue;
          }
          console.log(`⏳ Proceso de sincronización de ventas para el dia ${day}/${month} en progreso... -> ${i + 1}/${sqlHora.recordset.length} --- ${(((i + 1) / sqlHora.recordset.length) * 100).toFixed(2)}% `);
        }
        console.log(`✅ Proceso de sincronización de ventas para el dia ${day}/${month} completado (${day - dayStart + 1}/${dayEnd - dayStart + 1} días) --- ${(((day - dayStart + 1) / (dayEnd - dayStart + 1)) * 100).toFixed(2)}% completado`);
      }
      return true;
    } catch (error) {
      this.logError(`❌ Error procesando las ventas`, error);
      return false;
    }
  }

  private async handleError(error: any, ventasID_BC: string, numFactura: string, token: string, companyID: string, tenant: string, entorno: string) {
    this.logError(`❌ Error al procesar las ventas ${numFactura}`, error);
    if (ventasID_BC && ventasID_BC !== '') {
      try {
        const factura = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices?$filter=externalDocumentNumber eq '${numFactura}'`, {
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        });
        if (!factura.data.value[0]) {
          console.log(`📘 La factura ${numFactura} no se creó en BC.`);
          return;
        }

        await axios.delete(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices(${ventasID_BC})`, {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        });
        console.log(`🗑️  La factura ${numFactura} se ha eliminado de BC a causa de un error.`);
      } catch (deleteError) {
        this.logError(`❌ Error eliminando la factura ${numFactura} de BC: ${deleteError.message}`, deleteError);
      }
    }
  }

  private async processInvoiceLines(sqlVentas, salesInvoiceData, database, token: string, companyID: string, tenant: string, entorno: string, client_id: string, client_secret: string) {
    console.log(`📦 Procesando líneas de la factura...`);
    const limit = pLimit(15);
    try {
      let lineData = {};
      const promises = sqlVentas.recordset.map((line: any) =>
        limit(async () => {
          const itemAPI = await this.items.getItemFromAPI(companyID, database, line.Plu, client_id, client_secret, tenant, entorno);
          if (!itemAPI) return console.warn(`Item no encontrado para Plu: ${line.Plu}`);

          lineData = {
            sequence: line.lineNumber,
            itemId: itemAPI,
            lineType: 'Item',
            quantity: line.Quantitat,
            unitPrice: line.UnitPrice,
            discountPercent: line.Descuento,
            taxCode: `IVA${line.Iva}`,
          };

          salesInvoiceData.salesInvoiceLines.push(lineData);
        }),
      );

      await Promise.all(promises);
      console.log(`✅ Todas las líneas de la factura procesadas`);
      return salesInvoiceData;
    } catch (error) {
      this.logError('❌ Error en el procesamiento de las líneas de la factura', error);
      throw error;
    }
  }

  private async createInvoice(salesInvoiceData, salesInvoiceData2, clientCodi, database, client_id, client_secret, token: string, tenant: string, entorno: string, companyID: string) {
    try {
      console.log(`📄 Creando factura...`);
      const ventas = await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices`, salesInvoiceData, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      });

      await this.locations.getLocationFromAPI(companyID, database, clientCodi, client_id, client_secret, tenant, entorno);
      await axios.patch(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/salesHeader(${ventas.data.id})`, salesInvoiceData2, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
          'If-Match': '*',
        },
      });

      console.log(`✅ Factura creada con ID: ${ventas.data.id}`);
      return ventas.data.id;
    } catch (error) {
      this.logError('❌ Error al crear la factura', error);
      throw error;
    }
  }
  private logError(message: string, error: any) {
    this.client.publish('/Hit/Serveis/Apicultor/Log', JSON.stringify({ message, error: error.response?.data || error.message }));
    console.error(message, error.response?.data || error.message);
  }
}
