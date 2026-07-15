import { Injectable } from '@nestjs/common';
import { getTokenService } from 'src/connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConnection.service';
import axios from 'axios';
import { vendorsService } from 'src/maestros/vendors/vendors.service';
import { itemsMPService } from 'src/maestros/itemsMP/itemsMP.service';
import { locationsService } from 'src/maestros/locations/locations.service';
import { noSerieService } from 'src/sales/noSerie/noSerie.service';
import { documentAttachmentsService } from '../documentAttachments/documentAttachments.service';
import { parseStringPromise } from 'xml2js';
import { Mutex } from 'async-mutex';
import * as mqtt from 'mqtt';
import * as pLimit from 'p-limit';
import { createHash } from 'crypto';

let errores: string[] = [];
@Injectable()
export class purchaseInvoicesService {
  private client = mqtt.connect({
    host: process.env.MQTT_HOST,
    username: process.env.MQTT_USER,
    password: process.env.MQTT_PASSWORD,
  });
  private locks = new Map<string, Mutex>();

  constructor(
    private token: getTokenService,
    private sql: runSqlService,
    private vendors: vendorsService,
    private itemsMP: itemsMPService,
    private documentAttachments: documentAttachmentsService,
    private locations: locationsService,
    private noSerieService: noSerieService,
  ) { }

  private getLock(key: string): Mutex {
    if (!this.locks.has(key)) {
      this.locks.set(key, new Mutex());
    }
    return this.locks.get(key);
  }

  async syncPurchaseFacturas(companyID: string, database: string, idFacturas: string[], tabla: string, client_id: string, client_secret: string, tenant: string, entorno: string) {
    if (tenant === process.env.tenaTenant) {
      return true;
    }
    try {
      const token = await this.token.getToken2(client_id, client_secret, tenant);
      const tabCompresIVA = `[ccFacturas_${tabla}_IVA]`;
      const tabCompresDATA = `[ccFacturas_${tabla}_DATA]`;
      let i = 1;
      for (const idFactura of idFacturas) {
        errores = [];
        let facturaId_BC: string | null = null;
        let num: string | null = null;
        let endpoint: string = '';
        let yearPart: string = '';
        try {
          if (this.getLock(idFactura).isLocked()) {
            console.log(`⏳ Esperando liberación del bloqueo para la factura de compra ${idFactura}...`);
          }
          await this.getLock(idFactura).runExclusive(async () => {
            const sqlQ = `SELECT * FROM ${tabCompresIVA} WHERE idFactura = '${idFactura}'`;
            const facturas = await this.sql.runSql(sqlQ, database);

            if (facturas.recordset.length === 0) {
              console.warn(`⚠️ Factura de compra con ID ${idFactura} no encontrada en la base de datos.`);
              return;
            }

            const x = facturas.recordset[0];

            /*let serie = x.Serie || '';
            num = serie.length <= 0 ? x.NumFactura : serie + x.NumFactura;*/
            num = x.NumFactura;

            endpoint = x.Total >= 0 ? 'purchaseInvoices' : 'purchaseCreditMemos';
            const endpointline = x.Total >= 0 ? 'purchaseInvoiceLines' : 'purchaseCreditMemoLines';

            const datePart = x.DataFactura.toISOString().split('T')[0];
            yearPart = datePart.split('-')[0];
            const dueDate = x.DataVenciment ? x.DataVenciment.toISOString().split('T')[0] : null;
            /*if (!serie || serie === '' || serie === 'RE/') {
              if (endpoint === 'purchaseInvoices') {
                serie = yearPart;
              } else if (endpoint === 'purchaseCreditMemos') {
                serie = 'RE/' + yearPart;
              }
            }*/

            const invoiceDate = datePart;

            console.log(`-------------------SINCRONIZANDO FACTURA DE COMPRA NÚMERO ${num} -----------------------`);
            const vendorData = await this.vendors.getVendorFromAPI(companyID, database, x.EmpNif, client_id, client_secret, tenant, entorno);
            if (!vendorData || typeof vendorData === 'boolean') {
              console.error(`❌ No se pudo obtener el proveedor con NIF ${x.EmpNif}`);
              return;
            }
            const vendorNumber = vendorData.vendorNumber;
            const vendorBCId = vendorData.vendorBCId;

            // Obtener currencyCode del proveedor en BC
            let currencyCode = '';
            try {
              const vendorRes = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/vendors(${vendorBCId})`, {
                headers: {
                  Authorization: 'Bearer ' + token,
                  'Content-Type': 'application/json',
                },
              });
              currencyCode = vendorRes.data.currencyCode || '';
            } catch (error) {
              this.logError(`⚠️ No se pudo obtener la moneda del proveedor ${vendorNumber}`, error);
            }

            const dateField = endpoint === 'purchaseInvoices' ? 'invoiceDate' : 'creditMemoDate';
            const yearFilter = `${dateField} ge ${yearPart}-01-01 and ${dateField} le ${yearPart}-12-31`;
            let res;
            try {
              res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/${endpoint}?$filter=vendorInvoiceNumber eq '${num}' and totalAmountIncludingTax ne 0 and ${yearFilter}`, {
                headers: {
                  Authorization: 'Bearer ' + token,
                  'Content-Type': 'application/json',
                },
              });
            } catch (error) {
              this.logError(`❌ Error consultando factura de compra en BC con número ${num}, pasamos a la siguiente factura`, error);
              return;
            }

            if (!res.data || !res.data.value) {
              console.error(`❌ Error: La respuesta de la API no contiene datos válidos para la factura de compra ${num}, pasamos a la siguiente factura.`);
              return;
            }

            let invoiceData;
            if (x.Total >= 0) {
              invoiceData = {
                vendorInvoiceNumber: num.toString(),
                invoiceDate: invoiceDate,
                postingDate: invoiceDate,
                dueDate: dueDate,
                vendorNumber: vendorNumber,
                currencyCode: currencyCode,
                purchaseInvoiceLines: [],
              };
            } else {
              invoiceData = {
                vendorInvoiceNumber: num.toString(),
                creditMemoDate: invoiceDate,
                postingDate: invoiceDate,
                dueDate: dueDate,
                vendorNumber: vendorNumber,
                currencyCode: currencyCode,
                purchaseCreditMemoLines: [],
              };
            }

            invoiceData = await this.processInvoiceLines(invoiceData, endpointline, companyID, database, tabCompresDATA, x.IdFactura, x.EmpNif, client_id, client_secret, tenant, entorno);

            if (errores.length > 0) {
              console.log(`❌ Error en la factura de compra ${num}, pasamos a la siguiente factura.`);
              return;
            }
            if (res.data.value.length === 0) {
              const { id: newId, number: invoiceNumber } = await this.createPurchaseInvoice(endpoint, invoiceData, token, tenant, entorno, companyID);
              facturaId_BC = newId;
              const trackingLines = await this.createInvoiceLines(facturaId_BC, invoiceData, endpoint, token, tenant, entorno, companyID);
              await this.createTrackingSpecifications(invoiceNumber, facturaId_BC, endpoint, trackingLines, token, tenant, entorno, companyID);
            } else {
              facturaId_BC = res.data.value[0]['id'];
              try {
                await axios.delete(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/${endpoint}(${facturaId_BC})`, {
                  headers: {
                    Authorization: 'Bearer ' + token,
                    'Content-Type': 'application/json',
                    Connection: 'close',
                  },
                });
                console.log(`🗑️  La factura de compra ${num} se ha eliminado de BC porque ya existía, la volvemos a crear.`);
              } catch (deleteError) {
                this.logError(`❌ Error eliminando la factura de compra existente ${num} de BC: ${deleteError.message}`, deleteError);
                throw deleteError;
              }
              const { id: newId, number: invoiceNumber } = await this.createPurchaseInvoice(endpoint, invoiceData, token, tenant, entorno, companyID);
              facturaId_BC = newId;
              const trackingLines = await this.createInvoiceLines(facturaId_BC, invoiceData, endpoint, token, tenant, entorno, companyID);
              await this.createTrackingSpecifications(invoiceNumber, facturaId_BC, endpoint, trackingLines, token, tenant, entorno, companyID);
            }
            await this.updateSQLPurchase(companyID, facturaId_BC, endpoint, client_id, client_secret, tenant, entorno, x.IdFactura, database);
            await this.documentAttachments.syncDocumentAttachments(companyID, database, num, facturaId_BC, client_id, client_secret, tenant, entorno);
            /*const post = await this.postInvoice(companyID, facturaId_BC, client_id, client_secret, tenant, entorno, endpoint);
            if (post.status === 204) {
              console.log(`✅ Factura de compra ${num} sincronizada correctamente.`);
              await this.updateRegistro(companyID, database, facturaId_BC, client_id, client_secret, tenant, entorno, endpoint);
            }*/
          });
        } catch (error) {
          await this.handleError(error, num, endpoint, token, companyID, tenant, entorno, yearPart);
          i++;
          continue;
        }
        console.log(`⏳ Sincronizando facturas de compra... -> ${i}/${idFacturas.length} --- ${((i / idFacturas.length) * 100).toFixed(2)}% `);
        i++;
      }
      return true;
    } catch (error) {
      this.logError(`❌ Error procesando las facturas de compra`, error);
      return false;
    }
  }

  async processInvoiceLines(purchaseInvoiceData, endpointline, companyID, database, tabCompresDATA, Hit_IdFactura, empNif: string, client_id: string, client_secret: string, tenant: string, entorno: string) {
    console.log(`📦 Procesando líneas de la factura de compra...`);
    const itemCache = new Map<string, string | false>();
    try {
      const sqlQ = `SELECT
                    SUM(f.Servit) AS Servit,
                    SUM(f.Tornat) AS Tornat,
                    ROUND(f.preu, 3) AS UnitPrice,
                    CAST(f.Producte AS VARCHAR) AS Producto,
                    case when mp.codigo<>'' then mp.codigo else left(mp.nombre, 5) end AS Plu,
                    f.desconte as Descuento,
                    f.iva as Iva,
                    f.ProducteNom as Nombre,
                    isnull(f.acabat, '') as nSerie
                FROM ${tabCompresDATA} f
                LEFT JOIN ccMateriasPrimas mp on f.producte=mp.id
                WHERE f.idFactura = '${Hit_IdFactura}'
                GROUP BY
                    f.Producte,
                    mp.Codigo,
                    left(mp.nombre, 5),
                    f.Desconte,
                    f.Preu,
                    f.Iva,
                    f.ProducteNom,
                    f.Acabat
                ORDER BY Nombre;`;

      const invoiceLines = await this.sql.runSql(sqlQ, database);
      if (invoiceLines.recordset.length === 0) {
        console.warn(`⚠️ La factura de compra ${Hit_IdFactura} no tiene líneas.`);
        return purchaseInvoiceData;
      }

      for (const line of invoiceLines.recordset) {
        if (!line.Plu && line.Producto) {
          const codigo = this.shortCodigo(String(line.Producto));
          await this.ensureMateriaPrima(database, codigo, line.Nombre, line.UnitPrice, line.Iva, empNif);
          line.Plu = codigo;
        }
      }

      const limit = pLimit(15);

      const promises = invoiceLines.recordset.map((line) =>
        limit(async () => {
          //console.log(`🔎 Línea factura: Producto=${line.Producto}, Plu=${line.Plu}, Nombre=${line.Nombre}`);
          let itemAPI: string | false = false;
          if (line.Plu) {
            itemAPI = itemCache.get(line.Plu);
            if (itemAPI === undefined) {
              itemAPI = await this.itemsMP.getItemFromAPI(companyID, database, line.Plu, client_id, client_secret, tenant, entorno);
              if (!itemAPI) {
                //console.warn(`⚠️ Artículo MP_${line.Plu} no encontrado en API, intentando registrarlo...`);
                const registeredId = await this.itemsMP.syncItemsMP(companyID, database, client_id, client_secret, tenant, entorno, line.Plu);
                if (registeredId) {
                  itemAPI = String(registeredId);
                  //console.log(`✅ Artículo MP ${line.Plu} registrado. ID: ${itemAPI}`);
                }
              }
              itemCache.set(line.Plu, itemAPI);
            }
          }

          if (itemAPI === 'error') return;

          const servit = Number(line.Servit || 0);
          const tornat = Number(line.Tornat || 0);

          if (servit === 0 && tornat === 0) {
            const errorMsg = `❌ La línea con producto ${line.Plu} tiene cantidad 0`;
            this.logError(errorMsg, new Error(errorMsg));
            throw new Error(errorMsg);
          }

          if (line.UnitPrice === null || line.UnitPrice === undefined) {
            const errorMsg = `❌ La línea con producto ${line.Plu} tiene un precio nulo. Sincronización abortada.`;
            this.logError(errorMsg, new Error(errorMsg));
            throw new Error(errorMsg);
          }

          const addLineToInvoice = (qtyValue: number, isTornat: boolean) => {
            if (qtyValue === 0) return;

            let quantity = Math.abs(qtyValue);
            let unitPrice = line.UnitPrice;
            let qtySign = isTornat ? -1 : 1;

            if (endpointline === 'purchaseInvoiceLines' && qtySign < 0) {
              unitPrice *= -1;
            }

            if (endpointline === 'purchaseCreditMemoLines' && qtySign > 0) {
              unitPrice *= -1;
            }

            if (itemAPI) {
              purchaseInvoiceData[endpointline].push({
                itemId: itemAPI,
                lineType: 'Item',
                quantity: quantity,
                unitCost: unitPrice,
                discountPercent: line.Descuento,
                taxCode: `IVA${line.Iva}`,
                _nSerie: line.nSerie || '',
                _itemNo: line.Plu ? `MP_${line.Plu}` : '',
              });
            } else {
              purchaseInvoiceData[endpointline].push({
                lineObjectNumber: qtySign > 0 ? '6000001' : '6090001',
                description: (line.Nombre || '').substring(0, 100),
                lineType: 'Account',
                quantity: quantity,
                unitCost: unitPrice,
                discountPercent: line.Descuento,
                taxCode: `IVA${line.Iva}`,
              });
            }
          };

          addLineToInvoice(servit, false);
          addLineToInvoice(tornat, true);
        }),
      );

      await Promise.all(promises);

      console.log(`✅ Todas las líneas de la factura de compra procesadas`);
      return purchaseInvoiceData;
    } catch (error) {
      this.logError('❌ Error en el procesamiento de las líneas de la factura de compra', error);
      throw error;
    }
  }

  private shortCodigo(producte: string): string {
    if (producte.length <= 17) return producte;
    return createHash('sha1').update(producte).digest('hex').substring(0, 8).toUpperCase();
  }

  private async ensureMateriaPrima(database: string, codigo: string, nombre: string, precio: number, iva: number, empNif: string) {
    const existing = await this.sql.runSql(`SELECT TOP 1 id FROM ccMateriasPrimas WHERE Codigo = '${codigo}'`, database);
    if (existing.recordset.length > 0) return;

    let proveedorId: string | number | null = null;
    if (empNif) {
      const prov = await this.sql.runSql(`SELECT TOP 1 id FROM ccProveedores WHERE NIF = '${empNif}'`, database);
      if (prov.recordset.length > 0) proveedorId = prov.recordset[0].id;
    }

    const safeNombre = (nombre || codigo).replace(/'/g, "''");
    const proveedorSql = proveedorId !== null ? `'${proveedorId}'` : 'NULL';
    const insertSql = `INSERT INTO ccMateriasPrimas (id, Codigo, Nombre, Precio, iva, activo, proveedor)
                       VALUES (NEWID(), '${codigo}', '${safeNombre}', ${precio ?? 0}, ${iva ?? 0}, 1, ${proveedorSql})`;
    await this.sql.runSql(insertSql, database);
    console.log(`✅ Materia prima creada en ccMateriasPrimas: Codigo=${codigo}, Nombre=${safeNombre}`);
  }

  private async createPurchaseInvoice(endpoint: string, invoiceData, token: string, tenant: string, entorno: string, companyID: string) {
    console.log(`📡 Enviando factura de compra ${invoiceData.vendorInvoiceNumber} a la API de Business Central...`);
    const body: any = {
      vendorNumber: invoiceData.vendorNumber,
      vendorInvoiceNumber: invoiceData.vendorInvoiceNumber,
      postingDate: invoiceData.postingDate,
      currencyCode: invoiceData.currencyCode || '',
    };

    if (invoiceData.dueDate) {
      body.dueDate = invoiceData.dueDate;
    }

    if (endpoint === 'purchaseInvoices') {
      body.invoiceDate = invoiceData.invoiceDate;
    } else {
      body.creditMemoDate = invoiceData.creditMemoDate;
    }

    const response = await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/${endpoint}`, body, {
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
    });

    const id = response.data.id;
    const number = response.data.number;
    //console.log(`🆔 ID de la factura de compra: ${id}`);
    return { id, number };
  }

  private async createInvoiceLines(id, purchaseInvoiceData, endpoint, token: string, tenant: string, entorno: string, companyID: string): Promise<Array<{ sequence: number; nSerie: string; itemNo: string }>> {
    try {
      let allLines;
      let lineEndpoint;
      if (endpoint === 'purchaseInvoices') {
        allLines = purchaseInvoiceData.purchaseInvoiceLines;
        lineEndpoint = 'purchaseInvoiceLines';
      } else if (endpoint === 'purchaseCreditMemos') {
        allLines = purchaseInvoiceData.purchaseCreditMemoLines;
        lineEndpoint = 'purchaseCreditMemoLines';
      } else {
        throw new Error('Endpoint desconocido. No se puede insertar líneas.');
      }

      const trackingInfo: Array<{ sequence: number; nSerie: string; itemNo: string }> = [];
      const chunkSize = 100;
      for (let i = 0; i < allLines.length; i += chunkSize) {
        const chunk = allLines.slice(i, i + chunkSize);

        for (const line of chunk) {
          const { _nSerie, _itemNo, ...lineData } = line;
          const lineResponse = await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/${endpoint}(${id})/${lineEndpoint}`, lineData, {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          });
          if (_nSerie) {
            //console.log(`📌 nSerie='${_nSerie}' itemNo='${_itemNo}' sequence=${lineResponse.data.sequence}`);
            trackingInfo.push({ sequence: lineResponse.data.sequence, nSerie: _nSerie, itemNo: _itemNo || '' });
          }
        }

        console.log(`✅ Bloque de líneas ${i + 1} a ${i + chunk.length} insertado.`);
      }
      console.log(`✅ Todas las líneas insertadas.`);
      return trackingInfo;
    } catch (error) {
      this.logError('❌ Error al crear las líneas de la factura de compra', error);
      throw error;
    }
  }

  private async createTrackingSpecifications(invoiceNumber: string, invoiceId: string, endpoint: string, trackingLines: Array<{ sequence: number; nSerie: string; itemNo: string }>, token: string, tenant: string, entorno: string, companyID: string) {
    //console.log(`📋 trackingSpecifications: ${trackingLines.length} línea(s) total, invoiceNumber='${invoiceNumber}'`);
    const linesWithSerie = trackingLines.filter((l) => l.nSerie && l.nSerie !== '');
    if (linesWithSerie.length === 0) {
      console.log(`⚠️ Ninguna línea tiene nSerie, no se crean trackingSpecifications.`);
      return;
    }

    let sourceID = invoiceNumber;
    if (!sourceID) {
      console.warn(`⚠️ invoiceNumber vacío, obteniendo número desde BC...`);
      try {
        const inv = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/${endpoint}(${invoiceId})`, {
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        });
        sourceID = inv.data.number;
        //console.log(`📋 Número obtenido desde BC: '${sourceID}'`);
      } catch (err) {
        this.logError(`❌ No se pudo obtener el número de la factura ${invoiceId}`, err);
        throw err;
      }
    }

    let nextEntryNo: number | null = null;
    const trackingUrl = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/trackingSpecifications`;

    for (const line of linesWithSerie) {
      try {
        // Check if BC already created an empty tracking spec for this line (auto-created on line insert)
        const existingRes = await axios.get(`${trackingUrl}?$filter=SourceID eq '${sourceID}' and SourceRefNo eq ${line.sequence} and ItemNo eq '${line.itemNo}'`, { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } });
        //console.log(`📋 trackingSpecs existentes para SourceRefNo=${line.sequence}: ${existingRes.data.value.length}`);

        if (existingRes.data.value.length > 0) {
          const existing = existingRes.data.value[0];
          //console.log(`📋 PATCH trackingSpec EntryNo=${existing.EntryNo} → SerialNo='${line.nSerie}'`);
          await axios.patch(`${trackingUrl}(${existing.EntryNo})`, { SerialNo: line.nSerie, QuantityBase: 1 }, { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'If-Match': '*' } });
        } else {
          if (nextEntryNo === null) {
            const maxRes = await axios.get(`${trackingUrl}?$orderby=EntryNo desc&$top=1`, {
              headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
            });
            nextEntryNo = maxRes.data.value.length > 0 ? maxRes.data.value[0].EntryNo + 1 : 1;
          }
          const body = {
            EntryNo: nextEntryNo,
            sourceType: 39,
            sourceSubType: '2',
            SourceID: sourceID,
            SourceRefNo: line.sequence,
            ReservationStatus: 'Prospect',
            ItemNo: line.itemNo,
            SerialNo: line.nSerie,
            QuantityBase: 1,
            QtytoHandleBase: 1,
            QtytoInvoiceBase: 1,
          };
          //console.log(`📋 POST trackingSpec:`, JSON.stringify(body));
          const createResp = await axios.post(trackingUrl, body, { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } });
          //console.log(`📋 trackingSpec response:`, JSON.stringify(createResp.data));
          nextEntryNo++;
        }
      } catch (error) {
        this.logError(`❌ Error creando tracking specification para nSerie ${line.nSerie}`, error);
        throw error;
      }
    }
    console.log(`✅ ${linesWithSerie.length} tracking specification(s) creada(s).`);
  }

  async getPurchaseFromAPI(companyID, facturaId_BC, endpoint, client_id: string, client_secret: string, tenant: string, entorno: string) {
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
      this.logError(`❌ Error obteniendo compra desde API para el documento ${facturaId_BC}`, error);
      throw error;
    }
  }

  async getPurchaseLinesFromAPI(companyID, facturaId_BC, endpoint, client_id: string, client_secret: string, tenant: string, entorno: string) {
    try {
      let lineEndpoint;
      if (endpoint === 'purchaseInvoices') {
        lineEndpoint = 'purchaseInvoiceLines';
      } else if (endpoint === 'purchaseCreditMemos') {
        lineEndpoint = 'purchaseCreditMemoLines';
      } else {
        throw new Error('Endpoint desconocido.');
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
      this.logError(`❌ Error obteniendo líneas de compra desde API para el documento ${facturaId_BC}`, error);
      throw error;
    }
  }

  async updateSQLPurchase(companyID, facturaId_BC, endpoint, client_id, client_secret, tenant, entorno, idPurchaseHit, database) {
    try {
      const purchaseData = await this.getPurchaseFromAPI(companyID, facturaId_BC, endpoint, client_id, client_secret, tenant, entorno);

      if (!purchaseData.data) {
        console.warn(`⚠️ No se encontró información para la factura de compra ${facturaId_BC}`);
        return false;
      }

      const { id, number, postingDate, vendorId, totalAmountIncludingTax } = purchaseData.data;
      const year = postingDate.split('-')[0];

      const updateSql = `UPDATE [BC_SyncPurchase_${year}]
                         SET BC_IdPurchase = '${id}',
                            BC_Number = '${number}',
                            BC_PostingDate = '${postingDate}',
                            BC_VendorId = '${vendorId}',
                            BC_totalAmountIncludingTax = ${totalAmountIncludingTax}
                         WHERE HIT_IdFactura = '${idPurchaseHit}'`;

      await this.sql.runSql(updateSql, database);
    } catch (error) {
      this.logError(`❌ Error al actualizar la factura de compra con id ${facturaId_BC} en BC_SyncPurchase`, error);
      throw error;
    }
  }

  private async handleError(error: any, numFactura: string, endpoint, token: string, companyID: string, tenant: string, entorno: string, yearPart?: string) {
    this.logError(`❌ Error al procesar la factura de compra ${numFactura}`, error);
    if (numFactura && numFactura !== '' && endpoint) {
      try {
        const dateField = endpoint === 'purchaseInvoices' ? 'invoiceDate' : 'creditMemoDate';
        let filter = `vendorInvoiceNumber eq '${numFactura}'`;
        if (yearPart) {
          filter += ` and ${dateField} ge ${yearPart}-01-01 and ${dateField} le ${yearPart}-12-31`;
        }
        const factura = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/${endpoint}?$filter=${filter}`, {
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        });
        if (!factura.data.value[0]) {
          console.log(`📘 La factura de compra ${numFactura} no se creó en BC.`);
          return;
        }
        await axios.delete(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/${endpoint}(${factura.data.value[0].id})`, {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        });
        console.log(`🗑️  La factura de compra ${numFactura} se ha eliminado de BC a causa de un error.`);
      } catch (deleteError) {
        this.logError(`❌ Error eliminando la factura de compra ${numFactura} de BC: ${deleteError.message}`, deleteError);
      }
    }
  }

  async updateRegistro(companyID: string, database: string, idFactura: string, client_id: string, client_secret: string, tenant: string, entorno: string, endpoint: string) {
    try {
      const purchaseData = await this.getPurchaseFromAPI(companyID, idFactura, endpoint, client_id, client_secret, tenant, entorno);
      const purchaseDataLines = await this.getPurchaseLinesFromAPI(companyID, idFactura, endpoint, client_id, client_secret, tenant, entorno);

      if (!purchaseData.data) {
        console.warn(`⚠️ No se encontró información para la factura de compra ${idFactura}`);
        return false;
      }
      if (!purchaseDataLines.data || purchaseDataLines.data.value.length === 0) {
        console.warn(`⚠️ No se encontraron líneas para la factura de compra ${idFactura}`);
        return false;
      }
      const year = purchaseData.data.postingDate.split('-')[0];
      const number = purchaseData.data.number;

      const updateSql = `UPDATE [BC_SyncPurchase_${year}]
                         SET Registrada = 'Si', BC_Number='${number}'
                         WHERE BC_IdPurchase = '${idFactura}'`;

      await this.sql.runSql(updateSql, database);
    } catch (error) {
      this.logError(`❌ Error al actualizar la factura de compra con id ${idFactura} en BC_SyncPurchase`, error);
      throw error;
    }
    console.log(`✅ Registro de compra actualizado correctamente para la factura ${idFactura}`);
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
            'Content-Type': 'application/json',
          },
        },
      );
      console.log(`✅ Factura de compra ${idFactura} registrada correctamente.`);
      return response;
    } catch (error) {
      this.logError(`❌ Error al registrar la factura de compra ${idFactura}`, error);
      throw error;
    }
  }

  async getInvoiceByNumber(companyID: string, invoiceNumber: string, client_id: string, client_secret: string, tenant: string, entorno: string, database: string) {
    const endpoint = invoiceNumber.startsWith('RE/') ? 'purchaseCreditMemos' : 'purchaseInvoices';
    try {
      const token = await this.token.getToken2(client_id, client_secret, tenant);
      const url = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/${endpoint}?$filter=number eq '${invoiceNumber}'`;
      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      const factura = response.data.value[0];
      if (!factura) {
        console.warn(`⚠️ No se encontró la factura de compra con número ${invoiceNumber}`);
        return;
      }
      const year = factura.postingDate.split('-')[0];

      const selectQuery = `SELECT HIT_IdFactura FROM [BC_SyncPurchase_${year}] WHERE BC_IdPurchase = '${factura.id}' and BC_PostingDate = '${factura.postingDate}' and BC_VendorId = '${factura.vendorId}' and BC_totalAmountIncludingTax = ${factura.totalAmountIncludingTax}`;
      const existingRecord = await this.sql.runSql(selectQuery, database);
      if (existingRecord.recordset.length > 0) {
        console.log(`La factura de compra ${invoiceNumber} ya existe en BC_SyncPurchase_${year}. No se insertará de nuevo.`);
        return;
      } else {
        const insertQuery = `INSERT INTO [BC_SyncPurchase_${year}] (Id, HIT_IdFactura, HIT_ProveidorNom, HIT_ProveidorCodi, BC_IdPurchase, BC_Number, BC_PostingDate, BC_VendorId, BC_totalAmountIncludingTax, Registrada) VALUES
        (newid(), newid(), '${factura.vendorName}', '${factura.vendorNumber}', '${factura.id}', '${factura.number}', '${factura.postingDate}', '${factura.vendorId}', ${factura.totalAmountIncludingTax}, 'Si');`;
        await this.sql.runSql(insertQuery, database);
      }
      return true;
    } catch (error) {
      this.logError(`❌ Error al obtener la factura de compra ${invoiceNumber}`, error);
    }
  }

  async rellenarBCSyncPurchase(companyID: string, database: string, ids: string[], client_id: string, client_secret: string, tenant: string, entorno: string, year: string) {
    const token = await this.token.getToken2(client_id, client_secret, tenant);
    for (const id2 of ids) {
      const getNumSql = `SELECT HIT_NumFactura, HIT_SerieFactura, HIT_Total FROM [BC_SyncPurchase_${year}] WHERE HIT_IdFactura = '${id2}'`;
      const numResult = await this.sql.runSql(getNumSql, database);
      const vendorInvoiceNumber = `${numResult.recordset[0].HIT_SerieFactura}${numResult.recordset[0].HIT_NumFactura}`;
      let endpoint;
      if (numResult.recordset[0].HIT_Total > 0) {
        endpoint = 'purchaseInvoices';
      } else {
        endpoint = 'purchaseCreditMemos';
      }
      let res;
      try {
        const dateField = endpoint === 'purchaseInvoices' ? 'invoiceDate' : 'creditMemoDate';
        const yearFilter = `${dateField} ge ${year}-01-01 and ${dateField} le ${year}-12-31`;
        const url = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/${endpoint}?$filter=vendorInvoiceNumber eq '${vendorInvoiceNumber}' and totalAmountIncludingTax ne 0 and ${yearFilter}`;
        res = await axios.get(url, {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        });
      } catch (error) {
        this.logError(`❌ Error consultando factura de compra en BC con número ${vendorInvoiceNumber}, pasamos a la siguiente factura`, error);
      }
      if (!res || res.data.value.length === 0) {
        console.warn(`⚠️ No se encontró la factura de compra con número ${vendorInvoiceNumber} en BC, pasamos a la siguiente factura`);
        continue;
      }
      const id = res.data.value[0].id;
      await this.updateSQLPurchase(companyID, id, endpoint, client_id, client_secret, tenant, entorno, id2, database);
      await this.updateRegistro(companyID, database, id, client_id, client_secret, tenant, entorno, endpoint);
    }
    return true;
  }

  private logError(message: string, error: any) {
    const errorDetail = error?.response?.data || error?.message || 'Error desconocido';
    this.client.publish('/Hit/Serveis/Apicultor/Log', JSON.stringify({ message, error: errorDetail }));
    console.error(message, errorDetail);
  }
}
