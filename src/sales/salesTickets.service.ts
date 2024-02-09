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

// Get Customer from API
async getCustomerFromAPI(codiHIT) {
  let customerId = '';

  // Get the authentication token
  let token = await this.token.getToken();

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

// Get Item from API
async getItemFromAPI(codiHIT) {
  let itemId = '';

  // Get the authentication token
  let token = await this.token.getToken();

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

//=========================================== DIMENSIONES ======================================================  
// Get Dimension Id from API
async getDimensionFromAPI(code) {
  let dimId = '';

  // Get the authentication token
  let token = await this.token.getToken();

  let res = await axios
    .get(
      `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${process.env.companyID})/dimensions?$filter=code eq '${code}'`,
      {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      },
    )
    .catch((error) => {
      throw new Error('Failed to obtain dimension');
    });

  if (!res.data) throw new Error('Failed to obtain dimension');

  if (res.data.value.length === 0) {
  } else {
    dimId = res.data.value[0].id;
  }
  return dimId;
}


// Get Dimension value Id from API
async getDimensionValueIdFromAPI(dimId, valueCode) {
  let dimValueId = '';

  // Get the authentication token
  let token = await this.token.getToken();

  let res = await axios
    .get(
      `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${process.env.companyID})/dimensions(${dimId})/dimensionValues?$filter=valueCode eq '${valueCode}'`,
      {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      },
    )
    .catch((error) => {
      throw new Error('Failed to obtain value dimension');
    });

  if (!res.data) throw new Error('Failed to obtain value dimension');

  if (res.data.value.length === 0) {
  } else {
    dimValueId = res.data.value[0].valueId;
  }
  return dimValueId;
}
//=========================================== ~DIMENSIONES ======================================================

//=========================================== SALES ======================================================
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
    throw new Error('Failed to obtain ticket C');
  });

  if (!res.data) throw new Error('Failed to obtain ticket D');

  return res;
}

async getSaleLineFromAPI(idSale, lineObjectNumber) {
  // Get the authentication token
  let token = await this.token.getToken();

  let res = await axios
  .get(
    `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${process.env.companyID})/salesInvoices(${idSale})/salesInvoiceLines?$filter=lineObjectNumber eq '${lineObjectNumber}'`,
    {
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
    },
  )
  .catch((error) => {
    throw new Error('Failed to obtain ticket C');
  });

  if (!res.data) throw new Error('Failed to obtain ticket D');

  return res;
}
//=========================================== ~SALES ======================================================


  //Sincroniza tickets HIT-BC
  async syncSalesTickets() {
    let token = await this.token.getToken();
    let sqlQ;

    // FILAPEÑA: T--101(115) T--076(764) T--152(864)
    sqlQ = "select Id, HIT_Num_tick nTickHit, convert(varchar, HIT_Data, 23) Data, HIT_Botiga Botiga, upper(HIT_BotigaNom) BotigaNom, concat(upper(HIT_BotigaNom), '_', HIT_Num_tick) Num_tick, ";
    sqlQ = sqlQ + "case isnull(HIT_Otros, 'CAJA') when '' then 'CAJA' else 'TARJETA' end FormaPago, HIT_Cliente Client, HIT_Total Total ";
    sqlQ = sqlQ + "from [BC_SyncSalesTickets] ";
    sqlQ = sqlQ + "where SAGE_Asiento is not null and BC_IdSale is null and HIT_Total>0 and HIT_Botiga in (115, 764, 864) ";
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
          throw new Error('Failed to obtain ticket A');
        });

      if (!res.data) throw new Error('Failed to obtain ticket B');
      if (res.data.value.length === 0) { //SI NO EXISTE EL TICKET EN BC LO CREAMOS
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
            throw new Error('Failed post ticket A');
          });

        if (!newTickets.data)
          return new Error('Failed post ticket B');
        else{
          //AÑADIMOS LAS LINEAS DEL TICKET
          let ticketBC = await this.getSaleFromAPI(x.Num_tick);
          await this.synchronizeSalesTiquetsLines(tabVenut, x.Botiga, x.nTickHit, ticketBC.data.value[0].id).catch(console.error);

          sqlQ = "update [BC_SyncSalesTickets] set ";
          sqlQ = sqlQ + "BC_IdSale='" + ticketBC.data.value[0].id + "', ";
          sqlQ = sqlQ + "BC_Number='" + ticketBC.data.value[0].number + "', ";
          sqlQ = sqlQ + "BC_PostingDate='" + ticketBC.data.value[0].postingDate + "', ";
          sqlQ = sqlQ + "BC_CustomerId= '" + ticketBC.data.value[0].customerId + "', ";
          sqlQ = sqlQ + "BC_totalAmountIncludingTax= '" + ticketBC.data.value[0].totalAmountIncludingTax + "' ";
          sqlQ = sqlQ + "where id ='" + idSaleHit + "'";
          let updBC = await this.sql.runSql(
              sqlQ,
              'fac_tena',
            );
        }

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

//AÑADIMOS LAS LINEAS AL TICKET
async synchronizeSalesTiquetsLines(tabVenut, botiga, nTickHit, ticketId) {
  let token = await this.token.getToken();

  let sqlQ;
  sqlQ = "select upper(c.nom) BotigaNom, concat(upper(c.nom), '_', num_tick) Num_tick, sum(v.Quantitat) Quantitat, sum(v.import)/sum(v.Quantitat) UnitPrice, CAST(v.Plu as varchar) Plu ";
  sqlQ = sqlQ + "From " + tabVenut + " v ";
  sqlQ = sqlQ + "left join clients c on v.botiga=c.codi  ";
  sqlQ = sqlQ + "where v.botiga=" + botiga + " and num_tick='" + nTickHit + "'";
  sqlQ = sqlQ + "group by concat(upper(c.nom), '_', num_tick), CAST(v.Plu as varchar), c.nom ";
  let ticketsLines = await this.sql.runSql(
    sqlQ,
    'fac_tena',
  );

  for (let i = 0; i < ticketsLines.recordset.length; i++) {
    let x = ticketsLines.recordset[i];
    let botigaNom = x.BotigaNom;

    console.log("-------------------------PLU " + x.Plu + "---------------------");

    const itemId = await this.getItemFromAPI(x.Plu);

    let res = await this.getSaleLineFromAPI(ticketId, "CODI-" + x.Plu);
    //NO ESTÁ LA LINEA, LA AÑADIMOS
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

        //DIMENSION
        let idDim = await this.getDimensionFromAPI("BOTIGUES");
        //console.log("--------------------- idDim: " + idDim + "------------------------------");
        //console.log("--------------------- botigaNom: " + botigaNom + "------------------------------");
        //let idDimValue = await this.getDimensionValueIdFromAPI(idDim, botigaNom);
        //let idDimValue = 'dd06c06f-48bf-ee11-9078-000d3a65ae37';
        //console.log("--------------------- idDimValue: " + idDimValue + "------------------------------");

        let resSaleLine = await this.getSaleLineFromAPI(ticketId, "CODI-" + x.Plu);
        let sLineId = resSaleLine.data.value[0].id;

        //console.log("--------------------------ticketId: " + ticketId + "-----------------------------");
        //console.log("--------------------------sLineId: " + sLineId + "-----------------------------");

        let setDim = await axios
          .post(
            `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${process.env.companyID})/salesInvoices(${ticketId})/salesInvoiceLines(${sLineId})/dimensionSetLines`,
            {
              id: idDim,
              parentId: sLineId,
              //valueId: idDimValue,
              valueCode: botigaNom,
            },
            {
              headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json',
              },
            },
          )
          .catch((error) => {
          throw new Error('Failed to post dimension');
          });
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
    `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${process.env.companyID})/salesInvoices?$filter=number eq '120308'`,
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
  console.log(res.data.value[0]);

  console.log("---------------------- LINEAS -----------------------------------")

  let res2 = await axios
  .get(
    `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${process.env.companyID})/salesInvoices(${ticketId})/salesInvoiceLines`,
    {
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
    },
  )
  .catch((error) => {
    throw new Error('Failed to obtain ticket lines');
  });

  for (let i = 0; i < res2.data.value.length; i++) {
    let lineId = res2.data.value[i].id;
    console.log(res2.data.value[i].id);

    let res3 = await axios
    .get(
      `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${process.env.companyID})/salesInvoices(${ticketId})/salesInvoiceLines(${lineId})/dimensionSetLines`,
      {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      },
    )
    .catch((error) => {
      throw new Error('Failed to obtain ticket lines');
    });
    for (let j = 0; j < res3.data.value.length; j++) {
      console.log(res3.data.value[j]);
    }

  }


/*     let res2 = await axios
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
      });*/
    return true;
  }

  async cleanSalesTickets() {
    let token = await this.token.getToken();
    let sqlQ;

    let res = await axios
      .get(
        `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${process.env.companyID})/salesInvoices?$filter=totalAmountIncludingTax eq 0`,
        {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        },
      )
      .catch((error) => {
        throw new Error('Failed to obtain ticket A');
      });

      if (!res.data) throw new Error('Failed to obtain ticket B');
      if (res.data.value.length > 0) {
        for (let i = 0; i < res.data.value.length; i++) {
          if (res.data.value[i].totalAmountIncludingTax===0)
            {
              console.log("---------------------------------------" + res.data.value[i].number + "-----------------------------------------");              
              let z = res.data.value[i]['@odata.etag'];
              let delSale = await axios
              .delete(
                `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${process.env.companyID})/salesInvoices(${res.data.value[i].id})`,
                {
                  headers: {
                    Authorization: 'Bearer ' + token,
                    'Content-Type': 'application/json',
                    'if-Match': z,
                  },
                },
              )
              .catch((error) => {
                throw new Error('Failed to delete sale');
              });
    
            }
          }
        }
      else{
        console.log("NO HAY SALES " + res.data.value.length);
      }

    return true;
  }


}