import { Injectable } from '@nestjs/common';
import { getTokenService } from '../conection/getToken.service';
import { runSqlService } from 'src/conection/sqlConection.service';
import axios from 'axios';
import { response } from 'express';
import { timeStamp } from 'console';

const mqtt = require('mqtt');
const mqttBrokerUrl = 'mqtt://santaana2.nubehit.com';

// Crear un cliente MQTT
const client = mqtt.connect(mqttBrokerUrl);

@Injectable()

export class salesTicketsService {
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) {}

  // Get Customer from API
  async getCustomerFromAPI(codiHIT, companyID) {
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
  
  // Get Item from API
  async getItemFromAPI(codiHIT, companyID) {
    let itemId = '';
    // Get the authentication token
    let token = await this.token.getToken();
    // Get Item from API
    let res = await axios
      .get(
        `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${companyID})/items?$filter=number eq 'CODI-${codiHIT}'`,
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
async getDimensionFromAPI(code, companyID) {
  let dimId = '';
  // Get the authentication token
  let token = await this.token.getToken();
  let res = await axios
    .get(
      `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${companyID})/dimensions?$filter=code eq '${code}'`,
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
async getDimensionValueIdFromAPI(dimId, valueCode, companyID) {
  let dimValueId = '';

  // Get the authentication token
  let token = await this.token.getToken();

  let res = await axios
    .get(
      `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${companyID})/dimensions(${dimId})/dimensionValues?$filter=valueCode eq '${valueCode}'`,
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
async getSaleFromAPI(docNumber, companyID) {
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
    throw new Error('Failed to obtain ticket C');
  });

  if (!res.data) throw new Error('Failed to obtain ticket D');
  return res;
}

async getSaleLineFromAPI(idSale, lineObjectNumber, companyID) {
  // Get the authentication token
  let token = await this.token.getToken();

  let res = await axios
  .get(
    `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${companyID})/salesInvoices(${idSale})/salesInvoiceLines?$filter=lineObjectNumber eq '${lineObjectNumber}'`,
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
  async syncSalesTickets(companyID, database, botiga) {
    let token = await this.token.getToken();

    //Falta declarar estas variables para utilizarla mas abajo
    let tabVenut;
    let tabMoviments;
    
    let fIni;

    let fFin = new Date();
    let monthFin = fFin.getMonth();
    let yearFin = fFin.getFullYear();

    let record;
    try {
      record = await this.sql.runSql(
        "select * from records where concepte='BC_SalesTickets_" + botiga + "'",
        database,
      );
    } catch (error){ //Comprovacion de errores y envios a mqtt
      client.publish('/Hit/Serveis/Apicultor/Log', 'No existe la database');
      console.log('No existe la database')
      return false;
    }
    if(record.recordset.length == 0){
       fIni = new Date(yearFin, 0, 1);
    }
    else
    {
      fIni = record.recordset[0].timestamp;
    }

    if (fIni.getMonth()==fFin.getMonth() && fIni.getFullYear()==fFin.getFullYear())
    {
      let mesTab = fIni.getMonth();
      let mes= (mesTab+1).toString().padStart(2,"0");

      tabVenut = "[V_VENUT_" + fIni.getFullYear() + "-" + mes + "]";
      tabMoviments = "[V_MOVIMENTS_" + fIni.getFullYear() + "-" + mes + "]";
    }
    else
    {
      if (fIni.getFullYear()==fFin.getFullYear())
      {
        tabVenut = "";
        tabMoviments = "";
        let mesFin =  monthFin+1;
        for(let m=1;m<=mesFin;m++)
        {
          let mes= m.toString().padStart(2,"0");
          if (tabVenut != "")
          {
            tabVenut = tabVenut + " union all ";  
          }
          tabVenut = tabVenut + "select * from [V_VENUT_" + fIni.getFullYear() + "-" + mes + "]";
          if (tabMoviments != "")
          {
            tabMoviments = tabMoviments + " union all "  
          }
          tabMoviments = tabMoviments + "select * from [V_MOVIMENTS_" + fIni.getFullYear() + "-" + mes + "]";
        }
        tabVenut = "(" + tabVenut + ")";
        tabMoviments = "(" + tabMoviments + ")";
      }
    }

    let sqlQ;
    sqlQ = "select num_tick nTickHit, convert(varchar, v.Data, 23) Data, concat(upper(c.nom), '_', num_tick) Num_tick, case isnull(m.motiu, 'CAJA') when 'CAJA' then 'CAJA' else 'TARJETA' end FormaPago, isnull(c2.codi, '1314') Client, sum(v.import) Total ";
    sqlQ = sqlQ + "From " + tabVenut + " v  ";
    sqlQ = sqlQ + "left join " + tabMoviments + " m on m.botiga=v.botiga and concat('Pagat Targeta: ', v.num_tick) = m.motiu ";
    sqlQ = sqlQ + "left join clients c on v.botiga=c.codi  ";
    sqlQ = sqlQ + "left join ClientsFinals cf on concat('[Id:', cf.id, ']') = v.otros ";
    sqlQ = sqlQ + "left join clients c2 on case charindex('AbonarEn:',altres) when 0 then '' else substring(cf.altres, charindex('AbonarEn:', cf.altres)+9, charindex(']', cf.altres, charindex('AbonarEn:', cf.altres)+9)-charindex('AbonarEn:', cf.altres)-9) end =c2.codi ";
    sqlQ = sqlQ + "where v.botiga = " + botiga + " and v.data>=(select timestamp from records where concepte='BC_SalesTickets_" + botiga + "') ";
    sqlQ = sqlQ + "group by v.data, num_tick, concat(upper(c.nom), '_', num_tick), case isnull(m.motiu, 'CAJA') when 'CAJA' then 'CAJA' else 'TARJETA' end, isnull(c2.codi, '1314') ";
    sqlQ = sqlQ + "order by v.data";
    
    let tickets;
    try {
      tickets = await this.sql.runSql(
        sqlQ,
        database,
      );
    } catch (error){ //Comprovacion de errores y envios a mqtt
      client.publish('/Hit/Serveis/Apicultor/Log', 'No existe la database');
      console.log(sqlQ)
      return false;
    }
    
    if(tickets.recordset.length == 0){ //Comprovacion de errores y envios a mqtt
      client.publish('/Hit/Serveis/Apicultor/Log', 'No hay registros');
      console.log('No hay registros')
      return false;
    }

    for (let i = 0; i < tickets.recordset.length; i++) {
      let x = tickets.recordset[i];
      let customerId = await this.getCustomerFromAPI(x.Client, companyID);
      
      //Falta declarar esta variable para utilizarla mas abajo
      let idSaleHit = x.Id;
      //

      //console.log("-------------------------" + customerId + "----------------------------");
      console.log(x.Num_tick);
      let res = await axios
        .get(
          `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${companyID})/salesInvoices?$filter=externalDocumentNumber eq '${x.Num_tick}'`,
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
            `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${companyID})/salesInvoices`,
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
          let ticketBC = await this.getSaleFromAPI(x.Num_tick, companyID);
          await this.synchronizeSalesTiquetsLines(tabVenut, x.Botiga, x.nTickHit, ticketBC.data.value[0].id, database, companyID).catch(console.error);

          await this.sql.runSql(
            `delete from records where Concepte='BC_SalesTickets_` + botiga + `'`,
            database,
          );

          await this.sql.runSql(
            `insert into records (timestamp, concepte) values ('${x.tmstStr}', 'BC_SalesTickets_` + botiga + `')`,
            database,
          );
  
        }

      } else {        
        console.log('Ya existe el ticket');
      }
    }
    return true;
  }

//AÑADIMOS LAS LINEAS AL TICKET
async synchronizeSalesTiquetsLines(tabVenut, botiga, nTickHit, ticketId, database, companyID) {
  let token = await this.token.getToken();

  let sqlQ;
  sqlQ = "select upper(c.nom) BotigaNom, concat(upper(c.nom), '_', num_tick) Num_tick, sum(v.Quantitat) Quantitat, sum(v.import)/sum(v.Quantitat) UnitPrice, CAST(v.Plu as varchar) Plu ";
  sqlQ = sqlQ + "From " + tabVenut + " v ";
  sqlQ = sqlQ + "left join clients c on v.botiga=c.codi  ";
  sqlQ = sqlQ + "where v.botiga=" + botiga + " and num_tick='" + nTickHit + "'";
  sqlQ = sqlQ + "group by concat(upper(c.nom), '_', num_tick), CAST(v.Plu as varchar), c.nom ";
    
  let ticketsLines = await this.sql.runSql(
    sqlQ,
    database,
  );

  for (let i = 0; i < ticketsLines.recordset.length; i++) {
    let x = ticketsLines.recordset[i];
    console.log("-------------------------PLU " + x.Plu + "---------------------");    
    const itemId = await this.getItemFromAPI(x.Plu, companyID);
    let res = await axios
      .get(
        `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${companyID})/salesInvoices(${ticketId})/salesInvoiceLines?$filter=lineObjectNumber eq 'CODI-${x.Plu}'`,
        {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        },
      )
          
    res = await this.getSaleLineFromAPI(ticketId, "CODI-" + x.Plu, companyID);
    //NO ESTÁ LA LINEA, LA AÑADIMOS
    if (res.data.value.length === 0) {
      let newTickets = await axios
        .post(
          `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${companyID})/salesInvoices(${ticketId})/salesInvoiceLines`,
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
      let botigaNom = x.BotigaNom;      
      let idDim = await this.getDimensionFromAPI("BOTIGUES", companyID);
      //console.log("--------------------- idDim: " + idDim + "------------------------------");
      //console.log("--------------------- botigaNom: " + botigaNom + "------------------------------");
      //let idDimValue = await this.getDimensionValueIdFromAPI(idDim, botigaNom, companyID);
      //let idDimValue = 'dd06c06f-48bf-ee11-9078-000d3a65ae37';
      //console.log("--------------------- idDimValue: " + idDimValue + "------------------------------");

      let resSaleLine = await this.getSaleLineFromAPI(ticketId, "CODI-" + x.Plu, companyID);
      let sLineId = resSaleLine.data.value[0].id;

      //console.log("--------------------------ticketId: " + ticketId + "-----------------------------");
      //console.log("--------------------------sLineId: " + sLineId + "-----------------------------");

      let setDim = await axios
        .post(
          `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${companyID})/salesInvoices(${ticketId})/salesInvoiceLines(${sLineId})/dimensionSetLines`,
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