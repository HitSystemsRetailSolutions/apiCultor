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

  async syncSalesTickets() {
    let token = await this.token.getToken();
    let tabVenut = "[V_VENUT_2024-01]";
    let tabMoviments = "[V_MOVIMENTS_2024-01]";
    let botiga = "115"; // FILAPEÑA: T--101(115) T--076(764) T--152(864)

    let sqlQ;
    sqlQ = "select top 10 num_tick nTickHit, convert(varchar, v.Data, 23) Data, concat(upper(c.nom), '_', num_tick) Num_tick, case isnull(m.motiu, 'CAJA') when 'CAJA' then 'CAJA' else 'TARJETA' end FormaPago, isnull(c2.codi, '1314') Client, sum(v.import) Total ";
    sqlQ = sqlQ + "From " + tabVenut + " v  ";
    sqlQ = sqlQ + "left join " + tabMoviments + " m on m.botiga=v.botiga and concat('Pagat Targeta: ', v.num_tick) = m.motiu ";
    sqlQ = sqlQ + "left join clients c on v.botiga=c.codi  ";
    sqlQ = sqlQ + "left join ClientsFinals cf on concat('[Id:', cf.id, ']') = v.otros ";
    sqlQ = sqlQ + "left join clients c2 on case charindex('AbonarEn:',altres) when 0 then '' else substring(cf.altres, charindex('AbonarEn:', cf.altres)+9, charindex(']', cf.altres, charindex('AbonarEn:', cf.altres)+9)-charindex('AbonarEn:', cf.altres)-9) end =c2.codi ";
    sqlQ = sqlQ + "where v.botiga=" + botiga + " "; //" and num_tick > 265458 ";
    sqlQ = sqlQ + "group by v.data, num_tick, concat(upper(c.nom), '_', num_tick), case isnull(m.motiu, 'CAJA') when 'CAJA' then 'CAJA' else 'TARJETA' end, isnull(c2.codi, '1314') ";
    sqlQ = sqlQ + "order by v.data";

    //console.log (sqlQ);

    let tickets = await this.sql.runSql(
      sqlQ,
      process.env.database,
    );

    for (let i = 0; i < tickets.recordset.length; i++) {
      let x = tickets.recordset[i];
      let customerId = await this.getCustomerFromAPI(x.Client);
      //console.log("-------------------------" + customerId + "----------------------------");
      console.log(x.Num_tick);
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
          await this.synchronizeSalesTiquetsLines(tabVenut, botiga, x.nTickHit, ticketId).catch(console.error);
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
      process.env.database,
    );

    for (let i = 0; i < ticketsLines.recordset.length; i++) {
      let x = ticketsLines.recordset[i];
      console.log("---" + x.Plu);
      const itemId = await this.getItemFromAPI(x.Plu);
      //console.log(itemId);
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
}