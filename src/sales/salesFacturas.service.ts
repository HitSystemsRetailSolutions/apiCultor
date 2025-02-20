import { Injectable } from '@nestjs/common';
import { getTokenService } from '../conection/getToken.service';
import { runSqlService } from 'src/conection/sqlConection.service';
import axios from 'axios';
import { customersService } from 'src/customers/customers.service';
import { itemsService } from 'src/items/items.service';
import { log } from 'console';

interface Line {
  '@odata.etag': string;
  lineType: string;
  lineObjectNumber: string;
  description: string;
  unitOfMeasureCode: string;
  quantity: number;
  unitPrice: number;
  taxCode: string;
  amountIncludingTax: number;
}

@Injectable()
export class salesFacturasService {
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
    private customers: customersService,
    private items: itemsService,
  ) {}

  async getSaleFromAPI(companyID, docNumber, endpoint, client_id: string, client_secret: string, tenant: string, entorno: string) {
    try {
      const token = await this.token.getToken2(client_id, client_secret, tenant);
      const res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/${endpoint}?$filter=externalDocumentNumber eq '${docNumber}'`, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      });
      return res;
    } catch (error) {
      throw new Error('Failed to obtain ticket');
    }
  }

  async syncSalesFacturas(companyID: string, database: string, idFacturas: string[], tabla: string, client_id: string, client_secret: string, tenant: string, entorno: string) {
    try {
      const token = await this.token.getToken2(client_id, client_secret, tenant);
      const tabFacturacioIVA = `[FACTURACIO_${tabla}_IVA]`;
      const tabFacturacioDATA = `[FACTURACIO_${tabla}_DATA]`;
      let i = 1;
      for (const idFactura of idFacturas) {
        try {
          const sqlQ = `SELECT * FROM ${tabFacturacioIVA} WHERE idFactura = '${idFactura}'`;
          const facturas = await this.sql.runSql(sqlQ, database);

          if (facturas.recordset.length === 0) {
            console.log(`Factura con ID ${idFactura} no encontrada en la base de datos.`);
            continue;
          }

          const x = facturas.recordset[0];
          const datePart = x.DataFactura.toISOString().split('T')[0];
          const num = x.Serie.length <= 0 ? x.NumFactura : x.Serie + x.NumFactura;

          const endpoint = x.Total >= 0 ? 'salesInvoices' : 'salesCreditMemos';
          const endpointline = x.Total >= 0 ? 'salesInvoiceLines' : 'salesCreditMemoLines';

          console.log(`-------------------SINCRONIZANDO FACTURA NÚMERO ${num} -----------------------`);
          const customerId = await this.customers.getCustomerFromAPI(companyID, database, x.ClientCodi, client_id, client_secret, tenant, entorno);

          let res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/${endpoint}?$filter=externalDocumentNumber eq '${num}'`, {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          });

          let idSaleHit = x.IdFactura;

          if (!res.data) throw new Error('Failed to obtain sale');

          let facturaId_BC;
          if (res.data.value.length === 0) {
            console.log('Factura no encontrada en BC, creando nueva factura...');

            let invoiceData;
            if (x.Total >= 0) {
              invoiceData = {
                externalDocumentNumber: num.toString(),
                invoiceDate: datePart,
                postingDate: datePart,
                customerId: customerId,
              };
            } else {
              invoiceData = {
                externalDocumentNumber: num.toString(),
                creditMemoDate: datePart,
                postingDate: datePart,
                customerId: customerId,
              };
            }
            console.log(invoiceData);
            const newFacturas = await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/${endpoint}`, invoiceData, {
              headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json',
              },
            });

            if (!newFacturas.data) throw new Error('--Failed post--');

            try {
              if (x.Total < 0 && x.ClientNif != '22222222J') {
                const sqlQ = `SELECT SUBSTRING(Comentari, CHARINDEX('[RECTIFICATIVA_DE:', Comentari) + 18, CHARINDEX(']', Comentari, CHARINDEX('[RECTIFICATIVA_DE:', Comentari)) - CHARINDEX('[RECTIFICATIVA_DE:', Comentari) - 18) AS rectificativa from FacturacioComentaris WHERE idFactura = '${idFactura}'`;
                const facturaComentari = await this.sql.runSql(sqlQ, database);
                const correctedInvoice = await axios.get(
                  `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices?$filter=externalDocumentNumber eq '${facturaComentari.recordset[0].rectificativa}' `,
                  {
                    headers: {
                      Authorization: 'Bearer ' + token,
                      'Content-Type': 'application/json',
                    },
                  },
                );
                const updateData = {
                  CorrectedInvoiceNo: correctedInvoice.data.value[0].number,
                };
                //Esto solo funciona si la factura a la que corrige ya está registrada en BC
                const updateCreditMemo = await axios.patch(
                  `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/salesHeader(${newFacturas.data.id})`,
                  updateData,
                  {
                    headers: {
                      Authorization: 'Bearer ' + token,
                      'Content-Type': 'application/json',
                      'If-Match': '*',
                    },
                  },
                );
              }
            } catch (error) {
              console.error('Error updating credit memo:', error.response?.data || error.message);
            }
            facturaId_BC = newFacturas.data.id;
            console.log(`Factura creada con ID: ${facturaId_BC}`);
          } else {
            console.log('Ya existe la factura en BC');
            facturaId_BC = res.data.value[0]['id'];
          }
          await this.synchronizeSalesFacturasLines(companyID, database, endpoint, endpointline, tabFacturacioDATA, x.IdFactura, facturaId_BC, client_id, client_secret, tenant, entorno);

          let resSale = await this.getSaleFromAPI(companyID, num, endpoint, client_id, client_secret, tenant, entorno);
          if (!resSale.data) throw new Error('Failed to obtain ticket BS');
          if (resSale.data.value.length != 0) {
            const year = resSale.data.value[0].postingDate.split('-')[0];
            let updateSql = `
            UPDATE [BC_SyncSales_${year}] SET
              BC_IdSale = '${resSale.data.value[0].id}',
              BC_Number = '${resSale.data.value[0].number}',
              BC_PostingDate = '${resSale.data.value[0].postingDate}',
              BC_CustomerId = '${resSale.data.value[0].customerId}',
              BC_totalAmountIncludingTax = ${resSale.data.value[0].totalAmountIncludingTax}
            WHERE HIT_IdFactura = '${idSaleHit}'`;

            await this.sql.runSql(updateSql, database);
          }
        } catch (error) {
          console.log(`Error al procesar la factura ${idFactura}:`, error.message);
          continue;
        }
        console.log(`Sincronizando factura... -> ${i}/${idFacturas.length} --- ${((i / idFacturas.length) * 100).toFixed(2)}% `);
        i++;
      }
      return true;
    } catch (error) {
      console.error('Error en syncSalesFacturas:', error.message);
      return false;
    }
  }

  async synchronizeSalesFacturasLines(
    companyID,
    database,
    endpoint,
    endpointline,
    tabFacturacioDATA,
    Hit_IdFactura,
    BC_facturaId,
    client_id: string,
    client_secret: string,
    tenant: string,
    entorno: string,
  ) {
    try {
      const token = await this.token.getToken2(client_id, client_secret, tenant);
      const sqlQ = `SELECT SUM(CASE WHEN f.Servit = 0 THEN f.Tornat * -1 ELSE f.Servit END) AS Quantitat, round(f.preu,3) AS UnitPrice, CAST(f.Producte AS VARCHAR) AS Plu , f.desconte as Descuento, f.iva as Iva, f.ProducteNom as Nombre FROM ${tabFacturacioDATA} f WHERE f.idFactura = '${Hit_IdFactura}' GROUP BY f.Producte,f.Desconte,f.Preu,f.Iva,f.ProducteNom;`;
      const facturasLines = await this.sql.runSql(sqlQ, database);
      for (const line of facturasLines.recordset) {
        const itemAPI = await this.items.getItemFromAPI(companyID, database, line.Plu, client_id, client_secret, tenant, entorno);
        let lineData;
        let url;
        if (itemAPI) {
          lineData = {
            documentId: BC_facturaId,
            itemId: itemAPI,
            lineType: 'Item',
            quantity: line.Quantitat,
            unitPrice: line.UnitPrice,
            discountPercent: line.Descuento,
            taxCode: `IVA${line.Iva}`,
          };
          url = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/${endpoint}(${BC_facturaId})/${endpointline}?$filter=lineObjectNumber eq '${line.Plu}' and quantity eq ${line.Quantitat}`;
        } else {
          const sanitizedDescription = line.Nombre.replace(/'/g, "''");
          lineData = {
            documentId: BC_facturaId,
            lineObjectNumber: line.Quantitat > 0 ? '7000001' : '7090001',
            description: line.Nombre,
            lineType: 'Account',
            quantity: line.Quantitat,
            unitPrice: line.UnitPrice,
            discountPercent: line.Descuento,
            taxCode: `IVA${line.Iva}`,
          };
          url = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/${endpoint}(${BC_facturaId})/${endpointline}?$filter=description eq '${sanitizedDescription}' and quantity eq ${line.Quantitat}`;
        }
        const res = await axios.get(url, {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        });

        if (!res.data) throw new Error('Failed to get factura line');

        if (res.data.value.length === 0) {
          console.log('Línea de factura no encontrada, creando nueva línea para el producto ', line.Plu);
          await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/${endpoint}(${BC_facturaId})/${endpointline}`, lineData, {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          });
        } else {
          console.log('Línea de factura encontrada, actualizando línea existente para el producto ', line.Plu);
          const etag = res.data.value[0]['@odata.etag'];
          await axios.patch(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/${endpoint}(${BC_facturaId})/${endpointline}(${res.data.value[0].id})`, lineData, {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
              'If-Match': etag,
            },
          });
        }
      }
    } catch (error) {
      console.error('Error en synchronizeSalesFacturasLines:', error.message);
    }
  }
  async generateXML(companyID, idFactura, client_id: string, client_secret: string, tenant: string, entorno: string) {
    const token = await this.token.getToken2(client_id, client_secret, tenant);
    // Ejemplo de uso:
    let res = await axios
      .get(
        `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices(${idFactura})/salesInvoiceLines?$select=lineType,lineObjectNumber,description,unitOfMeasureCode,quantity,unitPrice,taxCode,amountIncludingTax`,
        {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        },
      )
      .catch((error) => {
        throw new Error('Failed to obtain xml');
      });
    const lines: Line[] = res.data.value;
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<salesInvoices>\n  <value>\n    <invoice>\n';
    lines.forEach((line) => {
      xml += `      <line>\n`;
      xml += `        <lineType>${line.lineType}</lineType>\n`;
      xml += `        <lineObjectNumber>${line.lineObjectNumber}</lineObjectNumber>\n`;
      xml += `        <description>${line.description}</description>\n`;
      xml += `        <unitOfMeasureCode>${line.unitOfMeasureCode}</unitOfMeasureCode>\n`;
      xml += `        <quantity>${line.quantity}</quantity>\n`;
      xml += `        <unitPrice>${line.unitPrice}</unitPrice>\n`;
      xml += `        <taxCode>${line.taxCode}</taxCode>\n`;
      xml += `        <amountIncludingTax>${line.amountIncludingTax}</amountIncludingTax>\n`;
      xml += `      </line>\n`;
    });
    xml += '    </invoice>\n  </value>\n</salesInvoices>';
    return { success: true, xmlData: xml };
  }
}
