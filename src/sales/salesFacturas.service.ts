import { Injectable } from '@nestjs/common';
import { getTokenService } from '../conection/getToken.service';
import { runSqlService } from 'src/conection/sqlConection.service';
import axios from 'axios';
import { response } from 'express';
import { customersService } from 'src/customers/customers.service';
import { itemsService } from 'src/items/items.service';

interface Line {
  "@odata.etag": string;
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
  ) { }

  async getSaleFromAPI(companyID, docNumber, client_id: string, client_secret: string, tenant: string, entorno: string) {
    // Get the authentication token
    let token = await this.token.getToken();

    let res = await axios
      .get(
        `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices?$filter=externalDocumentNumber eq '${docNumber}'`,
        {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        },
      )
      .catch((error) => {
        throw new Error('Failed to obtain ticket');
      });

    if (!res.data) throw new Error('Failed to obtain ticket');

    return res;
  }

  async syncSalesFacturas(companyID: string, database: string, idFactura: string, tabla: string, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let token = await this.token.getToken();
    let sqlQ;

    let tabFacturacioIVA = '[FACTURACIO_' + tabla + '_IVA]'; //tabFacturacion FACTURACIO_2024-02_DATA
    let tabFacturacioDATA = '[FACTURACIO_' + tabla + '_DATA]';
    sqlQ = 'select * ';
    sqlQ = sqlQ + 'from ' + tabFacturacioIVA;
    sqlQ = sqlQ + " where idFactura= '" + idFactura + "'";
    let facturas = await this.sql.runSql(sqlQ, database);
    let x = facturas.recordset[0];
    let facturaId_BC = '';

    let dataFactura = x.DataFactura;
    let datePart = dataFactura.toISOString().split('T')[0];
    let serieFactura = x.Serie;
    let numFactura = x.NumFactura;
    let num;
    if (serieFactura.length <= 0) {
      num = numFactura;
      //console.log('serieFactura vacio');
    } else {
      num = serieFactura + numFactura;
    }

    console.log(
      '-------------------SINCRONIZANDO FACTURA NÚMERO ' +
      num +
      ' -----------------------',
    );
    let customerId = await this.customers.getCustomerFromAPI(companyID, database, x.ClientCodi, client_id, client_secret, tenant, entorno);

    const customerResponse = await axios.get(
      `https://api.businesscentral.dynamics.com/v2.0/${process.env.MBC_TOKEN_TENANT}/ObradorDev/api/v2.0/companies(${process.env.MBC_COMPANYID_FILAPENA_DEV_TEST})/customers(${customerId})`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );

    const originalPaymentMethodId = customerResponse.data.paymentMethodId;
    const etag = customerResponse.data['@odata.etag'];
    console.log(etag);

    // Obtener el ID del método de pago segun el ticket que enviaremos
    const paymentMethodsResponse = await axios.get(
      `https://api.businesscentral.dynamics.com/v2.0/${process.env.MBC_TOKEN_TENANT}/ObradorDev/api/v2.0/companies(${process.env.MBC_COMPANYID_FILAPENA_DEV_TEST})/paymentMethods?$filter=code eq '${x.FormaPago}'`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );

    if (
      !paymentMethodsResponse.data.value ||
      paymentMethodsResponse.data.value.length === 0
    ) {
      throw new Error(
        `Método de pago ${x.FormaPago} no encontrado en la tabla de metodos de pagos de BC.`,
      );
    }

    // 2. Actualizar temporalmente el método de pago del cliente
    await axios.patch(
      `https://api.businesscentral.dynamics.com/v2.0/${process.env.MBC_TOKEN_TENANT}/ObradorDev/api/v2.0/companies(${process.env.MBC_COMPANYID_FILAPENA_DEV_TEST})/customers(${customerId})`,
      {
        paymentMethodId: paymentMethodsResponse.data.value[0].id,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'If-Match': etag, // Usar el ETag para el control de concurrencia
        },
      },
    );
    //console.log("CLIENTE BC: " + customerId);

    let idSaleHit = x.IdFactura;

    let url = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices?$filter=externalDocumentNumber eq '${num}'`;
    //console.log(url)
    let res = await axios
      .get(url, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      })
      .catch((error) => {
        throw new Error('Failed to obtain sale');
      });

    if (!res.data) throw new Error('Failed to obtain sale');
    //NO ESTÁ LA FACTURA EN BC
    if (res.data.value.length === 0) {
      let newFacturas = await axios
        .post(
          `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices`,
          {
            externalDocumentNumber: num.toString(),
            invoiceDate: datePart,
            postingDate: datePart,
            customerId: customerId,
            totalAmountIncludingTax: x.Import,
          },
          {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          },
        )
        .catch((error) => {
          console.log('----------', num, '------------------');
          console.log('----------', datePart, '------------------');
          console.log('----------', customerId, '------------------');
          throw new Error('Failed post: ' + error);
        });

      if (!newFacturas.data) return new Error('--Failed post--');
      else {
        facturaId_BC = newFacturas.data.id;
        await this.synchronizeSalesFacturasLines(
          companyID,
          database,
          tabFacturacioDATA,
          x.IdFactura,
          facturaId_BC,
          client_id,
          client_secret,
          tenant,
          entorno
        ).catch(console.error);

        let resSale = await this.getSaleFromAPI(companyID, num, client_id, client_secret, tenant, entorno);
        if (!resSale.data) throw new Error('Failed to obtain ticket BS');
        try {
          if (resSale.data.value.length != 0) {
            sqlQ = 'update [BC_SyncSales_2024] set ';
            sqlQ = sqlQ + "BC_IdSale='" + resSale.data.value[0].id + "', ";
            sqlQ = sqlQ + "BC_Number='" + resSale.data.value[0].number + "', ";
            sqlQ =
              sqlQ +
              "BC_PostingDate='" +
              resSale.data.value[0].postingDate +
              "', ";
            sqlQ =
              sqlQ +
              "BC_CustomerId= '" +
              resSale.data.value[0].customerId +
              "', ";
            sqlQ =
              sqlQ +
              "BC_totalAmountIncludingTax= '" +
              resSale.data.value[0].totalAmountIncludingTax +
              "' ";
            sqlQ = sqlQ + "where HIT_IdFactura ='" + idSaleHit + "'";
            let updBC = await this.sql.runSql(sqlQ, database);
          }
        } catch (error) {
          console.log('Error update BC_SyncSales_2024')
        }
      }
    } else {
      //YA ESTÁ LA FACTURA EN BC
      console.log('Ya existe la factura');
      facturaId_BC = res.data.value[0]['id'];
      await this.synchronizeSalesFacturasLines(
        companyID,
        database,
        tabFacturacioDATA,
        x.IdFactura,
        facturaId_BC,
        client_id,
        client_secret,
        tenant,
        entorno
      ).catch(console.error);
    }
    return true;
  }

  async synchronizeSalesFacturasLines(companyID, database, tabFacturacioDATA, Hit_IdFactura, BC_facturaId, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let token = await this.token.getToken();

    let sqlQ;
    sqlQ =
      'select sum(f.Servit) Quantitat, sum(f.import + f.import*(iva/100))/sum(f.servit) UnitPrice, CAST(f.Producte as varchar) Plu ';
    sqlQ = sqlQ + 'From ' + tabFacturacioDATA + ' f ';
    sqlQ = sqlQ + "where f.idFactura='" + Hit_IdFactura + "' and f.import>0 ";
    sqlQ = sqlQ + 'group by producte';
    let facturasLines = await this.sql.runSql(sqlQ, database);

    for (let i = 0; i < facturasLines.recordset.length; i++) {
      let x = facturasLines.recordset[i];
      console.log('PRODUCTO ' + x.Plu);
      let item;
      item = await this.items.getItemFromAPI(companyID, database, x.Plu, client_id, client_secret, tenant, entorno);

      let url2 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices(${BC_facturaId})/salesInvoiceLines?$filter=lineObjectNumber eq 'CODI-${x.Plu}'`;

      //BUSCAMOS LA LINEA DE FACTURA
      let res = await axios
        .get(url2, {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        })
        .catch((error) => {
          throw new Error('Failed to get factura line');
        });

      if (!res.data) throw new Error('Failed to get factura line');
      if (item.length <= 0) {
        item = x.Plu;
      }
      //NO ESTÁ, LA AÑADIMOS
      let url = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices(${BC_facturaId})/salesInvoiceLines`;

      if (res.data.value.length === 0) {
        let newFacturas = await axios
          .post(
            url,
            {
              documentId: BC_facturaId,
              itemId: item.id,
              quantity: x.Quantitat,
              unitPrice: x.UnitPrice,
              discountPercent: x.Desconte,
              taxCode: item.generalProductPostingGroupCode
            },
            {
              headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json',
              },
            },
          )
          .catch((error) => {
            console.log('----------', BC_facturaId, '------------------');
            console.log('----------', item.id, '------------------');
            console.log('----------', x.Quantitat, '------------------');
            console.log('----------', x.UnitPrice, '------------------');
            throw new Error('Failed to post Factura line');
          });
      } else {
        //YA HAY UNA LINEA CON EL MISMO PRODUCTO, LA MODIFICAMOS
        console.log('Ya existe la Sale Line. Vamos a actualizarla');
        let z = res.data.value[0]['@odata.etag'];

        let newItems = await axios
          .patch(
            `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices(${BC_facturaId})/salesInvoiceLines(${res.data.value[0].id})`,
            {
              documentId: BC_facturaId,
              itemId: item.id,
              quantity: x.Quantitat,
              unitPrice: x.UnitPrice,
              taxCode: item.generalProductPostingGroupCode
            },
            {
              headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json',
                'if-Match': z,
              },
            },
          )
          .catch((error) => {
            throw new Error('Failed to update SALE LINE');
          });
        if (!newItems.data) return new Error('Failed to update SALE LINE');
      }
    }
    return true;
  }

  async getPDFSale(companyID, nFactura, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let token = await this.token.getToken();
    let sqlQ;
    //https://api.businesscentral.dynamics.com/v2.0/ace8eb1f-b96c-4ab5-91ae-4a66ffd58c96/${entorno}/api/v2.0/companies(c1fbfea4-f0aa-ee11-a568-000d3a660c9b)/salesInvoices(6e5217bc-cdb9-ee11-9078-000d3ab957cd)/pdfDocument/pdfDocumentContent
    let res = await axios
      .get(
        `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices?$filter=number eq '102023'`,
        {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        },
      )
      .catch((error) => {
        throw new Error('Failed to obtain ticket');
      });

    let ticketId = res.data.value[0].id;

    console.log('----------------' + ticketId + '-----------');
    let res2 = await axios
      .get(
        `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices(${ticketId})/pdfDocument`,
        {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        },
      )
      .catch((error) => {
        throw new Error('Failed to obtain PDF ticket');
      });
    return true;
  }

  async generateXML(companyID, idFactura, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let token = await this.token.getToken();
    console.log(companyID)
    console.log(idFactura)
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