import { Injectable } from '@nestjs/common';
import { getTokenService } from '../conection/getToken.service';
import { runSqlService } from 'src/conection/sqlConection.service';
import axios from 'axios';
import { response } from 'express';
@Injectable()

export class salesTicketsService {
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

  async syncSalesTickets() {
    let token = await this.token.getToken();
    let sqlQ;

    // FILAPEÑA: T--101(115) T--076(764) T--152(864)
    sqlQ = "select Id, HIT_Num_tick nTickHit, convert(varchar, HIT_Data, 23) Data, HIT_Botiga Botiga, concat(upper(HIT_BotigaNom), '_', HIT_Num_tick) Num_tick, ";
    sqlQ = sqlQ + "case isnull(HIT_Otros, 'CAJA') when '' then 'CAJA' else 'TARJETA' end FormaPago, HIT_Cliente Client, HIT_Total Total ";
    sqlQ = sqlQ + "from [BC_SyncSalesTickets] ";
    sqlQ = sqlQ + "where SAGE_Asiento is not null and BC_IdSale is null and HIT_Botiga in (115, 764, 864) ";
    sqlQ = sqlQ + "order by  Botiga, HIT_Data";
        
    let tickets = await this.sql.runSql(
      sqlQ,
      'fac_tena',
    );

    for (let i = 0; i < tickets.recordset.length; i++) {
      let x = tickets.recordset[i];
      let customerId = await this.getCustomerFromAPI(x.Client);
      let tabVenut = "[V_VENUT_"  + x.Data.split('-')[0] + "-" + x.Data.split('-')[1] + "]";
      let idSaleHit = x.Id;

      console.log("---------------------------------------" + x.Num_tick + "-----------------------------------------");
      let res = await axios
        .get(
          `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${process.env.companyID})/salesInvoices?$filter=externalDocumentNumber eq '${x.Num_tick}'`,
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
      if (res.data.value.length === 0) {
        let newTickets = await axios
          .post(
            `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${process.env.companyID})/salesInvoices`,
            {
                externalDocumentNumber: x.Num_tick,
                invoiceDate: x.Data,
                postingDate: x.Data,
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

        if (!newTickets.data)
          return new Error('Failed post');
        else{
          let ticketId = newTickets.data.id;
          await this.synchronizeSalesTiquetsLines(tabVenut, x.Botiga, x.nTickHit, ticketId).catch(console.error);
//console.log("------------------------------------------------------" + x.Num_tick + "-------------------------------");
          let resSale = await this.getSaleFromAPI(x.Num_tick);
          if (!resSale.data) throw new Error('Failed to obtain ticket BS');
          if (resSale.data.value.length != 0) {          
            //console.log(resSale);
            sqlQ = "update [BC_SyncSalesTickets] set ";
            sqlQ = sqlQ + "BC_IdSale='" + resSale.data.value[0].id + "', ";
            sqlQ = sqlQ + "BC_Number='" + resSale.data.value[0].number + "', ";
            sqlQ = sqlQ + "BC_PostingDate='" + resSale.data.value[0].postingDate + "', ";
            sqlQ = sqlQ + "BC_CustomerId= '" + resSale.data.value[0].customerId + "', ";
            sqlQ = sqlQ + "BC_totalAmountIncludingTax= '" + resSale.data.value[0].totalAmountIncludingTax + "' ";
            sqlQ = sqlQ + "where id ='" + idSaleHit + "'";
            let updBC = await this.sql.runSql(
                sqlQ,
                'fac_tena',
              );
          }
        }

//        console.log(
//          'Synchronizing tickets... -> ' +
//            i +
//            '/' +
//            tickets.recordset.length,
//          ' --- ',
//          ((i / tickets.recordset.length) * 100).toFixed(2) + '%',
//          ' | Time left: ' +
//            ((tickets.recordset.length - i) * (0.5 / 60)).toFixed(2) +
//            ' minutes',
//        );

      } else {
        console.log('Ya existe el ticket');
        //console.log(res.data);
        sqlQ = "update [BC_SyncSalesTickets] set ";
        sqlQ = sqlQ + "BC_IdSale='" + res.data.value[0].id + "', ";
        sqlQ = sqlQ + "BC_Number='" + res.data.value[0].number + "', ";
        sqlQ = sqlQ + "BC_PostingDate='" + res.data.value[0].postingDate + "', ";
        sqlQ = sqlQ + "BC_CustomerId= '" + res.data.value[0].customerId + "', ";
        sqlQ = sqlQ + "BC_totalAmountIncludingTax= '" + res.data.value[0].totalAmountIncludingTax + "' ";
        sqlQ = sqlQ + "where id ='" + idSaleHit + "'";
        let updBC = await this.sql.runSql(
          sqlQ,
          'fac_tena',
        );
      }
    }
    return true;
  }

  async synchronizeSalesTiquetsLines(tabVenut, botiga, nTickHit, ticketId) {
    let token = await this.token.getToken();

    let sqlQ;
    sqlQ = "select concat(upper(c.nom), '_', num_tick) Num_tick, sum(v.Quantitat) Quantitat, sum(v.import)/sum(v.Quantitat) UnitPrice, CAST(v.Plu as varchar) Plu ";
    sqlQ = sqlQ + "From " + tabVenut + " v ";
    sqlQ = sqlQ + "left join clients c on v.botiga=c.codi  ";
    sqlQ = sqlQ + "where v.botiga=" + botiga + " and num_tick='" + nTickHit + "'";
    sqlQ = sqlQ + "group by concat(upper(c.nom), '_', num_tick), CAST(v.Plu as varchar) ";
    let ticketsLines = await this.sql.runSql(
      sqlQ,
      'fac_tena',
    );

    for (let i = 0; i < ticketsLines.recordset.length; i++) {
      let x = ticketsLines.recordset[i];
      console.log("-------------------------PLU " + x.Plu);
      const itemId = await this.getItemFromAPI(x.Plu);

      let res = await axios
        .get(
          `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${process.env.companyID})/salesInvoices(${ticketId})/salesInvoiceLines?$filter=lineObjectNumber eq 'CODI-${x.Plu}'`,
          {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          },
        )
        .catch((error) => {
          throw new Error('Failed to get ticket line');
        });

      if (!res.data) throw new Error('Failed to get ticket line');

      if (res.data.value.length === 0) {
        let newTickets = await axios
          .post(
            `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${process.env.companyID})/salesInvoices(${ticketId})/salesInvoiceLines`,
            {
                documentId: ticketId,
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
            throw new Error('Failed to post Ticket line');
          });

//        console.log(
//          'Synchronizing ticket lines... -> ' +
//            i +
//            '/' +
//            ticketsLines.recordset.length,
//          ' --- ',
//          ((i / ticketsLines.recordset.length) * 100).toFixed(2) + '%',
//          ' | Time left: ' +
//            ((ticketsLines.recordset.length - i) * (0.5 / 60)).toFixed(2) +
//            ' minutes',
//        );



      } else {
        console.log('Ya existe el ticket');
      }
    }
    return true;    
  }


  async syncSalesTicketsxxx() {
    let token = await this.token.getToken();
    let sqlQ;

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