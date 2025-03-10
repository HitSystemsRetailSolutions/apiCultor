import { Injectable } from '@nestjs/common';
import { getTokenService } from '../connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConection.service';
import axios from 'axios';
import { customersService } from 'src/customers/customers.service';
import { itemsService } from 'src/items/items.service';
import { locationsService } from 'src/locations/locations.service';
import * as mqtt from 'mqtt';
import * as pLimit from 'p-limit';
@Injectable()
export class salesFacturasService {
  private client = mqtt.connect({
    host: process.env.MQTT_HOST,
    username: process.env.MQTT_USER,
    password: process.env.MQTT_PASSWORD,
  });
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
    private customers: customersService,
    private items: itemsService,
    private locations: locationsService,
  ) {}

  async syncSalesFacturas(companyID: string, database: string, idFacturas: string[], tabla: string, client_id: string, client_secret: string, tenant: string, entorno: string) {
    try {
      const token = await this.token.getToken2(client_id, client_secret, tenant);
      const tabFacturacioIVA = `[FACTURACIO_${tabla}_IVA]`;
      const tabFacturacioDATA = `[FACTURACIO_${tabla}_DATA]`;
      let i = 1;
      for (const idFactura of idFacturas) {
        let facturaId_BC: string | null = null;
        let num: string | null = null;
        let endpoint: string = '';
        try {
          const sqlQ = `SELECT * FROM ${tabFacturacioIVA} WHERE idFactura = '${idFactura}'`;
          const facturas = await this.sql.runSql(sqlQ, database);

          if (facturas.recordset.length === 0) {
            console.warn(`⚠️ Factura con ID ${idFactura} no encontrada en la base de datos.`);
            continue;
          }

          const x = facturas.recordset[0];
          const datePart = x.DataFactura.toISOString().split('T')[0];
          num = x.Serie.length <= 0 ? x.NumFactura : x.Serie + x.NumFactura;

          endpoint = x.Total >= 0 ? 'salesInvoices' : 'salesCreditMemos';
          const endpointline = x.Total >= 0 ? 'salesInvoiceLines' : 'salesCreditMemoLines';

          console.log(`-------------------SINCRONIZANDO FACTURA NÚMERO ${num} -----------------------`);
          const customerId = await this.customers.getCustomerFromAPI(companyID, database, x.ClientNif, client_id, client_secret, tenant, entorno);

          let res;
          try {
            res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/${endpoint}?$filter=externalDocumentNumber eq '${num}'`, {
              headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json',
              },
            });
          } catch (error) {
            this.logError(`❌ Error consultando factura en BC con número ${num}, pasamos a la siguiente factura`, error);
            continue;
          }

          if (!res.data || !res.data.value) {
            console.error(`❌ Error: La respuesta de la API no contiene datos válidos para la factura ${num}, pasamos a la siguiente factura.`);
            continue;
          }

          let invoiceData;
          if (x.Total >= 0) {
            invoiceData = {
              externalDocumentNumber: num.toString(),
              invoiceDate: datePart,
              postingDate: datePart,
              customerId: customerId,
              salesInvoiceLines: [],
            };
          } else {
            invoiceData = {
              externalDocumentNumber: num.toString(),
              creditMemoDate: datePart,
              postingDate: datePart,
              customerId: customerId,
              salesCreditMemoLines: [],
            };
          }

          invoiceData = await this.processInvoiceLines(invoiceData, endpointline, companyID, database, tabFacturacioDATA, x.IdFactura, facturaId_BC, client_id, client_secret, tenant, entorno);

          if (res.data.value.length === 0) {
            facturaId_BC = await this.createInvoice(invoiceData, endpoint, x.ClientCodi, database, client_id, client_secret, token, tenant, entorno, companyID);

            if (x.Total < 0 && x.ClientNif != '22222222J') {
              await this.updateCorrectedInvoice(companyID, facturaId_BC, tenant, entorno, database, token, idFactura);
            }
          } else {
            facturaId_BC = res.data.value[0]['id'];
            try {
              await axios.delete(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/${endpoint}(${facturaId_BC})`, {
                headers: {
                  Authorization: 'Bearer ' + token,
                  'Content-Type': 'application/json',
                },
              });
              console.log(`🗑️  La factura ${num} se ha eliminado de BC porque ya existia, la volvemos a crear.`);
            } catch (deleteError) {
              this.logError(`❌ Error eliminando la factura existente ${num} de BC: ${deleteError.message}`, deleteError);
              throw deleteError;
            }
            facturaId_BC = await this.createInvoice(invoiceData, endpoint, x.ClientCodi, database, client_id, client_secret, token, tenant, entorno, companyID);
            if (x.Total < 0 && x.ClientNif != '22222222J') {
              await this.updateCorrectedInvoice(companyID, facturaId_BC, tenant, entorno, database, token, idFactura);
            }
          }

          await this.updateSQLSale(companyID, facturaId_BC, endpoint, client_id, client_secret, tenant, entorno, x.IdFactura, database);
        } catch (error) {
          await this.handleError(error, num, endpoint, token, companyID, tenant, entorno);
          continue;
        }
        console.log(`⏳ Sincronizando facturas... -> ${i}/${idFacturas.length} --- ${((i / idFacturas.length) * 100).toFixed(2)}% `);
        i++;
      }
      return true;
    } catch (error) {
      this.logError(`❌ Error procesando las facturas`, error);
      return false;
    }
  }

  async processInvoiceLines(salesInvoiceData, endpointline, companyID, database, tabFacturacioDATA, Hit_IdFactura, BC_facturaId, client_id: string, client_secret: string, tenant: string, entorno: string) {
    console.log(`📦 Procesando líneas de la factura...`);
    try {
      const sqlQ = `SELECT SUM(CASE WHEN f.Servit = 0 THEN f.Tornat * -1 ELSE f.Servit END) AS Quantitat, round(f.preu,3) AS UnitPrice, CAST(f.Producte AS VARCHAR) AS Plu , f.desconte as Descuento, f.iva as Iva, f.ProducteNom as Nombre FROM ${tabFacturacioDATA} f WHERE f.idFactura = '${Hit_IdFactura}' GROUP BY f.Producte,f.Desconte,f.Preu,f.Iva,f.ProducteNom;`;
      const invoiceLines = await this.sql.runSql(sqlQ, database);
      let lineData = {};
      const limit = pLimit(15);
      const promises = invoiceLines.recordset.map((line: any) =>
        limit(async () => {
          const itemAPI = await this.items.getItemFromAPI(companyID, database, line.Plu, client_id, client_secret, tenant, entorno);

          if (itemAPI) {
            lineData = {
              itemId: itemAPI,
              lineType: 'Item',
              quantity: line.Quantitat,
              unitPrice: line.UnitPrice,
              discountPercent: line.Descuento,
              taxCode: `IVA${line.Iva}`,
            };
          } else {
            lineData = {
              lineObjectNumber: line.Quantitat > 0 ? '7000001' : '7090001',
              description: line.Nombre,
              lineType: 'Account',
              quantity: line.Quantitat,
              unitPrice: line.UnitPrice,
              discountPercent: line.Descuento,
              taxCode: `IVA${line.Iva}`,
            };
          }
          salesInvoiceData[endpointline].push(lineData);
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
  private async createInvoice(salesInvoiceData, endpoint, clientCodi, database, client_id, client_secret, token: string, tenant: string, entorno: string, companyID: string) {
    try {
      console.log(`📄 Creando factura...`);
      const factura = await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/${endpoint}`, salesInvoiceData, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      });

      const esTienda = await this.sql.runSql(`SELECT * FROM ParamsHw WHERE codi = ${clientCodi}`, database);
      if (esTienda.recordset && esTienda.recordset.length > 0) {
        console.log(`📄 Es una factura para una tienda, asignando almacén...`);
        let salesInvoiceData2 = {
          LocationCode: `${clientCodi}`,
        };
        await this.locations.getLocationFromAPI(companyID, database, clientCodi, client_id, client_secret, tenant, entorno);
        await axios.patch(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/salesHeader(${factura.data.id})`, salesInvoiceData2, {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
            'If-Match': '*',
          },
        });
      }

      console.log(`✅ Factura creada con ID: ${factura.data.id}`);

      return factura.data.id;
    } catch (error) {
      this.logError('❌ Error al crear la factura', error);
      throw error;
    }
  }

  private async updateCorrectedInvoice(companyID, facturaId_BC, tenant, entorno, database, token, idFactura) {
    try {
      const sqlQRect = `SELECT SUBSTRING(Comentari, CHARINDEX('[RECTIFICATIVA_DE:', Comentari) + 18, CHARINDEX(']', Comentari, CHARINDEX('[RECTIFICATIVA_DE:', Comentari)) - CHARINDEX('[RECTIFICATIVA_DE:', Comentari) - 18) AS rectificativa from FacturacioComentaris WHERE idFactura = '${idFactura}'`;
      const facturaComentari = await this.sql.runSql(sqlQRect, database);
      const correctedInvoice = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices?$filter=externalDocumentNumber eq '${facturaComentari.recordset[0].rectificativa}' `, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      });
      const updateData = {
        CorrectedInvoiceNo: correctedInvoice.data.value[0].number,
      };
      //Esto solo funciona si la factura a la que corrige ya está registrada en BC
      await axios.patch(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/salesHeader(${facturaId_BC})`, updateData, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
          'If-Match': '*',
        },
      });
    } catch (error) {
      this.logError(`❌ Error al actualizar el abono con id ${facturaId_BC}`, error);
      throw error;
    }
  }

  async getSaleFromAPI(companyID, facturaId_BC, endpoint, client_id: string, client_secret: string, tenant: string, entorno: string) {
    try {
      const token = await this.token.getToken2(client_id, client_secret, tenant);
      const res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/${endpoint}(${facturaId_BC})`, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      });
      return res;
    } catch (error) {
      this.logError(`❌ Error obteniendo venta desde API para el documento ${facturaId_BC}`, error);
      throw error;
    }
  }

  async updateSQLSale(companyID, facturaId_BC, endpoint, client_id, client_secret, tenant, entorno, idSaleHit, database) {
    try {
      const salesData = await this.getSaleFromAPI(companyID, facturaId_BC, endpoint, client_id, client_secret, tenant, entorno);

      if (!salesData.data) {
        console.warn(`⚠️ No se encontró información para la factura ${facturaId_BC}`);
        return false;
      }

      const { id, number, postingDate, customerId, totalAmountIncludingTax } = salesData.data;
      const year = postingDate.split('-')[0];

      const updateSql = `UPDATE [BC_SyncSales_${year}] 
                         SET BC_IdSale = '${id}',
                            BC_Number = '${number}',
                            BC_PostingDate = '${postingDate}',
                            BC_CustomerId = '${customerId}',
                            BC_totalAmountIncludingTax = ${totalAmountIncludingTax}
                         WHERE HIT_IdFactura = '${idSaleHit}'`;

      await this.sql.runSql(updateSql, database);
    } catch (error) {
      this.logError(`❌ Error al actualizar la factura con id ${facturaId_BC} en BC_SyncSales`, error);
      throw error;
    }
  }

  private async handleError(error: any, numFactura: string, endpoint, token: string, companyID: string, tenant: string, entorno: string) {
    this.logError(`❌ Error al procesar la factura ${numFactura}`, error);
    if (numFactura && numFactura !== '' && endpoint) {
      try {
        const factura = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/${endpoint}?$filter=externalDocumentNumber eq '${numFactura}'`, {
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        });
        if (!factura.data.value[0]) {
          console.log(`📘 La factura ${numFactura} no se creó en BC.`);
          return;
        }
        await axios.delete(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/${endpoint}(${factura.data.value[0].id})`, {
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

  private logError(message: string, error: any) {
    this.client.publish('/Hit/Serveis/Apicultor/Log', JSON.stringify({ message, error: error.response?.data || error.message }));
    console.error(message, error.response?.data || error.message);
  }
}
