import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { getTokenService } from '../connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConection.service';
import axios from 'axios';
import { customersService } from 'src/customers/customers.service';
import { itemsService } from 'src/items/items.service';
import { locationsService } from 'src/locations/locations.service';
import * as mqtt from 'mqtt';
import * as pLimit from 'p-limit';
import { error } from 'console';
import { intercompanySilemaService } from 'src/silema/intercompanySilema.service';
import { PdfService } from 'src/pdf/pdf.service';
import { xmlService } from 'src/xml/xml.service';

let errores: string[] = [];
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
    @Inject(forwardRef(() => customersService))
    private customers: customersService,
    @Inject(forwardRef(() => itemsService))
    private items: itemsService,
    @Inject(forwardRef(() => locationsService))
    private locations: locationsService,
    private intercompanySilema: intercompanySilemaService,
    private pdfService: PdfService,
    private xmlService: xmlService,
  ) { }

  async syncSalesFacturas(companyID: string, database: string, idFacturas: string[], tabla: string, client_id: string, client_secret: string, tenant: string, entorno: string) {
    if (tenant === process.env.tenaTenant) {
      await this.intercompanySilema.syncIntercompany(companyID, database, idFacturas, tabla, client_id, client_secret, tenant, entorno);
      return true;
    }
    try {
      const token = await this.token.getToken2(client_id, client_secret, tenant);
      const tabFacturacioIVA = `[FACTURACIO_${tabla}_IVA]`;
      const tabFacturacioDATA = `[FACTURACIO_${tabla}_DATA]`;
      let i = 1;
      for (const idFactura of idFacturas) {
        errores = [];
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

          num = x.Serie.length <= 0 ? x.NumFactura : x.Serie + x.NumFactura;

          endpoint = x.Total >= 0 ? 'salesInvoices' : 'salesCreditMemos';
          const endpointline = x.Total >= 0 ? 'salesInvoiceLines' : 'salesCreditMemoLines';

          const datePart = x.DataFactura.toISOString().split('T')[0];
          const lastPostingDate = await this.getLastDate(client_id, client_secret, tenant, entorno, companyID, endpoint);
          const facturaDate = new Date(datePart);
          const lastDate = lastPostingDate ? new Date(lastPostingDate) : null;
          let invoiceDate: string;
          if (lastDate && facturaDate < lastDate) {
            invoiceDate = lastPostingDate.split('T')[0];
          } else {
            invoiceDate = datePart;
          }

          console.log(`-------------------SINCRONIZANDO FACTURA NÚMERO ${num} -----------------------`);
          let customerId;
          customerId = await this.customers.getCustomerFromAPI(companyID, database, x.ClientNif, client_id, client_secret, tenant, entorno);

          let res;
          try {
            res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/${endpoint}?$filter=externalDocumentNumber eq '${num}' and totalAmountIncludingTax ne 0`, {
              headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json',
              },
            });
          } catch (error) {
            this.logError(`❌ Error consultando factura en BC con número ${num}, pasamos a la siguiente factura`, error);
            i++;
            continue;
          }

          if (!res.data || !res.data.value) {
            console.error(`❌ Error: La respuesta de la API no contiene datos válidos para la factura ${num}, pasamos a la siguiente factura.`);
            i++;
            continue;
          }

          let invoiceData;
          if (x.Total >= 0) {
            invoiceData = {
              externalDocumentNumber: num.toString(),
              invoiceDate: invoiceDate,
              postingDate: invoiceDate,
              customerId: customerId,
              salesInvoiceLines: [],
            };
          } else {
            invoiceData = {
              externalDocumentNumber: num.toString(),
              creditMemoDate: invoiceDate,
              postingDate: invoiceDate,
              customerId: customerId,
              salesCreditMemoLines: [],
            };
          }

          if (x.ClientLliure) {
            console.log(`📜 Añadiendo comentario a la factura ${num}`);
            const text = x.ClientLliure;
            const maxLength = 100;
            const words = text.split(' ');
            let currentLine = '';
            for (const word of words) {
              // Si al agregar esta palabra, la línea se pasa de largo...
              if ((currentLine + word).length > maxLength) {
                // Guarda la línea actual
                invoiceData[endpointline].push({
                  lineType: 'Comment',
                  description: currentLine.trim(),
                });
                // Comienza una nueva línea con la palabra actual
                currentLine = word + ' ';
              } else {
                currentLine += word + ' ';
              }
            }

            // Agrega la última línea si quedó algo
            if (currentLine.trim().length > 0) {
              invoiceData[endpointline].push({
                lineType: 'Comment',
                description: currentLine.trim(),
              });
            }
          }

          invoiceData = await this.processInvoiceLines(invoiceData, endpointline, companyID, database, tabFacturacioDATA, x.IdFactura, facturaId_BC, client_id, client_secret, tenant, entorno);

          if (errores.length > 0) {
            console.log(`❌ Error en la factura ${num}, pasamos a la siguiente factura.`);
            for (const errorMsg of errores) {
              await this.logBCError(num, errorMsg, client_id, client_secret, tenant, entorno, companyID);
            }
            i++;
            continue;
          }
          if (res.data.value.length === 0) {
            facturaId_BC = await this.createInvoice(invoiceData, endpoint, x.ClientCodi, database, client_id, client_secret, token, tenant, entorno, companyID);
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
          }
          if (x.Total < 0 && x.ClientNif != '22222222J') {
            await this.updateCorrectedInvoice(companyID, facturaId_BC, tenant, entorno, database, token, idFactura);
          }
          await this.updateYourReference(companyID, facturaId_BC, tenant, entorno, token);
          await this.updateSQLSale(companyID, facturaId_BC, endpoint, client_id, client_secret, tenant, entorno, x.IdFactura, database);
          const post = await this.postInvoice(companyID, facturaId_BC, client_id, client_secret, tenant, entorno, endpoint);
          if (post.status === 204) {
            console.log(`✅ Factura ${num} sincronizada correctamente.`);
            await this.pdfService.esperaYVeras();
            await this.updateRegistro(companyID, database, facturaId_BC, client_id, client_secret, tenant, entorno, endpoint);
            await this.pdfService.reintentarSubidaPdf([facturaId_BC], database, client_id, client_secret, tenant, entorno, companyID, endpoint);
            const docNo = await this.getSaleFromAPI(companyID, facturaId_BC, endpoint, client_id, client_secret, tenant, entorno);
            // await this.callAPI_XML(docNo.data.number, entorno, tenant, client_id, client_secret, companyID);
            await this.xmlService.getXML(companyID, database, client_id, client_secret, tenant, entorno, facturaId_BC, endpoint);
          }
        } catch (error) {
          await this.handleError(error, num, endpoint, token, companyID, tenant, entorno);
          i++;
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
      const sqlQ = `SELECT CASE WHEN CHARINDEX('IdAlbara:', f.referencia) > 0 THEN 
                    SUBSTRING(f.referencia, CHARINDEX('IdAlbara:', f.referencia) + 9, 
                    CHARINDEX(']', f.referencia, CHARINDEX('IdAlbara:', f.referencia)) - CHARINDEX('IdAlbara:', f.referencia) - 9)
                    ELSE NULL END AS IdAlbara, 
                    c.Nom as Client, FORMAT(f.Data, 'dd/MM/yyyy') AS Data,
                    (f.Servit - f.Tornat) AS Quantitat, 
                    ROUND(f.preu, 3) AS UnitPrice, CAST(f.Producte AS VARCHAR) AS Plu, 
                    f.desconte as Descuento, f.iva as Iva, f.ProducteNom as Nombre,  
                    RIGHT(f.Referencia, CHARINDEX(']', REVERSE(f.Referencia)) - 1) AS Comentario 
                FROM ${tabFacturacioDATA} f
                LEFT JOIN clients c ON f.client = c.codi
                WHERE f.idFactura = '${Hit_IdFactura}' 
                GROUP BY f.Producte, f.Desconte, f.Preu, f.Iva, f.ProducteNom, referencia, c.Nom, f.Data, f.servit, f.tornat
                ORDER BY f.Data, IdAlbara, Client, Nombre;`;

      const invoiceLines = await this.sql.runSql(sqlQ, database);
      if (invoiceLines.recordset.length === 0) {
        console.warn(`⚠️ La factura ${Hit_IdFactura} no tiene líneas.`);
        return salesInvoiceData;
      }

      const groupedByDate = invoiceLines.recordset.reduce((acc, line) => {
        if (!acc[line.Data]) acc[line.Data] = [];
        acc[line.Data].push(line);
        return acc;
      }, {});

      const limit = pLimit(15);

      for (const date in groupedByDate) {
        const lines = groupedByDate[date];

        // Agrupar por IdAlbara
        const groupedByAlbara = lines.reduce((acc, line) => {
          const albaraKey = line.IdAlbara || 'NO_IDALBARA';
          if (!acc[albaraKey]) acc[albaraKey] = [];
          acc[albaraKey].push(line);
          return acc;
        }, {});

        for (const albara in groupedByAlbara) {
          const albaraLines = groupedByAlbara[albara];

          // Agrupar por cliente dentro del albara
          const groupedByClient = albaraLines.reduce((acc, line) => {
            const clientKey = line.Client || 'NO_CLIENT';
            if (!acc[clientKey]) acc[clientKey] = [];
            acc[clientKey].push(line);
            return acc;
          }, {});

          let lastClientComment = null;

          for (const client in groupedByClient) {
            const clientLines = groupedByClient[client];
            const firstLine = clientLines[0];
            let lineData;

            if (albara !== 'NO_IDALBARA') {
              lineData = {
                lineType: 'Comment',
                description: `ALBARÀ: ${albara} - (${firstLine.Client}) - ${date}`,
              };
            } else {
              lineData = {
                lineType: 'Comment',
                description: `(${firstLine.Client}) - ${date}`,
              };
            }

            if (lineData.description !== lastClientComment) {
              salesInvoiceData[endpointline].push(lineData);
              lastClientComment = lineData.description;
            }

            const promises = clientLines.map((line) =>
              limit(async () => {
                const itemAPI = await this.items.getItemFromAPI(companyID, database, line.Plu, client_id, client_secret, tenant, entorno);
                if (itemAPI === 'error') return;

                let quantity = Math.abs(line.Quantitat);
                let unitPrice = line.UnitPrice;

                if (endpointline === 'salesInvoiceLines' && line.Quantitat < 0) {
                  unitPrice *= -1;
                }

                if (endpointline === 'salesCreditMemoLines' && line.Quantitat > 0) {
                  unitPrice *= -1;
                }

                if (itemAPI) {
                  salesInvoiceData[endpointline].push({
                    itemId: itemAPI,
                    lineType: 'Item',
                    quantity: quantity,
                    unitPrice: unitPrice,
                    discountPercent: line.Descuento,
                    taxCode: `IVA${line.Iva}`,
                  });
                } else {
                  salesInvoiceData[endpointline].push({
                    lineObjectNumber: line.Quantitat > 0 ? '7000001' : '7090001',
                    description: line.Nombre,
                    lineType: 'Account',
                    quantity: quantity,
                    unitPrice: unitPrice,
                    discountPercent: line.Descuento,
                    taxCode: `IVA${line.Iva}`,
                  });
                }

                // Comentarios por línea (si existen y distintos)
                if (line.Comentario) {
                  const text = line.Comentario;
                  const maxLength = 100;
                  const words = text.split(' ');
                  let currentLine = '';

                  for (const word of words) {
                    if ((currentLine + word).length > maxLength) {
                      salesInvoiceData[endpointline].push({
                        lineType: 'Comment',
                        description: currentLine.trim(),
                      });
                      currentLine = word + ' ';
                    } else {
                      currentLine += word + ' ';
                    }
                  }

                  if (currentLine.trim().length > 0) {
                    salesInvoiceData[endpointline].push({
                      lineType: 'Comment',
                      description: currentLine.trim(),
                    });
                  }
                }
              }),
            );

            await Promise.all(promises);
          }
        }
      }

      console.log(`✅ Todas las líneas de la factura procesadas`);
      return salesInvoiceData;
    } catch (error) {
      this.logError('❌ Error en el procesamiento de las líneas de la factura', error);
      throw error;
    }
  }

  private async createInvoice(salesInvoiceData, endpoint, clientCodi, database, client_id, client_secret, token: string, tenant: string, entorno: string, companyID: string) {
    try {
      const numLineas =
        salesInvoiceData.salesInvoiceLines?.length ||
        salesInvoiceData.salesCreditMemoLines?.length ||
        0;

      let factura;

      if (numLineas <= 100) {
        console.log(`📄 Creando factura en 1 sola llamada porque solo tiene ${numLineas} líneas...`);

        factura = await axios.post(
          `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/${endpoint}`,
          salesInvoiceData,
          {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          }
        );
      } else {
        console.log(`📄 Factura con ${numLineas} líneas. Usando proceso en bloques...`);

        const invoiceHeader = {
          externalDocumentNumber: salesInvoiceData.externalDocumentNumber,
          invoiceDate: salesInvoiceData.invoiceDate,
          postingDate: salesInvoiceData.postingDate,
          customerId: salesInvoiceData.customerId,
        };

        factura = await axios.post(
          `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/${endpoint}`,
          invoiceHeader,
          {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          }
        );

        console.log(`✅ Cabecera creada con ID: ${factura.data.id}`);

        let allLines;
        let lineEndpoint;
        if (endpoint === "salesInvoices") {
          allLines = salesInvoiceData.salesInvoiceLines;
          lineEndpoint = `salesInvoiceLines`;
        } else if (endpoint === "salesCreditMemos") {
          allLines = salesInvoiceData.salesCreditMemoLines;
          lineEndpoint = `salesCreditMemoLines`;
        } else {
          throw new Error("Endpoint desconocido. No se puede insertar líneas.");
        }

        const chunkSize = 100;
        for (let i = 0; i < allLines.length; i += chunkSize) {
          const chunk = allLines.slice(i, i + chunkSize);

          for (const line of chunk) {
            await axios.post(
              `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/${endpoint}(${factura.data.id})/${lineEndpoint}`,
              line,
              {
                headers: {
                  Authorization: 'Bearer ' + token,
                  'Content-Type': 'application/json',
                },
              }
            );
          }

          console.log(`✅ Bloque de líneas ${i + 1} a ${i + chunk.length} insertado.`);
        }

        console.log(`✅ Todas las líneas insertadas.`);
      }

      const esTienda = await this.sql.runSql(`SELECT * FROM ParamsHw WHERE codi = ${clientCodi}`, database);
      if (esTienda.recordset && esTienda.recordset.length > 0) {
        console.log(`📄 Es una factura para una tienda, asignando almacén...`);
        let salesInvoiceData2 = {
          LocationCode: `${clientCodi}`,
        };
        await this.locations.getLocationFromAPI(companyID, database, clientCodi, client_id, client_secret, tenant, entorno);
        if (errores.length > 0) {
          for (const errorMsg of errores) {
            await this.logBCError(salesInvoiceData.externalDocumentNumber, errorMsg, client_id, client_secret, tenant, entorno, companyID);
          }
          throw error;
        }
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
      const sqlQRect = `SELECT CASE WHEN CHARINDEX('[RECTIFICATIVA_DE:', Comentari) > 0 THEN SUBSTRING(Comentari, CHARINDEX('[RECTIFICATIVA_DE:', Comentari) + 18, CHARINDEX(']', Comentari, CHARINDEX('[RECTIFICATIVA_DE:', Comentari)) - CHARINDEX('[RECTIFICATIVA_DE:', Comentari) - 18) ELSE NULL END AS rectificativa FROM FacturacioComentaris WHERE idFactura = '${idFactura}'`;
      const facturaComentari = await this.sql.runSql(sqlQRect, database);
      if (facturaComentari.recordset.length === 0 || !facturaComentari.recordset[0].rectificativa) {
        console.warn(`⚠️ No se encontró una factura rectificativa para la factura con ID ${idFactura}.`);
        return;
      }
      const correctedInvoice = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices?$filter=externalDocumentNumber eq '${facturaComentari.recordset[0].rectificativa}' `, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      });
      const updateData = {
        CorrectedInvoiceNo: correctedInvoice.data.value[0].number,
        AppliesToDocType: 'Invoice',
        AppliesToDocNo: correctedInvoice.data.value[0].number,
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
  private async updateYourReference(companyID, facturaId_BC, tenant, entorno, token) {
    try {
      const updateData = {
        yourReference: '-',
      };
      await axios.patch(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/salesHeader(${facturaId_BC})`, updateData, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
          'If-Match': '*',
        },
      });
    } catch (error) {
      this.logError(`❌ Error al actualizar la factura con id ${facturaId_BC}`, error);
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
  async getSaleLinesFromAPI(companyID, facturaId_BC, endpoint, client_id: string, client_secret: string, tenant: string, entorno: string) {
    try {

      let lineEndpoint;
      if (endpoint === "salesInvoices") {
        lineEndpoint = `salesInvoiceLines`;
      } else if (endpoint === "salesCreditMemos") {
        lineEndpoint = `salesCreditMemoLines`;
      } else {
        throw new Error("Endpoint desconocido. No se puede insertar líneas.");
      }
      const token = await this.token.getToken2(client_id, client_secret, tenant);
      const res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/${endpoint}(${facturaId_BC})/${lineEndpoint}?$filter=lineType eq 'Item' or lineType eq 'Account'`, {
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

  async updateRegistro(companyID: string, database: string, idFactura: string, client_id: string, client_secret: string, tenant: string, entorno: string, endpoint: string) {
    try {
      const salesData = await this.getSaleFromAPI(companyID, idFactura, endpoint, client_id, client_secret, tenant, entorno);
      const salesDataLines = await this.getSaleLinesFromAPI(companyID, idFactura, endpoint, client_id, client_secret, tenant, entorno);

      if (!salesData.data) {
        console.warn(`⚠️ No se encontró información para la factura ${idFactura}`);
        return false;
      }
      if (!salesDataLines.data || salesDataLines.data.value.length === 0) {
        console.warn(`⚠️ No se encontraron líneas para la factura ${idFactura}`);
        return false;
      }
      const year = salesData.data.postingDate.split('-')[0];
      const month = salesData.data.postingDate.split('-')[1];
      console.log(`📅 Actualizando factura del año ${year} y mes ${month}`);
      const number = salesData.data.number;
      const sqlQuery = `SELECT HIT_IdFactura FROM [BC_SyncSales_${year}] WHERE BC_IdSale = '${idFactura}'`;
      const getidHit = await this.sql.runSql(sqlQuery, database);
      const idHit = getidHit.recordset[0].HIT_IdFactura;

      const idFacturaParts = number.split('-');
      const idFacturaSerie = idFacturaParts.slice(0, -1).join('-') + '-';
      const idFacturaNumber = idFacturaParts[idFacturaParts.length - 1];

      console.log(`📝 Actualizando factura ${idFactura} con número ${idFacturaNumber} y serie ${idFacturaSerie}`);

      const updateSql = `UPDATE [BC_SyncSales_${year}] 
                         SET Registrada = 'Si', BC_Number='${number}'
                         WHERE BC_IdSale = '${idFactura}'`;

      await this.sql.runSql(updateSql, database);

      for (const line of salesDataLines.data.value) {
        const lineImport = endpoint === 'salesCreditMemos' ? -Math.abs(line.amountExcludingTax) : line.amountExcludingTax;
        const updateLineSql = `UPDATE [facturacio_${year}-${month}_Data_BC] 
                               SET IdFactura = '${idFactura}', 
                                   Import = ${lineImport}
                               WHERE IdFactura = '${idHit}' 
                               AND Producte = ${line.lineObjectNumber}
                               AND Preu = ${line.unitPrice}
                               AND Desconte = ${line.discountPercent}`;
        // console.log(`➡ Ejecutando SQL:\n${updateLineSql}`);
        await this.sql.runSql(updateLineSql, database);
      }
      // Agrupar bases por tipo de IVA
      interface IvaGroup {
        ivaPercent: number;
        base: number;
        quota: number;
      }

      const ivaMap: Record<string, IvaGroup> = {};

      for (const line of salesDataLines.data.value) {
        const ivaPercent = Number(line.taxPercent);
        if (!ivaMap[ivaPercent]) {
          ivaMap[ivaPercent] = {
            ivaPercent,
            base: 0,
            quota: 0
          };
        }
        const base = Number(line.amountExcludingTax);
        const quota = Number(line.totalTaxAmount);

        ivaMap[ivaPercent].base += endpoint === 'salesCreditMemos' ? -Math.abs(base) : base;
        ivaMap[ivaPercent].quota += endpoint === 'salesCreditMemos' ? -Math.abs(quota) : quota;

      }

      // Ordenar por porcentaje IVA
      const ivaGroupsSorted = Object.values(ivaMap).sort((a, b) => a.ivaPercent - b.ivaPercent);

      // Generar valores para BaseIvaX, IvaX, valorIvaX
      const maxIvaSlots = 4;
      const fieldsToUpdate: string[] = [];

      for (let i = 0; i < maxIvaSlots; i++) {
        const group = ivaGroupsSorted[i];
        if (group) {
          fieldsToUpdate.push(`BaseIva${i + 1} = ${group.base}`);
          fieldsToUpdate.push(`Iva${i + 1} = ${group.quota}`);
          fieldsToUpdate.push(`valorIva${i + 1} = ${group.ivaPercent}`);
        } else {
          fieldsToUpdate.push(`BaseIva${i + 1} = 0`);
          fieldsToUpdate.push(`Iva${i + 1} = 0`);
          fieldsToUpdate.push(`valorIva${i + 1} = 0`);
        }
      }
      const importBC = endpoint === 'salesCreditMemos' ? -Math.abs(salesData.data.totalAmountIncludingTax) : salesData.data.totalAmountIncludingTax;
      const updateFactIva = `
      UPDATE [facturacio_${year}-${month}_iva_BC]
      SET 
          IdFactura = '${idFactura}',
          Total = ${importBC.toFixed(2)},
          Serie = '${idFacturaSerie}',
          NumFactura = '${idFacturaNumber}',
          ${fieldsToUpdate.join(',\n')}
      WHERE IdFactura = '${idHit}'`;

      const updateFactReb = `
      UPDATE [facturacio_${year}-${month}_Reb_BC]
      SET 
          IdFactura = '${idFactura}',
          Total = ${importBC.toFixed(2)},
          Serie = '${idFacturaSerie}',
          NumFactura = '${idFacturaNumber}',
          ${fieldsToUpdate.join(',\n')}
      WHERE IdFactura = '${idHit}'`;


      // console.log(`➡ Ejecutando SQL:\n${updateFactIva}`);
      await this.sql.runSql(updateFactIva, database);
      // console.log(`➡ Ejecutando SQL:\n${updateFactReb}`);
      await this.sql.runSql(updateFactReb, database);

    } catch (error) {
      this.logError(`❌ Error al actualizar la factura con id ${idFactura} en BC_SyncSales`, error);
      throw error;
    }
    console.log(`✅ Registro actualizado correctamente para la factura ${idFactura}`);
    return true;
  }

  async postInvoice(companyID: string, idFactura: string, client_id: string, client_secret: string, tenant: string, entorno: string, endpoint: string) {
    const token = await this.token.getToken2(client_id, client_secret, tenant);
    try {
      const url = `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/${endpoint}(${idFactura})/Microsoft.NAV.post`;
      const response = await axios.post(
        url,
        {},
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );
      console.log(`✅ Factura ${idFactura} registrada correctamente.`);
      return response;

    } catch (error) {
      this.logError(`❌ Error al registrar la factura ${idFactura}`, error);
      throw error;
    }

  }
  async callAPI_XML(documentNO: string, entorno: string, tenant: string, client_id: string, client_secret: string, companyId: string) {
    console.log(`📡 Enviando factura ${documentNO} a la API SOAP de Business Central...`);
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
    const safeDocNO = this.escapeXml(documentNO);

    const soapEnvelope = `
      <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
                    xmlns:tns="urn:microsoft-dynamics-schemas/codeunit/SendAPI">
        <soap:Header/>
        <soap:Body>
          <tns:SendSalesDocument>
            <tns:documentNo>${safeDocNO}</tns:documentNo>
            <tns:forceFormatCode></tns:forceFormatCode>
          </tns:SendSalesDocument>
        </soap:Body>
      </soap:Envelope>`.trim();
    const url = `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${entorno}/WS/${companyName}/Codeunit/SendAPI`;
    // Realizar la solicitud SOAP
    const response = await axios.post(
      url,
      soapEnvelope,
      {
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "text/xml; charset=utf-8",
          SOAPAction:
            "urn:microsoft-dynamics-schemas/codeunit/SendAPI:SendSalesDocument",
        },
      }
    );
    console.log("✅ Respuesta de BC:", response.data);
  }
  async getInvoiceByNumber(companyID: string, invoiceNumber: string, client_id: string, client_secret: string, tenant: string, entorno: string, database: string) {
    const endpoint = invoiceNumber.startsWith('RE/') ? 'salesCreditMemos' : 'salesInvoices';
    try {
      const token = await this.token.getToken2(client_id, client_secret, tenant);
      const url = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/${endpoint}?$filter=number eq '${invoiceNumber}'`;
      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      const factura = response.data.value[0];
      if (!factura) {
        console.warn(`⚠️ No se encontró la factura con número ${invoiceNumber}`);
      }
      const year = factura.postingDate.split('-')[0];

      const selectQuery = `SELECT * FROM [BC_SyncSales_${year}] WHERE BC_IdSale = '${factura.id}' and BC_PostingDate = '${factura.postingDate}' and BC_CustomerId = '${factura.customerId}' and BC_totalAmountIncludingTax = ${factura.totalAmountIncludingTax}`;
      const existingRecord = await this.sql.runSql(selectQuery, database);
      if (existingRecord.recordset.length > 0) {
        console.log(`La factura ${invoiceNumber} ya existe en BC_SyncSales_${year}. No se insertará de nuevo.`);
        return;
      } else {
        const clientQuery = `SELECT Codi FROM clients WHERE nif = '${factura.customerNumber}'`;
        const clientNumber = await this.sql.runSql(clientQuery, database);
        const insertQuery = `INSERT INTO [BC_SyncSales_${year}] (Id, HIT_IdFactura, HIT_ClientNom, HIT_ClientCodi, BC_IdSale,BC_Number, BC_PostingDate, BC_CustomerId, BC_totalAmountIncludingTax, Registrada) VALUES 
        (newid(), newid(), '${factura.customerName}', '${clientNumber.recordset[0].Codi}', '${factura.id}', '${factura.number}', '${factura.postingDate}', '${factura.customerId}', ${factura.totalAmountIncludingTax}, 'Si');`;
        await this.sql.runSql(insertQuery, database);
        await this.pdfService.reintentarSubidaPdf([factura.id], database, client_id, client_secret, tenant, entorno, companyID, endpoint);
      }
      return true;
    } catch (error) {
      this.logError(`❌ Error al obtener la factura ${invoiceNumber}`, error);
    }
  }

  private logError(message: string, error: any) {
    this.client.publish('/Hit/Serveis/Apicultor/Log', JSON.stringify({ message, error: error.response?.data || error.message }));
    console.error(message, error.response?.data || error.message);
  }
  private async logBCError(factura: string, error: any, client_id: string, client_secret: string, tenant: string, entorno: string, companyID: string) {
    const token = await this.token.getToken2(client_id, client_secret, tenant);
    const logData = {
      dateTime: new Date().toISOString(),
      invoice: factura,
      error: error,
    };
    await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/Silema/v2.0/companies(${companyID})/LogsInvoices`, logData, {
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
    });
  }
  private escapeXml(unsafe: string): string {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  private async getLastDate(client_id: string, client_secret: string, tenant: string, entorno: string, companyID: string, endpoint: string) {
    const token = await this.token.getToken2(client_id, client_secret, tenant);
    const url = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/${endpoint}?$filter=contains(externalDocumentNumber,'VENTAS_') ne true&$orderby=postingDate desc&$top=1`;
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    return response.data.value[0]?.postingDate || null;
  }

  async rellenarBCSyncSales(companyID: string, database: string, ids: string[], client_id: string, client_secret: string, tenant: string, entorno: string) {
    const token = await this.token.getToken2(client_id, client_secret, tenant);
    for (const id2 of ids) {
      const getNumSql = `SELECT HIT_NumFactura, HIT_SerieFactura, HIT_Total FROM [BC_SyncSales_2025] WHERE HIT_IdFactura = '${id2}'`;
      const numResult = await this.sql.runSql(getNumSql, database);
      const externalDocumentNumber = `${numResult.recordset[0].HIT_SerieFactura}${numResult.recordset[0].HIT_NumFactura}`;
      let endpoint;
      if (numResult.recordset[0].HIT_Total > 0) {
        endpoint = 'salesInvoices';
      } else {
        endpoint = 'salesCreditMemos';
      }
      let res;
      try {
        const url = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/${endpoint}?$filter=externalDocumentNumber eq '${externalDocumentNumber}' and totalAmountIncludingTax ne 0`;
        res = await axios.get(url, {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        });
      } catch (error) {
        this.logError(`❌ Error consultando factura en BC con número ${externalDocumentNumber}, pasamos a la siguiente factura`, error);
      }
      if (!res || res.data.value.length === 0) {
        console.warn(`⚠️ No se encontró la factura con número ${externalDocumentNumber} en BC, pasamos a la siguiente factura`);
        continue;
      }
      const id = res.data.value[0].id;
      await this.updateSQLSale(companyID, id, endpoint, client_id, client_secret, tenant, entorno, id2, database);
      await this.pdfService.esperaYVeras();
      await this.updateRegistro(companyID, database, id, client_id, client_secret, tenant, entorno, endpoint);
      await this.pdfService.reintentarSubidaPdf([id], database, client_id, client_secret, tenant, entorno, companyID, endpoint);
      await this.xmlService.getXML(companyID, database, client_id, client_secret, tenant, entorno, id, endpoint);

    }
    return true;
  }
}
