import { Injectable } from '@nestjs/common';
import { getTokenService } from '../conection/getToken.service';
import { runSqlService } from 'src/conection/sqlConection.service';
import axios from 'axios';
import { response } from 'express';
import { customersService } from 'src/customers/customers.service';
import { itemsService } from 'src/items/items.service';

@Injectable()
export class salesSilemaService {
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

  async syncSalesSilemaRecords(companyID, database, botiga, client_id: string, client_secret: string, tenant: string, entorno: string) {

  }

  //Sincroniza tickets HIT-BC
  async syncSalesSilema(companyID, database, botiga, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    let day = '15';
    botiga = 764;
    let sqlQHora = `select CONVERT(Time, Data) as hora, Import from [V_Moviments_2024-11] where botiga = ${botiga} and Tipus_moviment = 'Z' and day(data)=${day} group by Data, Import order by Data`
    //console.log(sqlQHora);

    let queryHora = await this.sql.runSql(sqlQHora, database);
    let hora = queryHora.recordset[0].hora;
    let importTurno1 = queryHora.recordset[0].Import
    let importTurno2 = queryHora.recordset[1].Import

    // Extraer la hora, minutos y segundos
    let hours = String(hora.getHours()).padStart(2, '0');
    let minutes = String(hora.getMinutes()).padStart(2, '0');
    let seconds = String(hora.getSeconds()).padStart(2, '0');

    // Formatear en "hh:mm:ss"
    let formattedHora = `${hours}:${minutes}:${seconds}`;
    //console.log(formattedHora); // Debería mostrar "14:31:43"

    //Turno 1

    let sqlQT1 = `use fac_tena;
select c.Nom, c.Nif, MIN(CONVERT(DATE, v.data)) as Data, a.Codi, a.NOM as producte, a.PREU, sum(import) as Import, sum(quantitat) as Quantitat, t.Iva, 
(SELECT MIN(num_tick) FROM [v_venut_2024-11] WHERE botiga = 764) AS MinNumTick,
(SELECT MAX(num_tick) FROM [v_venut_2024-11] WHERE botiga = 764) AS MaxNumTick
from [v_venut_2024-11] v 
left join articles a on v.plu = a.codi
left join clients c on v.botiga = c.codi
left join TipusIva2012 t on a.TipoIva = t.Tipus
where botiga=${botiga} and day(data)=${day} and CONVERT(TIME, data) < '${formattedHora}' group by a.NOM, a.Codi, a.PREU, c.nom, c.Nif, t.Iva`;
    //console.log(sqlQT1);

    let data = await this.sql.runSql(sqlQT1, database);
    let x = data.recordset[0];
    let date = new Date(x.Data);

    // Extraemos el día, el mes y el año
    day = String(date.getDate()).padStart(2, '0');
    let month = String(date.getMonth() + 1).padStart(2, '0'); // getMonth() es 0-indexado, así que sumamos 1
    let year = String(date.getFullYear()).slice(2); // Obtenemos solo los últimos dos dígitos del año

    // Formateamos la fecha en el formato ddmmyy
    let formattedDate = `${day}-${month}-${year}`;
    let formattedDate2 = new Date(x.Data).toISOString().substring(0, 10);
    let turno = 1

    let salesData = {
      no: `${x.Nom}_${turno}_${formattedDate}`, // Nº factura
      documentType: 'Invoice', // Tipo de documento
      dueDate: `${formattedDate2}`, // Fecha vencimiento
      externalDocumentNo: `${x.Nom}_${turno}_${formattedDate}`, // Nº documento externo
      locationCode: `${x.Nom}`, // Cód. almacén
      orderDate: `${formattedDate2}`, // Fecha pedido
      postingDate: `${formattedDate2}`, // Fecha registro
      recapInvoice: false, // Factura recap //false
      remainingAmount: parseFloat(importTurno1), // Precio total incluyendo IVA por factura
      shift: `Shift_x0020_${turno}`, // Turno
      shipToCode: `${x.Nom.toUpperCase()}`, // Cód. dirección envío cliente
      storeInvoice: true, // Factura tienda
      vatRegistrationNo: `${x.Nif}`, // CIF/NIF
      firstSummaryDocNo: `${x.MinNumTick}`, // Nº. Doc. Resumen primero
      lastSummaryDocNo: `${x.MaxNumTick}`, // Nº. Doc. Resumen último
      invoiceStartDate: `${formattedDate2}`, // Fecha inicio facturación
      invoiceEndDate: `${formattedDate2}`, // Fecha fin facturación
      salesLinesBuffer: [] // Array vacío para las líneas de ventas
    };

    for (let i = 0; i < data.recordset.length; i++) {
      x = data.recordset[i];
      let salesLine = {
        documentNo: `${salesData.no}`,
        type: `Item`,
        no: `${x.Codi}`,
        lineNo: i + 1,
        description: `${x.producte}`,
        quantity: parseFloat(x.Quantitat),
        lineTotalAmount: parseFloat(x.Import),
        vatProdPostingGroup: `${x.Iva}`
      };
      salesData.salesLinesBuffer.push(salesLine);
    }

    //console.log(salesData)
    let url1 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/salesHeadersBuffer?$filter=no eq '${salesData.no}'`;
    let resGet1 = await axios
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
        console.log(`Url ERROR: ${url1}`)
        throw new Error('Failed to obtain sale');
      });

    if (!resGet1.data) throw new Error('Failed to get factura line');
    if (resGet1.data.value.length === 0) {
      let url2 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/salesHeadersBuffer?$expand=salesLinesBuffer`;
      try {
        const response = await axios.post(
          url2,
          salesData, // Envía salesData directamente
          {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          }
        );
        //console.log('Response:', response.data);
        console.log('Factura subida con exito');
      } catch (error) {
        console.error('Error posting sales data:', error.response?.data || error.message);
      }

    }
    else {
      console.log("Ya existe la factura")
    }


    //Turno 2
    let sqlQT2 = `use fac_tena;
select c.Nom, c.Nif, MIN(CONVERT(DATE, v.data)) as Data, a.Codi, a.NOM as producte, a.PREU, sum(import) as Import, sum(quantitat) as Quantitat, t.Iva, 
(SELECT MIN(num_tick) FROM [v_venut_2024-11] WHERE botiga = 764) AS MinNumTick,
(SELECT MAX(num_tick) FROM [v_venut_2024-11] WHERE botiga = 764) AS MaxNumTick
from [v_venut_2024-11] v 
left join articles a on v.plu = a.codi
left join clients c on v.botiga = c.codi
left join TipusIva2012 t on a.TipoIva = t.Tipus
where botiga=${botiga} and day(data)=${day} and CONVERT(TIME, data) > '${formattedHora}' group by a.NOM, a.Codi, a.PREU, c.nom, c.Nif, t.Iva`;
    turno = 2
    data = await this.sql.runSql(sqlQT2, database);
    x = data.recordset[0];
    date = new Date(x.Data);

    // Extraemos el día, el mes y el año
    day = String(date.getDate()).padStart(2, '0');
    month = String(date.getMonth() + 1).padStart(2, '0'); // getMonth() es 0-indexado, así que sumamos 1
    year = String(date.getFullYear()).slice(2); // Obtenemos solo los últimos dos dígitos del año

    // Formateamos la fecha en el formato ddmmyy
    formattedDate = `${day}-${month}-${year}`;
    formattedDate2 = new Date(x.Data).toISOString().substring(0, 10);

    let salesData2 = {
      no: `${x.Nom}_${turno}_${formattedDate}`, // Nº factura
      documentType: 'Invoice', // Tipo de documento
      dueDate: `${formattedDate2}`, // Fecha vencimiento
      externalDocumentNo: `${x.Nom}_${turno}_${formattedDate}`, // Nº documento externo
      locationCode: `${x.Nom}`, // Cód. almacén
      orderDate: `${formattedDate2}`, // Fecha pedido
      postingDate: `${formattedDate2}`, // Fecha registro
      recapInvoice: false, // Factura recap //false
      remainingAmount: parseFloat(importTurno2), // Precio total incluyendo IVA por factura
      shift: `Shift_x0020_${turno}`, // Turno
      shipToCode: `${x.Nom.toUpperCase()}`, // Cód. dirección envío cliente
      storeInvoice: true, // Factura tienda
      vatRegistrationNo: `${x.Nif}`, // CIF/NIF
      firstSummaryDocNo: `${x.MinNumTick}`, // Nº. Doc. Resumen primero
      lastSummaryDocNo: `${x.MaxNumTick}`, // Nº. Doc. Resumen último
      invoiceStartDate: `${formattedDate2}`, // Fecha inicio facturación
      invoiceEndDate: `${formattedDate2}`, // Fecha fin facturación
      salesLinesBuffer: [] // Array vacío para las líneas de ventas
    };

    for (let i = 0; i < data.recordset.length; i++) {
      x = data.recordset[i];
      let salesLine = {
        documentNo: `${salesData2.no}`,
        type: `Item`,
        no: `${x.Codi}`,
        lineNo: i + 1,
        description: `${x.producte}`,
        quantity: parseFloat(x.Quantitat),
        lineTotalAmount: parseFloat(x.Import),
        vatProdPostingGroup: `IVA${x.Iva}`
      };
      salesData2.salesLinesBuffer.push(salesLine);
    }

    //console.log(salesData2)
    let url3 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/salesHeadersBuffer?$filter=no eq '${salesData2.no}'`;
    let resGet2 = await axios
      .get(
        url3,
        {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        },
      )
      .catch((error) => {
        console.log(`Url ERROR: ${url1}`)
        throw new Error('Failed to obtain sale');
      });

    if (!resGet2.data) throw new Error('Failed to get factura line');
    if (resGet2.data.value.length === 0) {
      let url4 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/salesHeadersBuffer?$expand=salesLinesBuffer`;
      try {
        const response = await axios.post(
          url4,
          salesData2, // Envía salesData directamente
          {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          }
        );
        //console.log('Response:', response.data);
        console.log('Factura subida con exito');
      } catch (error) {
        console.error('Error posting sales data:', error.response?.data || error.message);
      }

    }
    else {
      console.log("Ya existe la factura")
    }


    return true;
  }
}