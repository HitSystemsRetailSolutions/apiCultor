import { Injectable } from '@nestjs/common';
import { getTokenService } from '../conection/getToken.service';
import { runSqlService } from 'src/conection/sqlConection.service';
import axios from 'axios';
import { response } from 'express';
@Injectable()

export class salesFacturasService {
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) {}

  async getCustomerFromAPI(codiHIT) {
    let customerId = '';

    // Get the authentication token
    let token = await this.token.getToken();

    // Get Customer from API
    let res = await axios
      .get(
        `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${process.env.companyID})/customers?$filter=number eq '${codiHIT}'`,
        {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        },
      )
      .catch((error) => {
        throw new Error('Failed to obtain customer');
      });

    if (!res.data) throw new Error('Failed to obtain customer');

    if (res.data.value.length === 0) {
    } else {
      customerId = res.data.value[0].id;
    }
    return customerId;
  }

async getItemFromAPI(codiHIT) {
    let itemId = '';

    // Get the authentication token
    let token = await this.token.getToken();

    // Get Item from API
    let res = await axios
      .get(
        `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${process.env.companyID})/items?$filter=number eq 'CODI-${codiHIT}'`,
        {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        },
      )
      .catch((error) => {
        throw new Error('Failed to obtain item');
      });

    if (!res.data) throw new Error('Failed to obtain item');

    if (res.data.value.length === 0) {
    } else {
        itemId = res.data.value[0].id;
    }
    return itemId;
  }

  async getSaleFromAPI(docNumber) {
    // Get the authentication token
    let token = await this.token.getToken();

    let res = await axios
    .get(
      `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${process.env.companyID})/salesInvoices?$filter=externalDocumentNumber eq '${docNumber}'`,
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

  async syncSalesFacturas() {
    let token = await this.token.getToken();
    let sqlQ;

    sqlQ = "select Id, HIT_IdFactura, HIT_EmpresaCodi , HIT_SerieFactura , HIT_NumFactura , convert(varchar, HIT_DataFactura, 23) HIT_DataFactura, HIT_Total, HIT_ClientCodi, HIT_ClientNom ";
    sqlQ = sqlQ + "from [BC_SyncSales_2024] ";
    sqlQ = sqlQ + "where BC_IdSale is null  ";
    sqlQ = sqlQ + "order by  HIT_NumFactura, HIT_DataFactura";
        
    let facturas = await this.sql.runSql(
      sqlQ,
      'fac_Hitrs',
    );

    for (let i = 0; i < facturas.recordset.length; i++) {
      let x = facturas.recordset[i];
      let facturaId_BC = "";
      let idFactura = x.HIT_IdFactura;      
      let dataFactura = x.HIT_DataFactura;
      let tabFacturacioIVA = "[FACTURACIO_"  +  x.HIT_DataFactura.split('-')[0]  + "-" + x.HIT_DataFactura.split('-')[1] + "_IVA]";
      let tabFacturacioDATA = "[FACTURACIO_"  +  x.HIT_DataFactura.split('-')[0]  + "-" + x.HIT_DataFactura.split('-')[1] + "_DATA]";
      let customerId = await this.getCustomerFromAPI(x.HIT_ClientCodi);
      let idSaleHit = x.Id;
      console.log("---------------------------------------" + x.HIT_NumFactura + "-----------------------------------------");
      let res = await axios
        .get(
          `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${process.env.companyID})/salesInvoices?$filter=externalDocumentNumber eq '${x.HIT_SerieFactura+x.HIT_NumFactura}'`,
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
            `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${process.env.companyID})/salesInvoices`,
            {
                externalDocumentNumber: x.HIT_SerieFactura + x.HIT_NumFactura,
                invoiceDate: dataFactura,
                postingDate: dataFactura,
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
            throw new Error('Failed post');
          });

        if (!newFacturas.data)
          return new Error('Failed post');
        else{
          facturaId_BC = newFacturas.data.id;
          await this.synchronizeSalesFacturasLines(tabFacturacioDATA, x.HIT_IdFactura, facturaId_BC).catch(console.error);
          //console.log("------------------------------------------------------" + x.HIT_SerieFactura + x.HIT_NumFactura + "-------------------------------");
          let resSale = await this.getSaleFromAPI(x.HIT_SerieFactura + x.HIT_NumFactura);
          if (!resSale.data) throw new Error('Failed to obtain ticket BS');
          if (resSale.data.value.length != 0) {          
            //console.log(resSale);
            sqlQ = "update [BC_SyncSales_2024] set ";
            sqlQ = sqlQ + "BC_IdSale='" + resSale.data.value[0].id + "', ";
            sqlQ = sqlQ + "BC_Number='" + resSale.data.value[0].number + "', ";
            sqlQ = sqlQ + "BC_PostingDate='" + resSale.data.value[0].postingDate + "', ";
            sqlQ = sqlQ + "BC_CustomerId= '" + resSale.data.value[0].customerId + "', ";
            sqlQ = sqlQ + "BC_totalAmountIncludingTax= '" + resSale.data.value[0].totalAmountIncludingTax + "' ";
            sqlQ = sqlQ + "where id ='" + idSaleHit + "'";
            let updBC = await this.sql.runSql(
                sqlQ,
                'fac_hitrs',
              );
          }
        }
      } else {
        //YA ESTÁ LA FACTURA EN BC
        console.log('Ya existe la factura');
        //console.log(res.data);
        //facturaId_BC = res.data.value[0]['id'];
        //await this.synchronizeSalesFacturasLines(tabFacturacioDATA, x.HIT_IdFactura, facturaId_BC).catch(console.error);

        //console.log(res.data);
        /*sqlQ = "update [BC_SyncSales_2024] set ";
        sqlQ = sqlQ + "BC_IdSale='" + res.data.value[0].id + "', ";
        sqlQ = sqlQ + "BC_Number='" + res.data.value[0].number + "', ";
        sqlQ = sqlQ + "BC_PostingDate='" + res.data.value[0].postingDate + "', ";
        sqlQ = sqlQ + "BC_CustomerId= '" + res.data.value[0].customerId + "', ";
        sqlQ = sqlQ + "BC_totalAmountIncludingTax= '" + res.data.value[0].totalAmountIncludingTax + "' ";
        sqlQ = sqlQ + "where id ='" + idSaleHit + "'";
        let updBC = await this.sql.runSql(
          sqlQ,
          'fac_hitrs',
        );*/
      }
    }
    return true;
  }

  async synchronizeSalesFacturasLines(tabFacturacioDATA, Hit_IdFactura, BC_facturaId) {
    let token = await this.token.getToken();
//console.log("HIT_IdFactura: " + Hit_IdFactura + "-----------------------------");
//console.log("BC_facturaId: " + BC_facturaId + "-----------------------------");
    let sqlQ;
    sqlQ = "select sum(f.Servit) Quantitat, sum(f.preu + f.preu*(iva/100))/sum(f.servit) UnitPrice, CAST(f.Producte as varchar) Plu ";
    sqlQ = sqlQ + "From " + tabFacturacioDATA + " f ";
    sqlQ = sqlQ + "where f.idFactura='" + Hit_IdFactura + "' and f.import>0 ";
    sqlQ = sqlQ + "group by producte";
    let facturasLines = await this.sql.runSql(
      sqlQ,
      'fac_hitrs',
    );

    for (let i = 0; i < facturasLines.recordset.length; i++) {
      let x = facturasLines.recordset[i];
      console.log("-------------------------PPRODUCTO " + x.Plu);
      const itemId = await this.getItemFromAPI(x.Plu);

      //BUSCAMOS LA LINEA DE FACTURA
      let res = await axios
        .get(
          `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${process.env.companyID})/salesInvoices(${BC_facturaId})/salesInvoiceLines?$filter=lineObjectNumber eq 'CODI-${x.Plu}'`,
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

      //NO ESTÁ, LA AÑADIMOS
      if (res.data.value.length === 0) {
        let newFacturas = await axios
          .post(
            `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${process.env.companyID})/salesInvoices(${BC_facturaId})/salesInvoiceLines`,
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
            throw new Error('Failed to post Factura line');
          });

      } else {
        //YA HAY UNA LINEA CON EL MISMO PRODUCTO, LA MODIFICAMOS
        console.log('Ya existe la Sale Line. Vamos a actualizarla');
        let z = res.data.value[0]['@odata.etag'];

        let newItems = await axios
          .patch(
            `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${process.env.companyID})/salesInvoices(${BC_facturaId})/salesInvoiceLines(${res.data.value[0].id})`,
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


  async getPDFSale(nFactura) {
    let token = await this.token.getToken();
    let sqlQ;
    //https://api.businesscentral.dynamics.com/v2.0/ace8eb1f-b96c-4ab5-91ae-4a66ffd58c96/production/api/v2.0/companies(c1fbfea4-f0aa-ee11-a568-000d3a660c9b)/salesInvoices(6e5217bc-cdb9-ee11-9078-000d3ab957cd)/pdfDocument/pdfDocumentContent
    let res = await axios
      .get(
        `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${process.env.companyID})/salesInvoices?$filter=number eq '102023'`,
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
        `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${process.env.companyID})/salesInvoices(${ticketId})/pdfDocument`,
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