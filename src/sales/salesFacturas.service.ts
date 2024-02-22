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

  async getCustomerFromAPI(companyID, codiHIT) {
    let customerId = '';

    // Get the authentication token
    let token = await this.token.getToken();

    // Get Customer from API
    let res = await axios
      .get(
        `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${companyID})/customers?$filter=number eq '${codiHIT}'`,
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

async getItemFromAPI(companyID, database, codiHIT) {
    let itemId = '';

    // Get the authentication token
    let token = await this.token.getToken();
    let items;
    let sqlQ1= 'SELECT a.Codi, a.Nom, a.Preu/(1+(t.Iva/100)) PreuSinIva, a.Preu, left(a.Familia, 20) Familia, a.EsSumable, t.Iva FROM (select codi, nom, preu, familia, esSumable, tipoIva from Articles union all select codi, nom, preu, familia, esSumable, tipoIva from articles_Zombis) a left join tipusIva2012 t on a.Tipoiva=t.Tipus where a.codi='+ codiHIT +' order by a.codi';
    console.log(sqlQ1)
    try {
      items = await this.sql.runSql(
        sqlQ1,
        database,
      );
    } catch (error){
      console.log(error)
    }
    let baseUnitOfMeasure = "UDS";
      //Unidad de medida (obligatorio)
      if (items.recordset[0].EsSumable === 0){
         baseUnitOfMeasure = "KG"; //A peso
      }
      else{
         baseUnitOfMeasure = "UDS"; //Por unidades
      }
    let url =  `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${companyID})/items?$filter=number eq 'CODI-${codiHIT}'`;
    //console.log(url);
    // Get Item from API
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
        throw new Error('Failed to obtain item');
      });
       
    if (!res.data) throw new Error('Failed to obtain item');
    //console.log(res.data.value[0])
    if (res.data.value.length === 0) {
      let newItems = await axios
          .post(
            `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${companyID})/items`,
            {
              number: 'CODI-' + codiHIT,
              displayName: items.recordset[0].Nom,                        
              generalProductPostingGroupCode: 'IVA'+items.recordset[0].Iva,
              unitPrice: items.recordset[0].Preu,
              //priceIncludesTax: true,
              //itemCategoryId: categoryId,
              baseUnitOfMeasureCode: baseUnitOfMeasure,
              //inventoryPostingGroupCode: '001',
            },
            {
              headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json',
              },
            },
          )
          .catch((error) => {
            throw new Error('Failed post item ' + items.recordset[0].Nom);
          });
    } else {
        itemId = res.data.value[0].id;
    }
    //console.log('itemId:', itemId)
    return itemId;
  }

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
    let customerId = await this.getCustomerFromAPI(companyID, x.ClientCodi);
    let idSaleHit = x.Id;
    console.log("---------------------------------------" + num + "-----------------------------------------");
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
          //console.log("------------------------------------------------------" + x.Serie + x.NumFactura + "-------------------------------");
          let resSale = await this.getSaleFromAPI(companyID, num);
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
              database,
            );
          }
        }
      } else {
        //YA ESTÁ LA FACTURA EN BC
        console.log('Ya existe la factura');
        facturaId_BC = res.data.value[0]['id'];
        await this.synchronizeSalesFacturasLines(companyID, database, tabFacturacioDATA, x.IdFactura, facturaId_BC).catch(console.error);
        /*
        console.log(res.data);
        facturaId_BC = res.data.value[0]['id'];
        await this.synchronizeSalesFacturasLines(tabFacturacioDATA, x.IdFactura, facturaId_BC ).catch(console.error);

        console.log(res.data);
        sqlQ = "update [BC_SyncSales_2024] set ";
        sqlQ = sqlQ + "BC_IdSale='" + res.data.value[0].id + "', ";
        sqlQ = sqlQ + "BC_Number='" + res.data.value[0].number + "', ";
        sqlQ = sqlQ + "BC_PostingDate='" + res.data.value[0].postingDate + "', ";
        sqlQ = sqlQ + "BC_CustomerId= '" + res.data.value[0].customerId + "', ";
        sqlQ = sqlQ + "BC_totalAmountIncludingTax= '" + res.data.value[0].totalAmountIncludingTax + "' ";
        sqlQ = sqlQ + "where id ='" + idSaleHit + "'";
        let updBC = await this.sql.runSql(
          sqlQ,
          'fac_hitrs',
        );
        */
      }
    return true;
  }

  async synchronizeSalesFacturasLines(companyID, database, tabFacturacioDATA, Hit_IdFactura, BC_facturaId) {
    let token = await this.token.getToken();
//console.log("HIT_IdFactura: " + Hit_IdFactura + "-----------------------------");
//console.log("BC_facturaId: " + BC_facturaId + "-----------------------------");
    console.log('-----------', tabFacturacioDATA, '__________________')
    console.log('-----------', Hit_IdFactura, '--------------')
    console.log('-----------', BC_facturaId, '--------------')
    let sqlQ;
    sqlQ = "select sum(f.Servit) Quantitat, sum(f.preu + f.preu*(iva/100))/sum(f.servit) UnitPrice, CAST(f.Producte as varchar) Plu ";
    sqlQ = sqlQ + "From " + tabFacturacioDATA + " f ";
    sqlQ = sqlQ + "where f.idFactura='" + Hit_IdFactura + "' and f.import>0 ";
    sqlQ = sqlQ + "group by producte";
    let facturasLines = await this.sql.runSql(
      sqlQ,
      database,
    );
    console.log(sqlQ);
    for (let i = 0; i < facturasLines.recordset.length; i++) {
      let x = facturasLines.recordset[i];
      console.log("-------------------------PPRODUCTO " + x.Plu);
      let itemId = await this.getItemFromAPI(companyID, database, x.Plu);
      
      let url2 = `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${companyID})/salesInvoices(${BC_facturaId})/salesInvoiceLines?$filter=lineObjectNumber eq 'CODI-${x.Plu}'`;
     //console.log('-------', url2);
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
      //console.log(url);
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