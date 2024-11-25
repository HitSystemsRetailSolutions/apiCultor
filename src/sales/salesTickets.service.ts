import { Injectable } from '@nestjs/common';
import { getTokenService } from '../conection/getToken.service';
import { runSqlService } from 'src/conection/sqlConection.service';
import { itemsService } from 'src/items/items.service';
import { customersService } from 'src/customers/customers.service';
import axios from 'axios';
import { mqttPublish } from 'src/main';
import { mqttPublishRepeat } from 'src/main';

@Injectable()
export class salesTicketsService {
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
    private items: itemsService,
    private customers: customersService,
  ) { }

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

  // Get Item from API
  async getItemVarisFromAPI(companyID, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let item = '';
    // Get the authentication token
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    // Get Item from API
    let res = await axios
      .get(
        `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/items?$filter=number eq 'VARIS'`,
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
      let newItems = await axios
        .post(
          `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/items`,
          {
            number: 'VARIS',
            displayName: 'VARIS',
            generalProductPostingGroupCode: 'NO IVA',
            unitPrice: 0.01,
            baseUnitOfMeasureCode: '002',
          },
          {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          },
        )
        .catch((error) => {
          throw new Error('Failed post item VARIS');
        });
      item = newItems.data.value;
    } else {
      item = res.data.value[0];
    }
    return item;
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
    let url = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices?$filter=externalDocumentNumber eq '${docNumber}'`
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
        console.log(`Url ERROR: ${url}`)
        throw new Error('Failed to obtain ticket C');
      });

    if (!res.data) throw new Error('Failed to obtain ticket D');
    return res;
  }

  async getSaleLineFromAPI(idSale, lineObjectNumber, companyID, client_id: string, client_secret: string, tenant: string, entorno: string) {
    // Get the authentication token
    //console.log(lineObjectNumber);
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    let url = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices(${idSale})/salesInvoiceLines?$filter=lineObjectNumber eq '${lineObjectNumber}'`;
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
        console.log(`Url ERROR: ${url}`)
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

    let record;
    try {
      record = await this.sql.runSql(
        "select * from records where concepte='BC_SalesTickets_" + botiga + "'",
        database,
      );
    } catch (error) {
      //Comprovacion de errores y envios a mqtt
      mqttPublish('No existe la database');
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
        fIni = record.recordset[0].TimeStamp;
        console.log('Fecha records: ', fIni);
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
    /*
        let sqlQ = `SELECT num_tick AS nTickHit, CONVERT(VARCHAR, v.Data, 23) AS Data, v.Data AS tmstStr, CONCAT(UPPER(c.nom), '_', num_tick) AS Num_tick, CASE WHEN CHARINDEX('tarjeta', v.otros) > 0 OR CHARINDEX('targeta', m.motiu) > 0 THEN 'TARJETA' WHEN CHARINDEX('3g', v.otros) > 0 OR CHARINDEX('targeta3g', m.motiu) > 0 THEN '3G' ELSE 'CAJA' END AS FormaPago, ISNULL(c2.codi, '1314') AS Client, SUM(v.import) AS Total FROM ${tabVenut} v 
        LEFT JOIN ${tabMoviments} m ON m.botiga = v.botiga AND CONCAT('Pagat Targeta: ', v.num_tick) = m.motiu 
        LEFT JOIN clients c ON v.botiga = c.codi 
        LEFT JOIN ClientsFinals cf ON CONCAT('[Id:', cf.id, ']') = v.otros 
        LEFT JOIN clients c2 ON CASE WHEN CHARINDEX('AbonarEn:', cf.altres) = 0 THEN '' ELSE SUBSTRING(cf.altres, CHARINDEX('AbonarEn:', cf.altres) + 9, CHARINDEX(']', cf.altres, CHARINDEX('AbonarEn:', cf.altres) + 9) - CHARINDEX('AbonarEn:', cf.altres) - 9) END = c2.codi 
        WHERE v.botiga = ${botiga} AND v.data >= (SELECT timestamp FROM records WHERE concepte = 'BC_SalesTickets_${botiga}') 
        GROUP BY v.data, num_tick, CONCAT(UPPER(c.nom), '_', num_tick), CASE WHEN CHARINDEX('tarjeta', v.otros) > 0 OR CHARINDEX('targeta', m.motiu) > 0 THEN 'TARJETA' WHEN CHARINDEX('3g', v.otros) > 0 OR CHARINDEX('targeta3g', m.motiu) > 0 THEN '3G' ELSE 'CAJA' END, ISNULL(c2.codi, '1314') ORDER BY v.data;`
        console.log(`Sql: ${sqlQ}`);
        */
    /*
        let sqlQuery = ` SELECT num_tick AS nTickHit, CONVERT(VARCHAR, v.Data, 23) AS Data, v.Data AS tmstStr, CONCAT(UPPER(c.nom), '_', num_tick) AS Num_tick, CASE WHEN v.otros LIKE '%tarjeta%' OR m.motiu LIKE '%targeta%' THEN 'TARJETA' WHEN v.otros LIKE '%3g%' OR m.motiu LIKE '%targeta3g%' THEN '3G' ELSE 'CAJA' END AS FormaPago, ISNULL(c2.codi, '1314') AS Client, SUM(v.import) AS Total FROM ${tabVenut} v
              LEFT JOIN ${tabMoviments} m ON m.botiga = v.botiga AND CONCAT('Pagat Targeta: ', v.num_tick) = m.motiu
              LEFT JOIN clients c ON v.botiga = c.codi
              LEFT JOIN ClientsFinals cf ON CONCAT('[Id:', cf.id, ']') = v.otros
              LEFT JOIN clients c2 ON CASE WHEN CHARINDEX('AbonarEn:', cf.altres) = 0 THEN '' ELSE SUBSTRING(cf.altres, CHARINDEX('AbonarEn:', cf.altres) + 9, CHARINDEX(']', cf.altres, CHARINDEX('AbonarEn:', cf.altres) + 9) - CHARINDEX('AbonarEn:', cf.altres) - 9) END = c2.codi
              WHERE v.botiga = ${botiga} AND v.data >= (SELECT timestamp FROM records WHERE concepte = 'BC_SalesTickets_${botiga}')
              GROUP BY v.data, num_tick, CONCAT(UPPER(c.nom), '_', num_tick), CASE WHEN v.otros LIKE '%tarjeta%' OR m.motiu LIKE '%targeta%' THEN 'TARJETA' WHEN v.otros LIKE '%3g%' OR m.motiu LIKE '%targeta3g%' THEN '3G' ELSE 'CAJA' END, ISNULL(c2.codi, '1314') ORDER BY v.data; `;
        console.log(`Sql: ${sqlQuery}`);
    */

    const sqlQuery = `
        SELECT 
            CONVERT(VARCHAR, v.Data, 23) AS Data, 
            CASE 
                WHEN v.otros LIKE '%tarjeta%' OR m.motiu LIKE '%targeta%' THEN 'TARJETA' 
                WHEN v.otros LIKE '%3g%' OR m.motiu LIKE '%targeta3g%' THEN '3G' 
                ELSE 'CAJA' 
            END AS FormaPago, 
            ISNULL(c2.codi, '1314') AS Client, 
            COUNT(v.num_tick) AS nTickHit,  -- Cantidad de tickets por día y forma de pago
            CONCAT(CASE 
                WHEN v.otros LIKE '%tarjeta%' OR m.motiu LIKE '%targeta%' THEN 'TARJETA' 
                WHEN v.otros LIKE '%3g%' OR m.motiu LIKE '%targeta3g%' THEN '3G' 
                ELSE 'CAJA' 
            END, ' - ', ${botiga}, '/', CONVERT(VARCHAR, v.Data, 23)) AS Num_tick, -- Forma de pago, botiga y fecha
            SUM(v.import) AS Total
        FROM 
            ${tabVenut} v
        LEFT JOIN 
            ${tabMoviments} m ON m.botiga = v.botiga AND CONCAT('Pagat Targeta: ', v.num_tick) = m.motiu
        LEFT JOIN 
            clients c ON v.botiga = c.codi
        LEFT JOIN 
            ClientsFinals cf ON CONCAT('[Id:', cf.id, ']') = v.otros
        LEFT JOIN 
            clients c2 ON CASE 
                             WHEN CHARINDEX('AbonarEn:', cf.altres) = 0 THEN '' 
                             ELSE SUBSTRING(cf.altres, CHARINDEX('AbonarEn:', cf.altres) + 9, CHARINDEX(']', cf.altres, CHARINDEX('AbonarEn:', cf.altres) + 9) - CHARINDEX('AbonarEn:', cf.altres) - 9) 
                         END = c2.codi
        WHERE 
            v.botiga = ${botiga} 
            AND v.data >= (SELECT timestamp FROM records WHERE concepte = 'BC_SalesTickets_${botiga}')
        GROUP BY 
            CONVERT(VARCHAR, v.Data, 23), 
            CASE 
                WHEN v.otros LIKE '%tarjeta%' OR m.motiu LIKE '%targeta%' THEN 'TARJETA' 
                WHEN v.otros LIKE '%3g%' OR m.motiu LIKE '%targeta3g%' THEN '3G' 
                ELSE 'CAJA' 
            END, 
            ISNULL(c2.codi, '1314')
        ORDER BY 
            CONVERT(VARCHAR, v.Data, 23);
        `;
    console.log(`Sql: ${sqlQuery}`);

    let tickets;
    try {
      tickets = await this.sql.runSql(sqlQuery, database);
    } catch (error) {
      //Comprovacion de errores y envios a mqtt
      mqttPublish('No existe la database');
      console.log(`Error: ${error}`);

      return false;
    }

    if (tickets.recordset.length == 0) {
      //Comprovacion de errores y envios a mqtt
      mqttPublish('No hay registros');
      console.log('No hay registros');
      return false;
    }

    console.log("Total tickets: ", tickets.recordset.length)
    let clientCodi = 'A';
    let testing = false;
    for (let i = 0; i < tickets.recordset.length; i++) {
      /*
      if (i == 10 && testing) {
        let msgJson = {
          msg: "tickets",
          companyID: companyID,
          database: database,
          entorno: entorno,
          tenant: tenant,
          client_id: client_id,
          client_secret: client_secret,
          botiga: botiga,
          debug: true,
          repeat: ""
        }
        mqttPublishRepeat(msgJson)
        //continue;
        throw new Error('Error:');
      }*/
      try {
        let x = tickets.recordset[i];
        let customerId = await this.customers.getCustomerFromAPI(companyID, database, clientCodi, client_id, client_secret, tenant, entorno);
        // 1. Consultar el método de pago actual del cliente
        const customerResponse = await axios.get(
          `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/customers(${customerId})`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          },
        );

        const originalPaymentMethodId = customerResponse.data.paymentMethodId;
        const etag = customerResponse.data['@odata.etag'];
        //console.log(etag);

        console.log(`Forma Pago: ${x.FormaPago}`);
        // Obtener el ID del método de pago segun el ticket que enviaremos
        const paymentMethodsResponse = await axios.get(
          `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/paymentMethods?$filter=code eq '${x.FormaPago}'`,
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
          `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/customers(${customerId})`,
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

        //console.log ("CustomerId: " + customerId);
        let url1 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices?$filter=externalDocumentNumber eq '${x.Num_tick}'`;
        let peticiones = 0;
        let exito = false;
        let res;
        while (peticiones < 10 && !exito) {
          try {
            res = await axios
              .get(
                url1,
                {
                  headers: {
                    Authorization: 'Bearer ' + token,
                    'Content-Type': 'application/json',
                  },
                },
              )
            if (res.status === 200 && res.data) {
              exito = true; // Marcar que la petición fue exitosa
            } else {
              console.log('Respuesta inesperada:', res.status);
            }
          } catch (error) {
            console.log(`Intento ${peticiones + 1}: Error en la URL: ${url1}`);
            //throw new Error('Failed to obtain ticket A');
          }
          peticiones++;
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        if (!exito) {
          console.log('La petición falló después de 100 intentos.');
        }

        //if (!res.data) throw new Error('Failed to obtain ticket B');

        if (res.data.value.length === 0) {
          //SI NO EXISTE EL TICKET EN BC LO CREAMOS
          let url2 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices`;
          let newTickets
          try {
            newTickets = await axios
              .post(
                url2,
                {
                  externalDocumentNumber: x.Num_tick,
                  invoiceDate: x.Data,
                  postingDate: x.Data,
                  customerId: customerId,
                  unitPrice: x.Import,
                },
                {
                  headers: {
                    Authorization: 'Bearer ' + token,
                    'Content-Type': 'application/json',
                  },
                },
              )
          } catch (error) {
            console.log(`Datos: ${x.Num_tick}, ${x.Data}, ${customerId}`)
            console.log(`Url ERROR: ${url2}`);
            //throw new Error('Failed post ticket A');
          }
          if (!newTickets.data) console.log('Failed post ticket B');
          else {
            //AÑADIMOS LAS LINEAS DEL TICKET
            /*
            let ticketBC = await this.getSaleFromAPI(x.Num_tick, companyID, client_id, client_secret, tenant, entorno);
            //console.log('Tickets BC: ', ticketBC.data.value[0].id);
            await this.synchronizeSalesTiquetsLines(tabVenut, botiga, x.nTickHit, ticketBC.data.value[0].id, database, companyID, client_id, client_secret, tenant, entorno).catch(console.error);
            //console.log('Tmst: ', x.tmstStr);
            //console.log('Data: ', x.Data);
            */
            let ticketBC = await this.getSaleFromAPI(x.Num_tick, companyID, client_id, client_secret, tenant, entorno);
            console.log('Tickets BC: ', ticketBC.data.value[0].id);
            await this.synchronizeSalesTiquetsLinesVARIS(ticketBC.data.value[0].id, x.Total, 0.01, companyID, client_id, client_secret, tenant, entorno).catch(console.error);
            console.log('Synchronizing tickets... -> ' + (i + 1) + '/' + (tickets.recordset.length + 1), ' --- ', ((i / tickets.recordset.length) * 100).toFixed(2) + '%', ' | Time left: ' + ((tickets.recordset.length - i) * (0.5 / 60)).toFixed(2) + ' minutes',);

            // Suponiendo que x.Data es '2024-10-09'
            let dateString = x.Data; // Formato YYYY-MM-DD
            let timeString = '00:00:00'; // La hora que quieras añadir, aquí 00:00:00

            // Concatenamos la fecha y la hora para crear una fecha con tiempo
            let dateTimeString = `${dateString}T${timeString}`;

            // Convertimos el string en un objeto Date
            let dateObj = new Date(dateTimeString);

            // Generamos el SQL usando la fecha con formato ISO
            let sqlUpdate = `update records set timestamp='${dateObj.toISOString()}' where Concepte='BC_SalesTickets_${botiga}'`;
            console.log(`update: ${sqlUpdate}`);
            await this.sql.runSql(sqlUpdate, database);
          }
        } else {
          console.log('Ya existe el ticket');
        }
      } catch (error) {
        console.log('Error:', error);
        let msgJson = {
          msg: "tickets",
          companyID: companyID,
          database: database,
          entorno: entorno,
          tenant: tenant,
          client_id: client_id,
          client_secret: client_secret,
          botiga: botiga,
          debug: true,
          repeat: ""
        }
        mqttPublishRepeat(msgJson)
        //continue;
        throw new Error('Error:');
      }
    }

    return true;
  }

  //AÑADIMOS LAS LINEAS AL TICKET
  async synchronizeSalesTiquetsLines(tabVenut, botiga, nTickHit, ticketId, database, companyID, client_id, client_secret, tenant, entorno) {
    let token = await this.token.getToken2(client_id, client_secret, tenant);

    let sqlQ;
    sqlQ = `
      select upper(c.nom) BotigaNom, concat(upper(c.nom), '_', num_tick) Num_tick, 
             sum(v.Quantitat) Quantitat, sum(v.import)/sum(v.Quantitat) UnitPrice, 
             CAST(v.Plu as varchar) Plu 
      From ${tabVenut} v 
      left join clients c on v.botiga=c.codi 
      where v.botiga=${botiga} and num_tick='${nTickHit}'
      group by concat(upper(c.nom), '_', num_tick), CAST(v.Plu as varchar), c.nom
    `;

    let ticketsLines = await this.sql.runSql(sqlQ, database);
    console.log('Total lines: ', ticketsLines.recordset.length);

    for (let i = 0; i < ticketsLines.recordset.length; i++) {
      let x = ticketsLines.recordset[i];
      console.log(`Processing line ${i + 1}/${ticketsLines.recordset.length}`, x);

      let item
      item = await this.items.getItemFromAPI(companyID, database, x.Plu, client_id, client_secret, tenant, entorno);
      let res = await this.getSaleLineFromAPI(ticketId, 'CODI-' + x.Plu, companyID, client_id, client_secret, tenant, entorno);
      let url = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices(${ticketId})/salesInvoiceLines`;

      let response;
      if (res.data.value.length === 0) {
        try {
          response = await axios.post(url, {
            documentId: ticketId,
            itemId: item.id,
            quantity: x.Quantitat,
            taxCode: item.generalProductPostingGroupCode,
            unitPrice: x.UnitPrice
          }, {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          });
        } catch (error) {
          console.error(`Failed to post Ticket line for PLU ${x.Plu}:`, error);
          continue;
        }

        let botigaNom = x.BotigaNom;
        let idDim = await this.getDimensionFromAPI('BOTIGUES', companyID, client_id, client_secret, tenant, entorno);
        if (idDim == null) {
          console.warn(`Dimension 'BOTIGUES' not found`);
          continue;
        }
        let idDimValue = await this.getDimensionValueIdFromAPI(idDim, botigaNom, companyID, client_id, client_secret, tenant, entorno);
        if (idDimValue == null) {
          console.warn(`Dimension value for ${botigaNom} not found`);
          continue;
        }

        let resSaleLine = await this.getSaleLineFromAPI(ticketId, 'CODI-' + x.Plu, companyID, client_id, client_secret, tenant, entorno);
        let sLineId = resSaleLine.data.value[0].id;

        try {
          await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices(${ticketId})/salesInvoiceLines(${sLineId})/dimensionSetLines`, {
            id: idDim,
            parentId: sLineId,
            valueId: idDimValue,
            valueCode: botigaNom,
          }, {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          });
        } catch (error) {
          console.error(`Failed to post dimension for PLU ${x.Plu}:`, error);
        }
      } else {
        console.log(`Ticket line for PLU ${x.Plu} already exists`);
      }
    }
    return true;
  }

  //AÑADIMOS LAS LINEAS AL TICKET
  async synchronizeSalesTiquetsLinesVARIS(ticketId, quantityItem, unitPrice, companyID, client_id, client_secret, tenant, entorno) {
    let token = await this.token.getToken2(client_id, client_secret, tenant);

    let item
    item = await this.getItemVarisFromAPI(companyID, client_id, client_secret, tenant, entorno);
    let url = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices(${ticketId})/salesInvoiceLines`;
    let unitPriceNumber = stringToNumber(quantityItem);
    let unitPriceQuantity = unitPriceNumber * 100;
    console.log(`Quantity ${unitPriceQuantity}`)
    let response;
    try {
      response = await axios.post(url, {
        documentId: ticketId,
        itemId: item.id,
        quantity: unitPriceQuantity,
        taxCode: item.generalProductPostingGroupCode,
        unitPrice: unitPrice
      }, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      });
    } catch (error) {
      console.error(`Failed to post Ticket line:`, error);
    }
    return true;
  }


  async cleanSalesTickets(companyID, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    let sqlQ;
    let url = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices?$filter=totalAmountIncludingTax eq 0`;
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
        console.log(`Url ERROR: ${url}`)
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

function stringToNumber(input: any): number {
  if (typeof input !== 'string') {
    input = String(input); // Convierte el valor a string si no lo es
  }

  const inputreplace = input.replace(',', '.'); // Reemplaza comas por puntos
  const result = parseFloat(inputreplace); // Convierte el string a número

  if (isNaN(result)) {
    throw new Error("El valor de entrada no es un número válido.");
  }

  return result;
}