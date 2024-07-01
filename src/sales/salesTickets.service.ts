import { Injectable } from '@nestjs/common';
import { getTokenService } from '../conection/getToken.service';
import { runSqlService } from 'src/conection/sqlConection.service';
import { itemsService } from 'src/items/items.service';
import axios from 'axios';

const mqtt = require('mqtt');
const mqttOptions = {
  host: process.env.MQTT_HOST,
  username: process.env.MQTT_USER,
  password: process.env.MQTT_PASSWORD,
};

// Crear un cliente MQTT
const client = mqtt.connect(mqttOptions);

@Injectable()
export class salesTicketsService {
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
    private items: itemsService,
  ) { }

  // Get Customer from API
  async getCustomerFromAPI(codiHIT, companyID, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let customerId = '';
    // Get the authentication token
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    // Get Customer from API
    let res = await axios
      .get(
        `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/customers?$filter=number eq '${codiHIT}'`,
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
      let res2 = await axios
        .get(
          `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/customers?$filter=number eq 'A'`,
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
      customerId = res2.data.value[0].id;
    } else {
      customerId = res.data.value[0].id;
    }
    return customerId;
  }

  // Get Item from API
  async getItemFromAPI(codiHIT, companyID, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let itemId = '';
    // Get the authentication token
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    // Get Item from API
    let res = await axios
      .get(
        `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/items?$filter=number eq 'CODI-${codiHIT}'`,
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
  async getDimensionFromAPI(code, companyID, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let dimId = '';
    // Get the authentication token
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    let res = await axios
      .get(
        `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/dimensions?$filter=code eq '${code}'`,
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
      return null;
    } else {
      dimId = res.data.value[0].id;
    }
    return dimId;
  }

  // Get Dimension value Id from API
  async getDimensionValueIdFromAPI(dimId, valueCode, companyID, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let dimValueId = '';

    // Get the authentication token
    let token = await this.token.getToken2(client_id, client_secret, tenant);

    let res = await axios
      .get(
        `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/dimensions(${dimId})/dimensionValues?$filter=valueCode eq '${valueCode}'`,
        {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        },
      )
      .catch((error) => {
        console.log('Failed to obtain value dimension');
        return null;
      });

    if (!res.data) throw new Error('Failed to obtain value dimension');

    if (res.data.value.length === 0) {
      return null;
    } else {
      dimValueId = res.data.value[0].valueId;
    }
    return dimValueId;
  }
  //=========================================== ~DIMENSIONES ======================================================

  //=========================================== SALES ======================================================
  async getSaleFromAPI(docNumber, companyID, client_id: string, client_secret: string, tenant: string, entorno: string) {
    // Get the authentication token
    let token = await this.token.getToken2(client_id, client_secret, tenant);

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
        throw new Error('Failed to obtain ticket C');
      });

    if (!res.data) throw new Error('Failed to obtain ticket D');
    return res;
  }

  async getSaleLineFromAPI(idSale, lineObjectNumber, companyID, client_id: string, client_secret: string, tenant: string, entorno: string) {
    // Get the authentication token
    console.log(lineObjectNumber);
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    let res = await axios
      .get(
        `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices(${idSale})/salesInvoiceLines?$filter=lineObjectNumber eq '${lineObjectNumber}'`,
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
  async syncSalesTickets(companyID, database, botiga, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let token = await this.token.getToken2(client_id, client_secret, tenant);

    //Falta declarar estas variables para utilizarla mas abajo
    let tabVenut;
    let tabMoviments;

    let fIni;

    let fFin = new Date();
    let monthFin = fFin.getMonth();
    let yearFin = fFin.getFullYear();
    fIni = new Date(yearFin, 0, 1);
    console.log(new Date(yearFin, 0, 1));

    let record;
    try {
      record = await this.sql.runSql(
        "select * from records where concepte='BC_SalesTickets_" + botiga + "'",
        database,
      );
    } catch (error) {
      //Comprovacion de errores y envios a mqtt
      client.publish('/Hit/Serveis/Apicultor/Log', 'No existe la database');
      console.log('No existe la database');
      return false;
    }
    try {
      if (record.recordset.length == 0) {
        let fIniQuery = fIni.toISOString();
        console.log(`Fecha records: ${fIniQuery}`);
        await this.sql.runSql(
          `insert into records (timestamp, concepte) values ('${fIniQuery}', 'BC_SalesTickets_${botiga}')`,
          database,
        );
      } else {
        console.log('Fecha records: ', fIni);
        fIni = record.recordset[0].TimeStamp;
      }
    } catch (error) {
      console.log('Fecha: ', fIni);
    }

    //Revisar codigo
    if (fIni.getMonth() == fFin.getMonth() && fIni.getFullYear() == fFin.getFullYear()) {
      let mesTab = fIni.getMonth();
      let mes = (mesTab + 1).toString().padStart(2, '0');

      tabVenut = '[V_VENUT_' + fIni.getFullYear() + '-' + mes + ']';
      tabMoviments = '[V_MOVIMENTS_' + fIni.getFullYear() + '-' + mes + ']';
    } else {
      if (fIni.getFullYear() == fFin.getFullYear()) {
        tabVenut = '';
        tabMoviments = '';
        let mesFin = monthFin + 1;
        for (let m = 1; m <= mesFin; m++) {
          let mes = m.toString().padStart(2, '0');
          if (tabVenut != '') {
            tabVenut = tabVenut + ' union all ';
          }
          tabVenut += 'select * from [V_VENUT_' + fIni.getFullYear() + '-' + mes + ']';
          if (tabMoviments != '') {
            tabMoviments += ' union all ';
          }
          tabMoviments += 'select * from [V_MOVIMENTS_' + fIni.getFullYear() + '-' + mes + ']';
        }
        tabVenut = '(' + tabVenut + ')';
        tabMoviments = '(' + tabMoviments + ')';
      }
    }

    let sqlQ;
    sqlQ = "select num_tick nTickHit, convert(varchar, v.Data, 23) Data, v.Data as tmstStr, concat(upper(c.nom), '_', num_tick) Num_tick, case isnull(m.motiu, 'CAJA') when 'CAJA' then 'CAJA' else 'TARJETA' end FormaPago, isnull(c2.codi, '1314') Client, sum(v.import) Total From" + tabVenut + ' v ';
    sqlQ += 'left join ' + tabMoviments + " m on m.botiga=v.botiga and concat('Pagat Targeta: ', v.num_tick) = m.motiu ";
    sqlQ += 'left join clients c on v.botiga=c.codi  ';
    sqlQ += "left join ClientsFinals cf on concat('[Id:', cf.id, ']') = v.otros ";
    sqlQ += "left join clients c2 on case charindex('AbonarEn:',altres) when 0 then '' else substring(cf.altres, charindex('AbonarEn:', cf.altres)+9, charindex(']', cf.altres, charindex('AbonarEn:', cf.altres)+9)-charindex('AbonarEn:', cf.altres)-9) end =c2.codi ";
    sqlQ += 'where v.botiga = ' + botiga + " and v.data>=(select timestamp from records where concepte='BC_SalesTickets_" + botiga + "') ";
    sqlQ += "group by v.data, num_tick, concat(upper(c.nom), '_', num_tick), case isnull(m.motiu, 'CAJA') when 'CAJA' then 'CAJA' else 'TARJETA' end, isnull(c2.codi, '1314') order by v.data";
    console.log(`Sql: ${sqlQ}`);

    let tickets;
    try {
      tickets = await this.sql.runSql(sqlQ, database);
    } catch (error) {
      //Comprovacion de errores y envios a mqtt
      client.publish('/Hit/Serveis/Apicultor/Log', 'No existe la database');
      console.log(`Error: ${error}`);

      return false;
    }

    if (tickets.recordset.length == 0) {
      //Comprovacion de errores y envios a mqtt
      client.publish('/Hit/Serveis/Apicultor/Log', 'No hay registros');
      console.log('No hay registros');
      return false;
    }

    console.log("Total tickets: ", tickets.recordset.length)
    for (let i = 0; i < tickets.recordset.length; i++) {
      let x = tickets.recordset[i];
      let customerId = await this.getCustomerFromAPI(x.Client, companyID, client_id, client_secret, tenant, entorno);

      //Falta declarar esta variable para utilizarla mas abajo
      let idSaleHit = x.Id;
      //

      console.log("-------------------------" + customerId + "----------------------------");
      let url1 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices?$filter=externalDocumentNumber eq '${x.Num_tick}'`;
      let res = await axios
        .get(
          url1,
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
      if (res.data.value.length === 0) {
        //SI NO EXISTE EL TICKET EN BC LO CREAMOS
        let url2 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices`;
        let newTickets = await axios
          .post(
            url2,
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
            console.log(`Datos: ${x.Num_tick}, ${x.Data}, ${customerId}`)
            throw new Error('Failed post ticket A');
          });

        if (!newTickets.data) return new Error('Failed post ticket B');
        else {
          //AÑADIMOS LAS LINEAS DEL TICKET
          let ticketBC = await this.getSaleFromAPI(x.Num_tick, companyID, client_id, client_secret, tenant, entorno);
          console.log('Tickets BC: ', ticketBC.data.value[0].id);
          await this.synchronizeSalesTiquetsLines(
            tabVenut,
            botiga,
            x.nTickHit,
            ticketBC.data.value[0].id,
            database,
            companyID,
            client_id,
            client_secret,
            tenant,
            entorno
          ).catch(console.error);
          //console.log('Tmst: ', x.tmstStr);
          console.log(
            'Synchronizing tickets... -> ' + i + '/' + tickets.recordset.length,
            ' --- ',
            ((i / tickets.recordset.length) * 100).toFixed(2) + '%',
            ' | Time left: ' +
            ((tickets.recordset.length - i) * (0.5 / 60)).toFixed(2) +
            ' minutes',
          );

          let sqlUpdate = `update records set timestamp='${x.Data}' where concepte='BC_SalesTickets_` + botiga + `'`;
          await this.sql.runSql(
            sqlUpdate,
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
  async synchronizeSalesTiquetsLines(tabVenut, botiga, nTickHit, ticketId, database, companyID, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let token = await this.token.getToken2(client_id, client_secret, tenant);

    let sqlQ;
    sqlQ =
      "select upper(c.nom) BotigaNom, concat(upper(c.nom), '_', num_tick) Num_tick, sum(v.Quantitat) Quantitat, sum(v.import)/sum(v.Quantitat) UnitPrice, CAST(v.Plu as varchar) Plu ";
    sqlQ = sqlQ + 'From ' + tabVenut + ' v ';
    sqlQ = sqlQ + 'left join clients c on v.botiga=c.codi  ';
    sqlQ =
      sqlQ + 'where v.botiga=' + botiga + " and num_tick='" + nTickHit + "'";
    sqlQ =
      sqlQ +
      "group by concat(upper(c.nom), '_', num_tick), CAST(v.Plu as varchar), c.nom ";

    let ticketsLines = await this.sql.runSql(sqlQ, database);

    for (let i = 0; i < ticketsLines.recordset.length; i++) {
      let x = ticketsLines.recordset[i];
      console.log(x);
      console.log(
        '-------------------------PLU ' + x.Plu + '---------------------',
      );
      let itemId = await this.items.getItemFromAPI(companyID, database, x.Plu, client_id, client_secret, tenant, entorno);
      console.log(`ItemID: ${itemId}`)
      let res = await axios.get(
        `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices(${ticketId})/salesInvoiceLines?$filter=lineObjectNumber eq 'CODI-${x.Plu}'`,
        {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        },
      );

      res = await this.getSaleLineFromAPI(ticketId, 'CODI-' + x.Plu, companyID, client_id, client_secret, tenant, entorno);

      //NO ESTÁ LA LINEA, LA AÑADIMOS
      if (res.data.value.length === 0) {
        let newTickets = await axios
          .post(
            `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices(${ticketId})/salesInvoiceLines`,
            {
              documentId: ticketId,
              itemId: itemId,
              quantity: x.Quantitat,
              unitPrice: x.UnitPrice,
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
        let idDim = await this.getDimensionFromAPI('BOTIGUES', companyID, client_id, client_secret, tenant, entorno);
        //console.log("--------------------- idDim: " + idDim + "------------------------------");
        //console.log("--------------------- botigaNom: " + botigaNom + "------------------------------");
        if (idDim == null) {
          return true;
        }
        let idDimValue = await this.getDimensionValueIdFromAPI(idDim, botigaNom, companyID, client_id, client_secret, tenant, entorno);
        //let idDimValue = 'dd06c06f-48bf-ee11-9078-000d3a65ae37';
        //console.log("--------------------- idDimValue: " + idDimValue + "------------------------------");

        let resSaleLine = await this.getSaleLineFromAPI(ticketId, 'CODI-' + x.Plu, companyID, client_id, client_secret, tenant, entorno);
        //console.log("--------------------------resSaleLine: " + resSaleLine + "-----------------------------");
        let sLineId = resSaleLine.data.value[0].id;

        console.log('--------------------------companyID: ' + companyID + '-----------------------------',);
        console.log('--------------------------ticketId: ' + ticketId + '-----------------------------',);
        console.log('--------------------------sLineId: ' + sLineId + '-----------------------------',);
        console.log('--------------------------idDim: ' + idDim + '-----------------------------',);

        //Error aqui !!!
        if (idDimValue == null) {
          return true;
        }
        let setDim = await axios
          .post(
            `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices(${ticketId})/salesInvoiceLines(${sLineId})/dimensionSetLines`,
            {
              id: idDim,
              parentId: sLineId,
              valueId: idDimValue,
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

  async cleanSalesTickets(companyID, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    let sqlQ;

    let res = await axios
      .get(
        `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices?$filter=totalAmountIncludingTax eq 0`,
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
        if (res.data.value[i].totalAmountIncludingTax === 0) {
          console.log(
            '---------------------------------------' +
            res.data.value[i].number +
            '-----------------------------------------',
          );
          let z = res.data.value[i]['@odata.etag'];
          let delSale = await axios
            .delete(
              `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices(${res.data.value[i].id})`,
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
    } else {
      console.log('NO HAY SALES ' + res.data.value.length);
    }

    return true;
  }
}
