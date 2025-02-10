import { Injectable } from '@nestjs/common';
import { getTokenService } from '../conection/getToken.service';
import { runSqlService } from 'src/conection/sqlConection.service';
import axios from 'axios';

@Injectable()
export class salesSilemaService {
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
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

  // Funcion que utiliza la tabla records mira donde se quedo la ultima sincronizacion y sincroniza los datos faltantes hasta el dia y hora actuales
  async syncSalesSilemaRecords(companyID, database, botiga, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let sqlRecords = `SELECT * FROM records WHERE Concepte = 'BC_Silema${botiga}'`;
    try {
      let queryRecords = await this.sql.runSql(sqlRecords, database)
      if (queryRecords.recordset.length == 0) {
        let sqlInsert = `INSERT INTO records (timestamp, concepte) SELECT MIN(TimeStamp), 'BC_Silema${botiga}' FROM incidencias;`;
        let recordsInsert = await this.sql.runSql(sqlInsert, database);
        queryRecords = await this.sql.runSql(sqlRecords, database)
      }

      // Asegúrate de que `dbTimestamp` sea una cadena o Date válida
      const dbTimestamp: string = queryRecords.recordset[0].TimeStamp;

      // Convierte el timestamp a un objeto Date
      const dbDate: Date = new Date(dbTimestamp);

      // Obtén la fecha actual
      const today: Date = new Date();

      // Normaliza ambas fechas para que no incluyan horas, minutos, segundos
      const startDate: Date = new Date(dbDate.getFullYear(), dbDate.getMonth(), dbDate.getDate());
      const endDate: Date = new Date(today.getFullYear(), today.getMonth(), today.getDate());

      // Calcula la diferencia de días entre las fechas
      const daysDiff: number = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

      // Llama a tu función por cada día entre las fechas
      if (daysDiff >= 0) {
        for (let i = 1; i <= daysDiff; i++) {
          // Calcula la fecha actual dentro del rango
          const currentDay: Date = new Date(startDate);
          currentDay.setDate(currentDay.getDate() + i);

          // Extrae año, mes y día como valores separados
          const year: number = currentDay.getFullYear();
          const month: string = String(currentDay.getMonth() + 1).padStart(2, '0'); // Mes en formato 2 dígitos
          const day: string = String(currentDay.getDate()).padStart(2, '0'); // Día en formato 2 dígitos

          // Formatea la fecha en el formato "yyyy-mm-dd"
          const formattedDay: string = `${year}-${month}-${day}`;

          console.log(`Llamando a la función para el día: ${year}-${month}-${day}`);
          // Llama a tu función con el día formateado
          await this.syncSalesSilema(day, month, year, companyID, database, botiga, client_id, client_secret, tenant, entorno);
          await this.syncSalesSilemaAbono(day, month, year, companyID, database, botiga, client_id, client_secret, tenant, entorno);
        }

        const updateQuery: string = `UPDATE records SET timestamp = GETDATE() WHERE Concepte = 'BC_Silema${botiga}';`;
        await this.sql.runSql(updateQuery, database);

      } else {
        console.log("La fecha de la base de datos es en el futuro.");
      }
    } catch (error) {
      throw new Error('Error');
    }
    return true
  }

  // Funcion que pasandole un dia de inicio y otro 
  async syncSalesSilemaDate(dayStart, dayEnd, month, year, companyID, database, botiga, client_id: string, client_secret: string, tenant: string, entorno: string) {
    try {
      // Itera desde el día inicial hasta el día final
      for (let day = dayStart; day <= dayEnd; day++) {
        // Formatea el día y el mes para asegurarse de que tengan 2 dígitos
        const formattedDay = String(day).padStart(2, '0');
        const formattedMonth = String(month).padStart(2, '0');
        const formattedYear = String(year);

        // Llama a tu función con el día formateado
        await this.syncSalesSilema(formattedDay, formattedMonth, formattedYear, companyID, database, botiga, client_id, client_secret, tenant, entorno);
        console.log('mondongo')
        await this.syncSalesSilemaAbono(formattedDay, formattedMonth, formattedYear, companyID, database, botiga, client_id, client_secret, tenant, entorno);
      }
    } catch (error) {
      throw new Error('Error');
    }
    return true
  }


  //Sincroniza tickets HIT-BC, Ventas
  async syncSalesSilema(day, month, year, companyID, database, botiga, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    let sqlQHora = `select CONVERT(Time, Data) as hora, Import from [V_Moviments_${year}-${month}] where botiga = ${botiga} and Tipus_moviment = 'Z' and day(data)=${day} group by Data, Import order by Data`
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
    let sqlQT1 = `SELECT c.Nom, c.Nif, MIN(CONVERT(DATE, v.data)) AS Data, COALESCE(a.Codi, az.Codi) AS Codi, COALESCE(a.NOM, az.NOM) AS Producte, COALESCE(a.PREU, az.PREU) AS Preu, SUM(import) AS Import, SUM(quantitat) AS Quantitat, COALESCE(t.Iva, tz.Iva) AS Iva, 
    (SELECT MIN(num_tick) FROM [v_venut_${year}-${month}] WHERE botiga = ${botiga}) AS MinNumTick, 
    (SELECT MAX(num_tick) FROM [v_venut_${year}-${month}] WHERE botiga = ${botiga}) AS MaxNumTick 
    FROM [v_venut_${year}-${month}] v 
    LEFT JOIN articles a ON v.plu = a.codi 
    LEFT JOIN articles_zombis az ON v.plu = az.codi AND a.codi IS NULL 
    LEFT JOIN clients c ON v.botiga = c.codi LEFT JOIN TipusIva2012 t ON a.TipoIva = t.Tipus 
    LEFT JOIN TipusIva2012 tz ON az.TipoIva = tz.Tipus AND t.Tipus IS NULL 
    WHERE v.botiga = ${botiga} AND DAY(v.data) = ${day} AND CONVERT(TIME, v.data) < '${formattedHora}' GROUP BY COALESCE(a.NOM, az.NOM), COALESCE(a.Codi, az.Codi), COALESCE(a.PREU, az.PREU), c.nom, c.Nif, COALESCE(t.Iva, tz.Iva);`
    //console.log(sqlQT1);

    let data = await this.sql.runSql(sqlQT1, database);
    let x = data.recordset[0];
    let date = new Date(x.Data);

    // Extraemos el día, el mes y el año
    day = String(date.getDate()).padStart(2, '0');
    month = String(date.getMonth() + 1).padStart(2, '0'); // getMonth() es 0-indexado, así que sumamos 1
    let formattedYear = String(date.getFullYear()).slice(2); // Obtenemos solo los últimos dos dígitos del año

    // Formateamos la fecha en el formato ddmmyy
    let formattedDate = `${day}-${month}-${formattedYear}`;
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
      remainingAmount: parseFloat(importTurno1), //Precio total incluyendo IVA por factura
      sellToCustomerNo: "430001314",
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
    let url1 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/salesHeadersBuffer?$filter=no eq '${salesData.no}' and documentType eq '${salesData.documentType}'`;
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
    let sqlQT2 = `SELECT c.Nom, c.Nif, MIN(CONVERT(DATE, v.data)) AS Data, COALESCE(a.Codi, az.Codi) AS Codi, COALESCE(a.NOM, az.NOM) AS Producte, COALESCE(a.PREU, az.PREU) AS Preu, SUM(import) AS Import, SUM(quantitat) AS Quantitat, COALESCE(t.Iva, tz.Iva) AS Iva, 
    (SELECT MIN(num_tick) FROM [v_venut_${year}-${month}] WHERE botiga = ${botiga}) AS MinNumTick, 
    (SELECT MAX(num_tick) FROM [v_venut_${year}-${month}] WHERE botiga = ${botiga}) AS MaxNumTick 
    FROM [v_venut_${year}-${month}] v 
    LEFT JOIN articles a ON v.plu = a.codi 
    LEFT JOIN articles_zombis az ON v.plu = az.codi AND a.codi IS NULL 
    LEFT JOIN clients c ON v.botiga = c.codi LEFT JOIN TipusIva2012 t ON a.TipoIva = t.Tipus 
    LEFT JOIN TipusIva2012 tz ON az.TipoIva = tz.Tipus AND t.Tipus IS NULL 
    WHERE v.botiga = ${botiga} AND DAY(v.data) = ${day} AND CONVERT(TIME, v.data) > '${formattedHora}' GROUP BY COALESCE(a.NOM, az.NOM), COALESCE(a.Codi, az.Codi), COALESCE(a.PREU, az.PREU), c.nom, c.Nif, COALESCE(t.Iva, tz.Iva);`
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
      sellToCustomerNo: "430001314",
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
    let url3 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/salesHeadersBuffer?$filter=no eq '${salesData2.no}' and documentType eq '${salesData.documentType}'`;
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

  //Abono
  async syncSalesSilemaAbono(day, month, year, companyID, database, botiga, client_id: string, client_secret: string, tenant: string, entorno: string) {
    console.log('pata')
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    let sqlQHora = `select CONVERT(Time, Data) as hora, CONVERT(Date, Data) as data, Import from [V_Moviments_${year}-${month}] where botiga = ${botiga} and Tipus_moviment = 'Z' and day(data)=${day} group by Data, Import order by Data`
    //console.log(sqlQHora);
    console.log('ta')

    let queryHora = await this.sql.runSql(sqlQHora, database);
    let hora = queryHora.recordset[0].hora;
    let importTotal: number = 0;

    // Extraer la hora, minutos y segundos
    let hours = String(hora.getHours()).padStart(2, '0');
    let minutes = String(hora.getMinutes()).padStart(2, '0');
    let seconds = String(hora.getSeconds()).padStart(2, '0');

    // Formatear en "hh:mm:ss"
    let formattedHora = `${hours}:${minutes}:${seconds}`;
    //console.log(formattedHora); // Debería mostrar "14:31:43"

    //Turno 1
    let sqlQ = `
DECLARE @Botiga INT = ${botiga};
DECLARE @Dia INT = ${day};
DECLARE @Hora TIME = '${formattedHora}';

;WITH ExtractedData AS (
    SELECT 
        SUBSTRING(v.otros, CHARINDEX('id:', v.otros) + 3, CHARINDEX(']', v.otros, CHARINDEX('id:', v.otros)) - (CHARINDEX('id:', v.otros) + 3)) AS ExtractedValue,
        v.import,
        i.iva,
		v.Botiga
    FROM [v_venut_${year}-${month}] v
    LEFT JOIN articles a ON v.plu = a.codi
    LEFT JOIN TipusIva2012 i ON a.TipoIva = i.Tipus
    WHERE num_tick IN (
        SELECT 
            SUBSTRING(motiu, CHARINDEX(':', motiu) + 2, LEN(motiu)) AS Numero
        FROM [v_moviments_${year}-${month}]
        WHERE botiga = @Botiga
          AND DAY(data) = @Dia
          AND CONVERT(TIME, data) < @Hora
          AND motiu LIKE 'Deute client%'
    )
    AND CHARINDEX('id:', v.otros) > 0
    AND CHARINDEX(']', v.otros, CHARINDEX('id:', v.otros)) > 0
    AND CONVERT(TIME, data) < @Hora
),
FilteredData AS (
    SELECT 
        d.ExtractedValue,
        c.valor,
        c.codi,
        cl.nif,
        d.import,
        d.iva,
		cl2.Nif as nifTienda,
		cl2.Nom as Nom
    FROM ExtractedData d
    INNER JOIN constantsclient c ON c.valor = d.ExtractedValue 
    INNER JOIN clients cl ON cl.codi = c.codi
	INNER JOIN clients cl2 ON cl2.codi = d.botiga
)
SELECT 
	FilteredData.Nom AS Nom,
  FilteredData.nifTienda AS NifTienda,
  FilteredData.iva AS IVA,
  SUM(FilteredData.import) AS Importe
FROM FilteredData
GROUP BY FilteredData.Nom, FilteredData.nifTienda, FilteredData.iva
ORDER BY FilteredData.iva, FilteredData.nifTienda;
`;
    //console.log(sqlQT1);

    let data = await this.sql.runSql(sqlQ, database);
    if (data.recordset.length > 0) {
      let x = data.recordset[0];
      let shortYear = year.slice(-2);

      let formattedDay = day.padStart(2, '0');
      let formattedMonth = month.padStart(2, '0');
      // Formateamos la fecha en el formato ddmmyy
      let formattedDate = `${formattedDay}-${formattedMonth}-${shortYear}`;
      let formattedDate2 = new Date(queryHora.recordset[0].data).toISOString().substring(0, 10);
      let turno = 1

      let salesData = {
        no: `${x.Nom}_${turno}_${formattedDate}`, // Nº factura
        documentType: 'Credit_x0020_Memo', // Tipo de documento
        dueDate: `${formattedDate2}`, // Fecha vencimiento
        externalDocumentNo: `${x.Nom}_${turno}_${formattedDate}`, // Nº documento externo
        locationCode: `${x.Nom}`, // Cód. almacén
        orderDate: `${formattedDate2}`, // Fecha pedido
        personalStoreInvoice: true,
        postingDate: `${formattedDate2}`, // Fecha registro
        recapInvoice: false, // Factura recap //false
        remainingAmount: importTotal, // Precio total incluyendo IVA por factura
        sellToCustomerNo: "430001314",
        shift: `Shift_x0020_${turno}`, // Turno
        shipToCode: `${x.Nom.toUpperCase()}`, // Cód. dirección envío cliente
        storeInvoice: true, // Factura tienda
        vatRegistrationNo: `${x.NifTienda}`, // CIF/NIF
        invoiceStartDate: `${formattedDate2}`, // Fecha inicio facturación
        invoiceEndDate: `${formattedDate2}`, // Fecha fin facturación
        salesLinesBuffer: [] // Array vacío para las líneas de ventas
      };

      for (let i = 0; i < data.recordset.length; i++) {
        x = data.recordset[i];
        let salesLine = {
          documentNo: `${salesData.no}`,
          type: `G_x002F_L_x0020_Account`,
          no: `7000001`,
          lineNo: i + 1,
          //description: `${x.producte}`,
          quantity: 1,
          lineTotalAmount: parseFloat(x.Importe),
          vatProdPostingGroup: `IVA${x.IVA}`
        };
        importTotal += parseFloat(x.Importe)
        salesData.salesLinesBuffer.push(salesLine);
      }
      salesData.remainingAmount = importTotal;


      //console.log(salesData)
      let url1 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/salesHeadersBuffer?$filter=no eq '${salesData.no}' and documentType eq '${salesData.documentType}'`;
      //console.log(url1);
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
          console.log('Abono subido con exito');
        } catch (error) {
          console.error('Error posting sales abono data:', error.response?.data || error.message);
        }

      }
      else {
        console.log(`Ya existe el abono ${salesData.no}`)
      }

      //Facturas Turno 1

      sqlQ = `
DECLARE @Botiga INT = ${botiga};
DECLARE @Dia INT = ${day};
DECLARE @Hora TIME = '${formattedHora}';

;WITH ExtractedData AS (
    SELECT 
        SUBSTRING(v.otros, CHARINDEX('id:', v.otros) + 3, CHARINDEX(']', v.otros, CHARINDEX('id:', v.otros)) - (CHARINDEX('id:', v.otros) + 3)) AS ExtractedValue,
        v.import,
        i.iva,
		v.Botiga
    FROM [v_venut_${year}-${month}] v
    LEFT JOIN articles a ON v.plu = a.codi
    LEFT JOIN TipusIva2012 i ON a.TipoIva = i.Tipus
    WHERE num_tick IN (
        SELECT 
            SUBSTRING(motiu, CHARINDEX(':', motiu) + 2, LEN(motiu)) AS Numero
        FROM [v_moviments_${year}-${month}]
        WHERE botiga = @Botiga
          AND DAY(data) = @Dia
          AND CONVERT(TIME, data) < @Hora
          AND motiu LIKE 'Deute client%'
    )
    AND CHARINDEX('id:', v.otros) > 0
    AND CHARINDEX(']', v.otros, CHARINDEX('id:', v.otros)) > 0
    AND CONVERT(TIME, data) < @Hora
),
FilteredData AS (
    SELECT 
        d.ExtractedValue,
        c.valor,
        c.codi,
        cl.nif,
        d.import,
        d.iva,
        cl2.Nif AS nifTienda,
        cl2.Nom AS Nom
    FROM ExtractedData d
    INNER JOIN constantsclient c ON c.valor = d.ExtractedValue AND c.variable = 'CFINAL'
    INNER JOIN clients cl ON cl.codi = c.codi
    INNER JOIN clients cl2 ON cl2.codi = d.botiga
)
SELECT 
    FilteredData.Nom AS Nom,
    cl.Nom AS NomClient,
    FilteredData.nifTienda AS NifTienda,
    FilteredData.nif AS NIF,
    FilteredData.codi AS CodigoCliente, -- Código del cliente desde ConstantsClient
    SUM(FilteredData.import) AS Importe,
    FilteredData.iva AS IVA
FROM FilteredData
INNER JOIN clients cl ON cl.nif = FilteredData.nif
GROUP BY FilteredData.Nom, FilteredData.nif, FilteredData.iva, cl.Nom, FilteredData.nifTienda, FilteredData.codi
ORDER BY FilteredData.nif, FilteredData.iva;
`;
      //console.log(sqlQT1);

      data = await this.sql.runSql(sqlQ, database);
      x = data.recordset[0];
      importTotal = 0;

      let nCliente = 1;
      let cliente = `C${nCliente}`
      salesData = {
        no: `${x.Nom}_${turno}_${formattedDate}_${cliente}`, // Nº factura
        documentType: 'Invoice', // Tipo de documento
        dueDate: `${formattedDate2}`, // Fecha vencimiento
        externalDocumentNo: `${x.Nom}_${turno}_${formattedDate}`, // Nº documento externo
        locationCode: `${x.Nom}`, // Cód. almacén
        orderDate: `${formattedDate2}`, // Fecha pedido
        personalStoreInvoice: true,
        postingDate: `${formattedDate2}`, // Fecha registro
        recapInvoice: false, // Factura recap //false
        remainingAmount: importTotal, // Precio total incluyendo IVA por factura
        sellToCustomerNo: `43000${String(x.CodigoCliente)}`,
        shift: `Shift_x0020_${turno}`, // Turno
        shipToCode: `${x.Nom.toUpperCase()}`, // Cód. dirección envío cliente
        storeInvoice: true, // Factura tienda
        vatRegistrationNo: `${x.NIF}`, // CIF/NIF
        invoiceStartDate: `${formattedDate2}`, // Fecha inicio facturación
        invoiceEndDate: `${formattedDate2}`, // Fecha fin facturación
        salesLinesBuffer: [] // Array vacío para las líneas de ventas
      };

      let NifAnterior = x.NIF;
      for (let i = 0; i < data.recordset.length; i++) {
        x = data.recordset[i];
        if (x.NIF != NifAnterior) {
          //console.log("NIF DIFENRETE\nSubiendo factura")
          // console.log(`salesData Number: ${salesData.no}`)
          url1 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/salesHeadersBuffer?$filter=no eq '${salesData.no}'`;
          resGet1 = await axios
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
          //Si el NifActual es diferente al Nif anterior tengo que primero. subo la factura actual, segundo. vacio el array de mi diccionario y cambio el "vatRegistrationNo" por el nuevo nif. Y repetir el proceso

          salesData.salesLinesBuffer = [];
          salesData.vatRegistrationNo = x.NIF;
          salesData.sellToCustomerNo = `43000${String(x.CodigoCliente)}`;
          nCliente++;
          cliente = `C${nCliente}`
          salesData.no = `${x.Nom}_${turno}_${formattedDate}_${cliente}`
          importTotal = 0;
          salesData.remainingAmount = importTotal;
        }
        let salesLine = {
          documentNo: `${salesData.no}`,
          type: `G_x002F_L_x0020_Account`,
          no: `7000001`,
          lineNo: i + 1,
          //description: `${x.producte}`,
          quantity: 1,
          lineTotalAmount: parseFloat(x.Importe),
          vatProdPostingGroup: `IVA${x.IVA}`
        };
        salesData.salesLinesBuffer.push(salesLine);
        salesData.remainingAmount += parseFloat(x.Importe);
        NifAnterior = x.NIF
      }
      // ºconsole.log(`salesData Number: ${salesData.no}`)
      url1 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/salesHeadersBuffer?$filter=no eq '${salesData.no}'`;
      resGet1 = await axios
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
      //console.log(salesData)
    }
    //Turno 2
    sqlQ = `
    DECLARE @Botiga INT = ${botiga};
    DECLARE @Dia INT = ${day};
    DECLARE @Hora TIME = '${formattedHora}';
    
    ;WITH ExtractedData AS (
        SELECT 
            SUBSTRING(v.otros, CHARINDEX('id:', v.otros) + 3, CHARINDEX(']', v.otros, CHARINDEX('id:', v.otros)) - (CHARINDEX('id:', v.otros) + 3)) AS ExtractedValue,
            v.import,
            i.iva,
        v.Botiga
        FROM [v_venut_${year}-${month}] v
        LEFT JOIN articles a ON v.plu = a.codi
        LEFT JOIN TipusIva2012 i ON a.TipoIva = i.Tipus
        WHERE num_tick IN (
            SELECT 
                SUBSTRING(motiu, CHARINDEX(':', motiu) + 2, LEN(motiu)) AS Numero
            FROM [v_moviments_${year}-${month}]
            WHERE botiga = @Botiga
              AND DAY(data) = @Dia
              AND CONVERT(TIME, data) > @Hora
              AND motiu LIKE 'Deute client%'
        )
        AND CHARINDEX('id:', v.otros) > 0
        AND CHARINDEX(']', v.otros, CHARINDEX('id:', v.otros)) > 0
        AND CONVERT(TIME, data) > @Hora
    ),
    FilteredData AS (
        SELECT 
            d.ExtractedValue,
            c.valor,
            c.codi,
            cl.nif,
            d.import,
            d.iva,
        cl2.Nif as nifTienda,
        cl2.Nom as Nom
        FROM ExtractedData d
        INNER JOIN constantsclient c ON c.valor = d.ExtractedValue 
        INNER JOIN clients cl ON cl.codi = c.codi
      INNER JOIN clients cl2 ON cl2.codi = d.botiga
    )
    SELECT 
      FilteredData.Nom AS Nom,
      FilteredData.nifTienda AS NifTienda,
      FilteredData.iva AS IVA,
      SUM(FilteredData.import) AS Importe
    FROM FilteredData
    GROUP BY FilteredData.Nom, FilteredData.nifTienda, FilteredData.iva
    ORDER BY FilteredData.iva, FilteredData.nifTienda;
    `;
    //console.log(sqlQT1);

    data = await this.sql.runSql(sqlQ, database);
    if (data.recordset.length > 0) {
      let x = data.recordset[0];
      let shortYear = year.slice(-2);

      let formattedDay = day.padStart(2, '0');
      let formattedMonth = month.padStart(2, '0');
      // Formateamos la fecha en el formato ddmmyy
      let formattedDate = `${formattedDay}-${formattedMonth}-${shortYear}`;
      let formattedDate2 = new Date(queryHora.recordset[0].data).toISOString().substring(0, 10);
      let turno = 2

      let salesData = {
        no: `${x.Nom}_${turno}_${formattedDate}`, // Nº factura
        documentType: 'Credit_x0020_Memo', // Tipo de documento
        dueDate: `${formattedDate2}`, // Fecha vencimiento
        externalDocumentNo: `${x.Nom}_${turno}_${formattedDate}`, // Nº documento externo
        locationCode: `${x.Nom}`, // Cód. almacén
        orderDate: `${formattedDate2}`, // Fecha pedido
        personalStoreInvoice: true,
        postingDate: `${formattedDate2}`, // Fecha registro
        recapInvoice: false, // Factura recap //false
        remainingAmount: importTotal, // Precio total incluyendo IVA por factura
        sellToCustomerNo: "430001314",
        shift: `Shift_x0020_${turno}`, // Turno
        shipToCode: `${x.Nom.toUpperCase()}`, // Cód. dirección envío cliente
        storeInvoice: true, // Factura tienda
        vatRegistrationNo: `${x.NifTienda}`, // CIF/NIF
        invoiceStartDate: `${formattedDate2}`, // Fecha inicio facturación
        invoiceEndDate: `${formattedDate2}`, // Fecha fin facturación
        salesLinesBuffer: [] // Array vacío para las líneas de ventas
      };

      for (let i = 0; i < data.recordset.length; i++) {
        x = data.recordset[i];
        let salesLine = {
          documentNo: `${salesData.no}`,
          type: `G_x002F_L_x0020_Account`,
          no: `7000001`,
          lineNo: i + 1,
          //description: `${x.producte}`,
          quantity: 1,
          lineTotalAmount: parseFloat(x.Importe),
          vatProdPostingGroup: `IVA${x.IVA}`
        };
        importTotal += parseFloat(x.Importe)
        salesData.salesLinesBuffer.push(salesLine);
      }
      salesData.remainingAmount = importTotal;


      //console.log(salesData)
      let url1 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/salesHeadersBuffer?$filter=no eq '${salesData.no}' and documentType eq '${salesData.documentType}'`;
      //console.log(url1);
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
          console.log('Abono subido con exito');
        } catch (error) {
          console.error('Error posting sales abono data:', error.response?.data || error.message);
        }

      }
      else {
        console.log(`Ya existe el abono ${salesData.no}`)
      }

      //Facturas Turno 2

      sqlQ = `
      DECLARE @Botiga INT = ${botiga};
      DECLARE @Dia INT = ${day};
      DECLARE @Hora TIME = '${formattedHora}';
    
      ;WITH ExtractedData AS (
        SELECT 
            SUBSTRING(v.otros, CHARINDEX('id:', v.otros) + 3, CHARINDEX(']', v.otros, CHARINDEX('id:', v.otros)) - (CHARINDEX('id:', v.otros) + 3)) AS ExtractedValue,
            v.import,
            i.iva,
        v.Botiga
        FROM [v_venut_${year}-${month}] v
        LEFT JOIN articles a ON v.plu = a.codi
        LEFT JOIN TipusIva2012 i ON a.TipoIva = i.Tipus
        WHERE num_tick IN (
            SELECT 
                SUBSTRING(motiu, CHARINDEX(':', motiu) + 2, LEN(motiu)) AS Numero
            FROM [v_moviments_${year}-${month}]
            WHERE botiga = @Botiga
              AND DAY(data) = @Dia
              AND CONVERT(TIME, data) > @Hora
              AND motiu LIKE 'Deute client%'
        )
        AND CHARINDEX('id:', v.otros) > 0
        AND CHARINDEX(']', v.otros, CHARINDEX('id:', v.otros)) > 0
        AND CONVERT(TIME, data) > @Hora
      ),
      FilteredData AS (
        SELECT 
            d.ExtractedValue,
            c.valor,
            c.codi,
            cl.nif,
            d.import,
            d.iva,
            cl2.Nif AS nifTienda,
            cl2.Nom AS Nom
        FROM ExtractedData d
        INNER JOIN constantsclient c ON c.valor = d.ExtractedValue AND c.variable = 'CFINAL'
        INNER JOIN clients cl ON cl.codi = c.codi
        INNER JOIN clients cl2 ON cl2.codi = d.botiga
      )
      SELECT 
        FilteredData.Nom AS Nom,
        cl.Nom AS NomClient,
        FilteredData.nifTienda AS NifTienda,
        FilteredData.nif AS NIF,
        FilteredData.codi AS CodigoCliente, -- Código del cliente desde ConstantsClient
        SUM(FilteredData.import) AS Importe,
        FilteredData.iva AS IVA
      FROM FilteredData
      INNER JOIN clients cl ON cl.nif = FilteredData.nif
      GROUP BY FilteredData.Nom, FilteredData.nif, FilteredData.iva, cl.Nom, FilteredData.nifTienda, FilteredData.codi
      ORDER BY FilteredData.nif, FilteredData.iva;
      `;
      //console.log(sqlQT1);

      data = await this.sql.runSql(sqlQ, database);
      x = data.recordset[0];
      importTotal = 0;

      let nCliente = 1;
      let cliente = `C${nCliente}`
      salesData = {
        no: `${x.Nom}_${turno}_${formattedDate}_${cliente}`, // Nº factura
        documentType: 'Invoice', // Tipo de documento
        dueDate: `${formattedDate2}`, // Fecha vencimiento
        externalDocumentNo: `${x.Nom}_${turno}_${formattedDate}`, // Nº documento externo
        locationCode: `${x.Nom}`, // Cód. almacén
        orderDate: `${formattedDate2}`, // Fecha pedido
        personalStoreInvoice: true,
        postingDate: `${formattedDate2}`, // Fecha registro
        recapInvoice: false, // Factura recap //false
        remainingAmount: importTotal, // Precio total incluyendo IVA por factura
        sellToCustomerNo: `43000${String(x.CodigoCliente)}`,
        shift: `Shift_x0020_${turno}`, // Turno
        shipToCode: `${x.Nom.toUpperCase()}`, // Cód. dirección envío cliente
        storeInvoice: true, // Factura tienda
        vatRegistrationNo: `${x.NIF}`, // CIF/NIF
        invoiceStartDate: `${formattedDate2}`, // Fecha inicio facturación
        invoiceEndDate: `${formattedDate2}`, // Fecha fin facturación
        salesLinesBuffer: [] // Array vacío para las líneas de ventas
      };

      let NifAnterior = x.NIF;
      for (let i = 0; i < data.recordset.length; i++) {
        x = data.recordset[i];
        if (x.NIF != NifAnterior) {
          // console.log("NIF DIFENRETE\nSubiendo factura")
          // console.log(`salesData Number: ${salesData.no}`)
          url1 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/salesHeadersBuffer?$filter=no eq '${salesData.no}'`;
          resGet1 = await axios
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
          //Si el NifActual es diferente al Nif anterior tengo que primero. subo la factura actual, segundo. vacio el array de mi diccionario y cambio el "vatRegistrationNo" por el nuevo nif. Y repetir el proceso

          salesData.salesLinesBuffer = [];
          salesData.vatRegistrationNo = x.NIF;
          salesData.sellToCustomerNo = `43000${String(x.CodigoCliente)}`;
          nCliente++;
          cliente = `C${nCliente}`
          salesData.no = `${x.Nom}_${turno}_${formattedDate}_${cliente}`
          importTotal = 0;
          salesData.remainingAmount = importTotal;
        }
        let salesLine = {
          documentNo: `${salesData.no}`,
          type: `G_x002F_L_x0020_Account`,
          no: `7000001`,
          lineNo: i + 1,
          //description: `${x.producte}`,
          quantity: 1,
          lineTotalAmount: parseFloat(x.Importe),
          vatProdPostingGroup: `IVA${x.IVA}`
        };
        salesData.salesLinesBuffer.push(salesLine);
        salesData.remainingAmount += parseFloat(x.Importe);
        NifAnterior = x.NIF
      }
      // console.log(`salesData Number: ${salesData.no}`)
      url1 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/salesHeadersBuffer?$filter=no eq '${salesData.no}'`;
      resGet1 = await axios
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
    }

    return true
  }


  async syncSalesSilemaRecapitulativa(client, tienda, dayStart, dayEnd, month, year, companyID, database, botiga, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    let importTotal: number = 0;

    let sqlQ = `
DECLARE @Cliente INT = ${client};
DECLARE @Inicio INT = ${dayStart};
DECLARE @Fin INT = ${dayEnd};

select v.num_tick as TICKET, V.PLU AS PLU,a.nom as ARTICULO, V.Quantitat AS CANTIDAD, v.data as FECHA, V.Import AS PRECIO, CONCAT('IVA',i.Iva) as IVA, cb.nom as TIENDA, C.NIF AS NIF, SUM(v.Import) OVER () AS TOTAL 
from [v_venut_${year}-${month}] v
left join articles a on a.codi=v.plu
left join TipusIva i on i.Tipus=a.TipoIva
left join ConstantsClient cc on @Cliente= cc.Codi and variable='CFINAL'
left join Clients c on cc.codi=c.codi
left join clients cb on v.botiga=cb.codi
where v.otros like '%' + cc.valor + '%' and day(data) between @inicio and @fin and cb.nom='${tienda}'
GROUP BY V.Num_tick,v.plu,a.nom,v.Quantitat, v.data,v.import,i.iva,cb.nom,c.nif
order by v.data`;
    //console.log(sqlQT1);

    let data = await this.sql.runSql(sqlQ, database);
    let x = data.recordset[0];
    let shortYear = year.slice(-2);

    // Formateamos las fechas
    let formattedDate = `${dayEnd}-${month}-${shortYear}`;
    let formattedDateDayStart = new Date(`${year}-${month}-${dayStart}`).toISOString().substring(0, 10);
    let formattedDateDayEnd = new Date(`${year}-${month}-${dayEnd}`).toISOString().substring(0, 10);

    // Calculamos `n` basado en las facturas recapitulativas existentes
    let url = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/salesHeadersBuffer?$filter=contains(no,'${x.TIENDA}_') and contains(no,'_R') and postingDate ge ${formattedDateDayStart} and postingDate le ${formattedDateDayEnd}`;
    let n = 1; // Valor por defecto si no hay facturas recapitulativas

    try {
      // Obtenemos las facturas filtradas desde Business Central
      let resGet = await axios.get(
        url, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      });

      // Filtramos específicamente las recapitulativas para esta tienda y fecha
      let recapInvoices = resGet.data.value.filter((invoice: any) => {
        // Verificamos si el nombre de la factura coincide con el patrón de recapitulativa
        let match = invoice.no.match(`${x.TIENDA}_${formattedDate}_R(\\d+)$`);
        return match !== null; // Solo incluimos facturas que terminen con "R{n}"
      });

      // Determinamos `n` basado en el total de facturas recapitulativas encontradas
      n = recapInvoices.length + 1;
      console.log(`Número de facturas recapitulativas existentes: ${recapInvoices.length}. Usando número: ${n}`);
    } catch (error) {
      console.error(`Error al obtener las facturas recapitulativas:`, error);
      // Dejamos `n = 1` como valor por defecto
    }

    let salesData = {
      no: `${x.TIENDA}_${formattedDate}_R${n}`, // Nº factura
      documentType: 'Invoice', // Tipo de documento
      dueDate: `${formattedDateDayEnd}`, // Fecha vencimiento
      externalDocumentNo: `${x.TIENDA}_${formattedDate}_R${n}`, // Nº documento externo
      locationCode: `${x.TIENDA}`, // Cód. almacén
      orderDate: `${formattedDateDayEnd}`, // Fecha pedido
      postingDate: `${formattedDateDayEnd}`, // Fecha registro
      recapInvoice: true, // Factura recap //false
      remainingAmount: importTotal, // Precio total incluyendo IVA por factura
      sellToCustomerNo: "430004431",
      shipToCode: `${x.TIENDA.toUpperCase()}`, // Cód. dirección envío cliente
      storeInvoice: true, // Factura tienda
      vatRegistrationNo: `${x.NIF}`, // CIF/NIF
      invoiceStartDate: `${formattedDateDayStart}`, // Fecha inicio facturación
      invoiceEndDate: `${formattedDateDayEnd}`, // Fecha fin facturación
      salesLinesBuffer: [] // Array vacío para las líneas de ventas
    };

    let countLines = 1;
    for (let i = 0; i < data.recordset.length; i++) {
      x = data.recordset[i];
      let date = new Date(x.FECHA);
      let day = date.getDate().toString().padStart(2, '0'); // Asegura dos dígitos
      let month = (date.getMonth() + 1).toString().padStart(2, '0'); // Meses van de 0 a 11
      let shortYear = date.getFullYear().toString().slice(-2); // Obtiene los últimos dos dígitos del año
      let isoDate = date.toISOString().substring(0, 10);
      let formattedDateAlbaran = `${day}/${month}/${shortYear}`;
      let salesLineAlbaran = {
        documentNo: `${salesData.no}`,
        lineNo: 0,
        description: `albaran nº ${x.TICKET} ${formattedDateAlbaran}`,
        quantity: 1,
        shipmentDate: `${isoDate}`,
        lineTotalAmount: 0,
      };
      countLines++
      salesData.salesLinesBuffer.push(salesLineAlbaran);
      let salesLine = {
        documentNo: `${salesData.no}`,
        type: `Item`,
        no: `${x.PLU}`,
        lineNo: countLines,
        description: `${x.ARTICULO}`,
        quantity: parseFloat(x.CANTIDAD),
        shipmentDate: `${isoDate}`,
        lineTotalAmount: parseFloat(x.PRECIO),
        vatProdPostingGroup: `${x.IVA}`
      };
      countLines++
      importTotal += parseFloat(x.PRECIO)
      salesData.salesLinesBuffer.push(salesLine);
    }
    salesData.remainingAmount = importTotal;
    //console.log(salesData)

    let url1 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/salesHeadersBuffer?$filter=no eq '${salesData.no}' and documentType eq '${salesData.documentType}'`;
    //console.log(url1);
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
        console.log('Abono subido con exito');
      } catch (error) {
        console.error('Error posting sales recapitulativa data:', error.response?.data || error.message);
      }

    }
    else {
      console.log(`Ya existe la recapitulativa ${salesData.no}`)
    }

    //Abono recap
    sqlQ = `
DECLARE @Cliente INT = ${client};
DECLARE @Inicio INT = ${dayStart};
DECLARE @Fin INT = ${dayEnd};
                
SELECT V.PLU AS PLU, A.nom AS ARTICULO, SUM(V.Quantitat) AS CANTIDAD_TOTAL, SUM(V.Import) AS IMPORTE_TOTAL, MIN(V.data) AS FECHA_PRIMERA_VENTA, MAX(V.data) AS FECHA_ULTIMA_VENTA, CONCAT('IVA', I.Iva) AS IVA, CB.nom AS TIENDA, C.NIF AS NIF
FROM [v_venut_${year}-${month}] V
LEFT JOIN articles A ON A.codi = V.plu
LEFT JOIN TipusIva I ON I.Tipus = A.TipoIva
LEFT JOIN ConstantsClient CC ON @Cliente = CC.Codi AND variable = 'CFINAL' 
LEFT JOIN Clients C ON CC.codi = C.codi
LEFT JOIN clients CB ON V.botiga = CB.codi
WHERE V.otros LIKE '%' + CC.valor + '%' AND DAY(data) BETWEEN @Inicio and @fin and cb.nom='${tienda}'
GROUP BY V.PLU, A.nom, CONCAT('IVA', I.Iva), CB.nom, C.NIF
ORDER BY MIN(V.data);`;
    //console.log(sqlQT1);

    data = await this.sql.runSql(sqlQ, database);
    x = data.recordset[0];
    shortYear = year.slice(-2);

    // Formateamos la fecha en el formato ddmmyy
    formattedDate = `${dayEnd}-${month}-${shortYear}`;
    formattedDateDayStart = new Date(`${year}-${month}-${dayStart}`).toISOString().substring(0, 10);
    formattedDateDayEnd = new Date(`${year}-${month}-${dayEnd}`).toISOString().substring(0, 10);
    importTotal = 0;
    salesData = {
      no: `${x.TIENDA}_${formattedDate}_A${n}`, // Nº factura
      documentType: 'Credit_x0020_Memo', // Tipo de documento
      dueDate: `${formattedDateDayEnd}`, // Fecha vencimiento
      externalDocumentNo: `${x.TIENDA}_${formattedDate}_A${n}`, // Nº documento externo
      locationCode: `${x.TIENDA}`, // Cód. almacén
      orderDate: `${formattedDateDayEnd}`, // Fecha pedido
      postingDate: `${formattedDateDayEnd}`, // Fecha registro
      recapInvoice: true, // Factura recap //false
      remainingAmount: importTotal, // Precio total incluyendo IVA por factura
      sellToCustomerNo: "430004431",
      shipToCode: `${x.TIENDA.toUpperCase()}`, // Cód. dirección envío cliente
      storeInvoice: true, // Factura tienda
      vatRegistrationNo: `${x.NIF}`, // CIF/NIF
      invoiceStartDate: `${formattedDateDayStart}`, // Fecha inicio facturación
      invoiceEndDate: `${formattedDateDayEnd}`, // Fecha fin facturación
      salesLinesBuffer: [] // Array vacío para las líneas de ventas
    };
    countLines = 1;
    for (let i = 0; i < data.recordset.length; i++) {
      x = data.recordset[i];
      let date = new Date(x.FECHA_PRIMERA_VENTA);
      let isoDate = date.toISOString().substring(0, 10);
      let salesLine = {
        documentNo: `${salesData.no}`,
        type: `Item`,
        no: `${x.PLU}`,
        lineNo: countLines,
        description: `${x.ARTICULO}`,
        quantity: parseFloat(x.CANTIDAD_TOTAL),
        shipmentDate: `${isoDate}`,
        lineTotalAmount: parseFloat(x.IMPORTE_TOTAL),
        vatProdPostingGroup: `${x.IVA}`
      };
      countLines++

      importTotal += parseFloat(x.IMPORTE_TOTAL)
      salesData.salesLinesBuffer.push(salesLine);
    }
    salesData.remainingAmount = importTotal;
    //console.log(salesData)

    url1 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/salesHeadersBuffer?$filter=no eq '${salesData.no}' and documentType eq '${salesData.documentType}'`;
    //console.log(url1);
    resGet1 = await axios
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
        console.log('Abono recap subido con exito');
      } catch (error) {
        console.error('Error posting sales recapitulativa data:', error.response?.data || error.message);
      }

    }
    else {
      console.log(`Ya existe el abono recapitulativa ${salesData.no}`)
    }

    return true;
  }
}