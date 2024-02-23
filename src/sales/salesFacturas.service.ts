import { Injectable } from '@nestjs/common';
import { getTokenService } from '../conection/getToken.service';
import { runSqlService } from 'src/conection/sqlConection.service';
import axios from 'axios';
import { response } from 'express';
import { customersService } from 'src/customers/customers.service';
import { itemsService } from 'src/items/items.service';
@Injectable()

export class salesFacturasService {
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
    private customers: customersService,
    private items: itemsService,
  ) {}

  async getSaleFromAPI(companyID, docNumber) {
    // Get the authentication token
    let token = await this.token.getToken();

    let res = await axios
    .get(
      `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${companyID})/salesInvoices?$filter=externalDocumentNumber eq '${docNumber}'`,
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

  async syncSalesFacturas(companyID: string, database: string, idFactura: string, tabla: string) {
    let token = await this.token.getToken();
    let sqlQ;
    
    let tabFacturacioIVA = "[FACTURACIO_"  + tabla + "_IVA]"; //tabFacturacion FACTURACIO_2024-02_DATA
    let tabFacturacioDATA = "[FACTURACIO_"  + tabla + "_DATA]";
    sqlQ = "select * ";
    sqlQ = sqlQ + "from " + tabFacturacioIVA;
    sqlQ = sqlQ + " where idFactura= '" + idFactura + "'";
    let facturas = await this.sql.runSql(
      sqlQ,
      database,
    );
    let x = facturas.recordset[0];
    let facturaId_BC = "";
         
    let dataFactura = x.DataFactura;
    let datePart = dataFactura.toISOString().split('T')[0];
    let serieFactura = x.Serie;
    let numFactura = x.NumFactura;
    let num;
    if(serieFactura.length <= 0){
      num = numFactura;
      console.log('serieFactura vacio')
    } else{
      num = serieFactura + numFactura;
    }

    console.log("-------------------SINCRONIZANDO FACTURA NÚMERO " + num + " -----------------------");
    let customerId = await this.customers.getCustomerFromAPI(companyID, database, x.ClientCodi);
    //console.log("CLIENTE BC: " + customerId);

    let idSaleHit = x.IdFactura;

    let url = `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${companyID})/salesInvoices?$filter=externalDocumentNumber eq '${num}'`
    //console.log(url)
    let res = await axios
      .get(
        url,
        {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        },
      )
      .catch((error) => {
        throw new Error('Failed to obtain sale');
      });

      if (!res.data) throw new Error('Failed to obtain sale');
      //NO ESTÁ LA FACTURA EN BC
      if (res.data.value.length === 0) {
        let newFacturas = await axios
          .post(
            `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${companyID})/salesInvoices`,
            {
                externalDocumentNumber: num.toString(),
                invoiceDate: datePart,
                postingDate: datePart,
                customerId: customerId,
            },
              {
              headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json',
              },
            },
          )
          .catch((error) => {
            console.log('----------', num, '------------------')
            console.log('----------', datePart, '------------------')
            console.log('----------', customerId, '------------------')
            throw new Error('Failed post: ' + error);
          });

        if (!newFacturas.data)
          return new Error('--Failed post--');
        else{
          facturaId_BC = newFacturas.data.id;
          await this.synchronizeSalesFacturasLines(companyID, database, tabFacturacioDATA, x.IdFactura, facturaId_BC).catch(console.error);

          let resSale = await this.getSaleFromAPI(companyID, num);
          if (!resSale.data) throw new Error('Failed to obtain ticket BS');
          if (resSale.data.value.length != 0) {          
            sqlQ = "update [BC_SyncSales_2024] set ";
            sqlQ = sqlQ + "BC_IdSale='" + resSale.data.value[0].id + "', ";
            sqlQ = sqlQ + "BC_Number='" + resSale.data.value[0].number + "', ";
            sqlQ = sqlQ + "BC_PostingDate='" + resSale.data.value[0].postingDate + "', ";
            sqlQ = sqlQ + "BC_CustomerId= '" + resSale.data.value[0].customerId + "', ";
            sqlQ = sqlQ + "BC_totalAmountIncludingTax= '" + resSale.data.value[0].totalAmountIncludingTax + "' ";
            sqlQ = sqlQ + "where HIT_IdFactura ='" + idSaleHit + "'";
            let updBC = await this.sql.runSql(
              sqlQ,
              database,
            );
          }
        }
      } else {
        //YA ESTÁ LA FACTURA EN BC
        console.log('Ya existe la factura');
        facturaId_BC = res.data.value[0]['id'];
        await this.synchronizeSalesFacturasLines(companyID, database, tabFacturacioDATA, x.IdFactura, facturaId_BC).catch(console.error);
      }
    return true;
  }

  async synchronizeSalesFacturasLines(companyID, database, tabFacturacioDATA, Hit_IdFactura, BC_facturaId) {
    let token = await this.token.getToken();

    let sqlQ;
    sqlQ = "select sum(f.Servit) Quantitat, sum(f.preu + f.preu*(iva/100))/sum(f.servit) UnitPrice, CAST(f.Producte as varchar) Plu ";
    sqlQ = sqlQ + "From " + tabFacturacioDATA + " f ";
    sqlQ = sqlQ + "where f.idFactura='" + Hit_IdFactura + "' and f.import>0 ";
    sqlQ = sqlQ + "group by producte";
    let facturasLines = await this.sql.runSql(
      sqlQ,
      database,
    );
    
    for (let i = 0; i < facturasLines.recordset.length; i++) {
      let x = facturasLines.recordset[i];
      console.log("PPRODUCTO " + x.Plu);
      let itemId = await this.items.getItemFromAPI(companyID, database, x.Plu);
      
      let url2 = `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${companyID})/salesInvoices(${BC_facturaId})/salesInvoiceLines?$filter=lineObjectNumber eq 'CODI-${x.Plu}'`;

      //BUSCAMOS LA LINEA DE FACTURA
      let res = await axios
        .get(
          url2,
          {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          },
        )
        .catch((error) => {
          throw new Error('Failed to get factura line');
        });

      if (!res.data) throw new Error('Failed to get factura line');
      if(itemId.length <= 0){
        itemId = x.Plu;
      }
      //NO ESTÁ, LA AÑADIMOS
      let url =  `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${companyID})/salesInvoices(${BC_facturaId})/salesInvoiceLines`;

      if (res.data.value.length === 0) {
        let newFacturas = await axios
          .post(
            url,
            {
                documentId: BC_facturaId,
                itemId: itemId,
                quantity: x.Quantitat,
                unitPrice: x.UnitPrice
            },
            {
              headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json',
              },
            },
          )
          .catch((error) => {
            console.log('----------', BC_facturaId, '------------------')
            console.log('----------', itemId, '------------------')
            console.log('----------', x.Quantitat, '------------------')
            console.log('----------', x.UnitPrice, '------------------')
            throw new Error('Failed to post Factura line');
          });

      } else {
        //YA HAY UNA LINEA CON EL MISMO PRODUCTO, LA MODIFICAMOS
        console.log('Ya existe la Sale Line. Vamos a actualizarla');
        let z = res.data.value[0]['@odata.etag'];

        let newItems = await axios
          .patch(
            `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${companyID})/salesInvoices(${BC_facturaId})/salesInvoiceLines(${res.data.value[0].id})`,
            {
                documentId: BC_facturaId,
                itemId: itemId,
                quantity: x.Quantitat,
                unitPrice: x.UnitPrice
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
        if (!newItems.data)
          return new Error('Failed to update SALE LINE');

      }
    }
    return true;    
  }

  async getPDFSale(companyID, nFactura) {
    let token = await this.token.getToken();
    let sqlQ;
    //https://api.businesscentral.dynamics.com/v2.0/ace8eb1f-b96c-4ab5-91ae-4a66ffd58c96/production/api/v2.0/companies(c1fbfea4-f0aa-ee11-a568-000d3a660c9b)/salesInvoices(6e5217bc-cdb9-ee11-9078-000d3ab957cd)/pdfDocument/pdfDocumentContent
    let res = await axios
      .get(
        `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${companyID})/salesInvoices?$filter=number eq '102023'`,
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

      console.log("----------------" + ticketId + "-----------");
      let res2 = await axios
      .get(
        `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${companyID})/salesInvoices(${ticketId})/pdfDocument`,
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


}