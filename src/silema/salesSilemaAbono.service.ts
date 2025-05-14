import { Injectable } from '@nestjs/common';
import { getTokenService } from '../connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConection.service';
import axios from 'axios';

@Injectable()
export class salesSilemaAbonoService {
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) {}

  //Abono
  async syncSalesSilemaAbono(day, month, year, companyID, database, botiga, turno, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    let tipo = 'syncSalesSilemaAbono';
    let sqlQFranquicia = `SELECT * FROM constantsClient WHERE Codi = ${botiga} and Variable = 'Franquicia'`;
    let queryFranquicia = await this.sql.runSql(sqlQFranquicia, database);
    if (queryFranquicia.recordset.length >= 1) return;

    let sqlTurnos = `
    SELECT CONVERT(Time, Data) as hora, Tipus_moviment 
    FROM [V_Moviments_${year}-${month}] 
    WHERE botiga = ${botiga} AND Tipus_moviment IN ('Wi', 'W') AND DAY(Data) = ${day} 
    GROUP BY Data, Tipus_moviment 
    ORDER BY Data
    `;
    let queryTurnos = await this.sql.runSql(sqlTurnos, database);
    let records = queryTurnos.recordset;
    if (records.length === 0) return;

    let turnos: { horaInicio: Date; horaFin: Date }[] = [];
    let currentTurn: { horaInicio?: Date } = {};

    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const horaDate = new Date(row.hora);

      if (row.Tipus_moviment === 'Wi') {
        currentTurn = { horaInicio: horaDate };
      } else if (row.Tipus_moviment === 'W' && currentTurn.horaInicio) {
        turnos.push({ horaInicio: currentTurn.horaInicio, horaFin: horaDate });
        currentTurn = {};
      }
    }
    let turnosAEnviar = [];
    if (Number(turno) === 1 && turnos.length >= 1) {
      // Solo el primer turno
      turnosAEnviar = [turnos[0]];
    } else if (Number(turno) === 2 && turnos.length > 1) {
      // El resto de turnos (2 en adelante)
      turnosAEnviar = turnos.slice(1);
    } else {
      // Por defecto, enviar todos
      turnosAEnviar = turnos;
    }
    for (let i = 0; i < turnosAEnviar.length; i++) {
      const { horaInicio, horaFin } = turnosAEnviar[i];
      const formattedHoraInicio = `${String(horaInicio.getUTCHours()).padStart(2, '0')}:${String(horaInicio.getUTCMinutes()).padStart(2, '0')}:${String(horaInicio.getUTCSeconds()).padStart(2, '0')}`;
      const formattedHoraFin = `${String(horaFin.getUTCHours()).padStart(2, '0')}:${String(horaFin.getUTCMinutes()).padStart(2, '0')}:${String(horaFin.getUTCSeconds()).padStart(2, '0')}`;
      console.log(`Turno ${i + (Number(turno) === 2 ? 2 : 1)}: ${formattedHoraInicio} - ${formattedHoraFin}`);
      const sqlCheckZ = `
      SELECT TOP 1 Import 
      FROM [V_Moviments_${year}-${month}]
      WHERE botiga = ${botiga}
      AND Tipus_moviment = 'Z'
      AND DAY(Data) = ${day}
      AND CONVERT(Time, Data) BETWEEN '${formattedHoraInicio}' AND '${formattedHoraFin}'
      AND Import > 0
     `;
      const resultZ = await this.sql.runSql(sqlCheckZ, database);
      if (resultZ.recordset.length === 0) {
        console.log(`Turno ${i + (Number(turno) === 2 ? 2 : 1)} omitido por cierre Z con importe 0 o inexistente`);
        continue;
      }

      await this.processTurnoSalesSilemaAbono(i + (Number(turno) === 2 ? 2 : 1), botiga, day, month, year, formattedHoraInicio, formattedHoraFin, database, tipo, tenant, entorno, companyID, token);
    }
    return true;
  }

  private getSQLQuerySalesSilemaAbono(botiga: number, day: number, month: number, year: number, horaInicio: string, horaFin: string, sqlAbono: boolean) {
    if (sqlAbono) {
      return `
      DECLARE @Botiga INT = ${botiga};
      DECLARE @Dia INT = ${day};
      DECLARE @HoraInicio TIME = '${horaInicio}';
      DECLARE @HoraFin TIME = '${horaFin}';

      ;WITH ExtractedData AS (
          SELECT 
              SUBSTRING(v.otros, CHARINDEX('id:', v.otros) + 3, CHARINDEX(']', v.otros, CHARINDEX('id:', v.otros)) - (CHARINDEX('id:', v.otros) + 3)) AS ExtractedValue,
              v.import,
              i.iva,
              v.Botiga,
			        CAST(v.data AS DATE) AS Fecha
          FROM [v_venut_${year}-${month}] v
          LEFT JOIN articles a ON v.plu = a.codi
          LEFT JOIN TipusIva2012 i ON a.TipoIva = i.Tipus
          WHERE num_tick IN (
              SELECT 
                  SUBSTRING(motiu, CHARINDEX(':', motiu) + 2, LEN(motiu)) AS Numero
              FROM [v_moviments_${year}-${month}]
              WHERE botiga = @Botiga
                AND DAY(data) = @Dia
                AND CONVERT(TIME, Data) BETWEEN @HoraInicio AND @HoraFin
                AND motiu LIKE 'Deute client%'
          )
          AND CHARINDEX('id:', v.otros) > 0
          AND CHARINDEX(']', v.otros, CHARINDEX('id:', v.otros)) > 0
          AND CONVERT(TIME, Data) BETWEEN @HoraInicio AND @HoraFin
          AND LEN(SUBSTRING(v.otros, CHARINDEX('id:', v.otros) + 3, 
          CHARINDEX(']', v.otros, CHARINDEX('id:', v.otros)) - (CHARINDEX('id:', v.otros) + 3))) > 0
          AND botiga = @Botiga
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
              cl2.Nom as Nom,
			        d.Fecha
          FROM ExtractedData d
          INNER JOIN constantsclient c ON c.valor = d.ExtractedValue 
          INNER JOIN clients cl ON cl.codi = c.codi
          INNER JOIN clients cl2 ON cl2.codi = d.botiga
      )
      ,
      Aggregated AS (
          SELECT
              fd.Nom,
              LTRIM(RTRIM(fd.nifTienda)) AS NifTienda,
              fd.iva AS IVA,
              SUM(fd.import) AS Importe,
              fd.Fecha
          FROM   FilteredData fd
          GROUP  BY
              fd.Nom,
              LTRIM(RTRIM(fd.nifTienda)),
              fd.iva,
			        fd.Fecha
      ),

      Totals AS (                               
          SELECT
              SUM(import) AS TotalAmbIVA,
              SUM(import / (1 + iva / 100.0)) AS TotalSenseIVA
          FROM   FilteredData
      )

      SELECT
          a.Nom,
          a.NifTienda,
          a.IVA,
          a.Importe,
          Round(t.TotalAmbIVA,2) as TotalAmbIVA,
          Round(t.TotalSenseIVA,2) as TotalSenseIVA,
          a.Fecha as Data
      FROM   Aggregated a
      CROSS  JOIN Totals t
      ORDER  BY
          a.IVA,
          a.NifTienda;`;
    } else {
      return `
      DECLARE @Botiga INT = ${botiga};
      DECLARE @Dia INT = ${day};
      DECLARE @HoraInicio TIME = '${horaInicio}';
      DECLARE @HoraFin TIME = '${horaFin}';

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
                AND CONVERT(TIME, Data) BETWEEN @HoraInicio AND @HoraFin
                AND motiu LIKE 'Deute client%'
          )
          AND CHARINDEX('id:', v.otros) > 0
          AND CHARINDEX(']', v.otros, CHARINDEX('id:', v.otros)) > 0
          AND CONVERT(TIME, Data) BETWEEN @HoraInicio AND @HoraFin
          AND LEN(SUBSTRING(v.otros, CHARINDEX('id:', v.otros) + 3, 
          CHARINDEX(']', v.otros, CHARINDEX('id:', v.otros)) - (CHARINDEX('id:', v.otros) + 3))) > 0
          AND botiga = @Botiga
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
      ),
      Totals AS (
          SELECT
              SUM(import) AS TotalAmbIVA,
              SUM(import / (1 + iva / 100.0)) AS TotalSenseIVA
          FROM   FilteredData
      )

      SELECT
          a.Nom,
          a.NomClient,
          a.NifTienda,
          a.NIF,
          a.CodigoCliente,
          a.Importe,        
          a.IVA,
          Round(t.TotalAmbIVA,2) as TotalAmbIVA,
          Round(t.TotalSenseIVA,2) as TotalSenseIVA
      FROM (
          SELECT
              fd.Nom AS Nom,
              LTRIM(RTRIM(cl.Nom)) AS NomClient,
              LTRIM(RTRIM(fd.nifTienda)) AS NifTienda,
              LTRIM(RTRIM(fd.nif)) AS NIF,
              fd.codi AS CodigoCliente,
              SUM(fd.import) AS Importe,
              fd.iva AS IVA
          FROM   FilteredData fd
          INNER  JOIN clients cl
                ON LTRIM(RTRIM(cl.nif)) = LTRIM(RTRIM(fd.nif))
          GROUP  BY
              fd.Nom,
              LTRIM(RTRIM(cl.Nom)),
              LTRIM(RTRIM(fd.nifTienda)),
              LTRIM(RTRIM(fd.nif)),
              fd.codi,
              fd.iva
      ) a
      CROSS JOIN Totals t
      ORDER BY
          a.NIF,
          a.IVA;`;
    }
  }

  async processTurnoSalesSilemaAbono(turno, botiga, day, month, year, horaInicio, horaFin, database, tipo, tenant, entorno, companyID, token) {
    //Abono
    let sqlQ = this.getSQLQuerySalesSilemaAbono(botiga, day, month, year, horaInicio, horaFin, true);
    let importAmount = 0;

    let data = await this.sql.runSql(sqlQ, database);
    //console.log("Data lenght: " + data.recordset.length)
    //console.log(sqlQ);
    if (data.recordset.length > 0) {
      let x = data.recordset[0];
      let shortYear = year.slice(-2);

      let formattedDay = day.padStart(2, '0');
      let formattedMonth = month.padStart(2, '0');
      // Formateamos la fecha en el formato ddmmyy
      let formattedDate = `${formattedDay}-${formattedMonth}-${shortYear}`;
      let formattedDate2 = new Date(x.Data).toISOString().substring(0, 10);
      let sellToCustomerNo = '';
      if (x.NifTienda == 'B61957189') {
        sellToCustomerNo = '430001314';
      }
      x.Nom = x.Nom.substring(0, 6);
      let salesData = {
        no: `${x.Nom}_${turno}_${formattedDate}`, // Nº factura
        documentType: 'Credit_x0020_Memo', // Tipo de documento
        dueDate: `${formattedDate2}`, // Fecha vencimiento
        externalDocumentNo: `${x.Nom}_${turno}_${formattedDate}`, // Nº documento externo
        locationCode: `${this.extractNumber(x.Nom)}`, // Cód. almacén
        orderDate: `${formattedDate2}`, // Fecha pedido
        personalStoreInvoice: true,
        postingDate: `${formattedDate2}`, // Fecha registro
        recapInvoice: false, // Factura recap //false
        remainingAmount: parseFloat(x.TotalAmbIVA.toFixed(2)), // Precio total incluyendo IVA por factura
        amountExclVat: parseFloat(x.TotalSenseIVA.toFixed(2)), // Precio total sin IVA por factura
        sellToCustomerNo: `${sellToCustomerNo}`, // COSO
        shift: `Shift_x0020_${turno}`, // Turno
        shipToCode: `${this.extractNumber(x.Nom).toUpperCase()}`, // Cód. dirección envío cliente
        storeInvoice: true, // Factura tienda
        vatRegistrationNo: `${x.NifTienda}`, // CIF/NIF
        invoiceStartDate: `${formattedDate2}`, // Fecha inicio facturación
        invoiceEndDate: `${formattedDate2}`, // Fecha fin facturación
        salesLinesBuffer: [], // Array vacío para las líneas de ventas
      };
      for (let i = 0; i < data.recordset.length; i++) {
        x = data.recordset[i];
        x.IVA = `IVA${String(x.IVA).replace(/\D/g, '').padStart(2, '0')}`;
        if (x.IVA === 'IVA00') x.IVA = 'IVA0';
        let salesLine = {
          documentNo: `${salesData.no}`,
          type: `G_x002F_L_x0020_Account`,
          no: `700000000`,
          lineNo: i + 1,
          //description: `${x.producte}`,
          quantity: 1,
          lineTotalAmount: parseFloat(x.Importe),
          vatProdPostingGroup: `${x.IVA}`,
          unitPrice: parseFloat(x.Importe),
          locationCode: `${this.extractNumber(x.Nom)}`,
        };
        importAmount += parseFloat(x.Importe);
        salesData.salesLinesBuffer.push(salesLine);
      }

      // console.log(salesData);
      await this.postToApi(tipo, salesData, tenant, entorno, companyID, token);

      //Facturas
      sqlQ = this.getSQLQuerySalesSilemaAbono(botiga, day, month, year, horaInicio, horaFin, false);
      //console.log(sqlQT1);

      data = await this.sql.runSql(sqlQ, database);
      x = data.recordset[0];
      importAmount = 0;
      sellToCustomerNo = '';
      x.Nom = x.Nom.substring(0, 6);
      let nCliente = 1;
      let cliente = `C${nCliente}`;
      salesData = {
        no: `${x.Nom}_${turno}_${formattedDate}_${cliente}`, // Nº factura
        documentType: 'Invoice', // Tipo de documento
        dueDate: `${formattedDate2}`, // Fecha vencimiento
        externalDocumentNo: `${x.Nom}_${turno}_${formattedDate}_${cliente}`, // Nº documento externo
        locationCode: `${this.extractNumber(x.Nom)}`, // Cód. almacén
        orderDate: `${formattedDate2}`, // Fecha pedido
        personalStoreInvoice: true,
        postingDate: `${formattedDate2}`, // Fecha registro
        recapInvoice: false, // Factura recap //false
        remainingAmount: parseFloat(x.TotalAmbIVA.toFixed(2)), // Precio total incluyendo IVA por factura
        amountExclVat: parseFloat(x.TotalSenseIVA.toFixed(2)), // Precio total sin IVA por factura
        sellToCustomerNo: `${sellToCustomerNo}`, // COSO
        shift: `Shift_x0020_${turno}`, // Turno
        shipToCode: `${this.extractNumber(x.Nom).toUpperCase()}`, // Cód. dirección envío cliente
        storeInvoice: true, // Factura tienda
        vatRegistrationNo: `${x.NIF}`, // CIF/NIF
        invoiceStartDate: `${formattedDate2}`, // Fecha inicio facturación
        invoiceEndDate: `${formattedDate2}`, // Fecha fin facturación
        salesLinesBuffer: [], // Array vacío para las líneas de ventas
      };

      let NifAnterior = x.NIF;
      for (let i = 0; i < data.recordset.length; i++) {
        x = data.recordset[i];
        if (x.NIF != NifAnterior) {
          //console.log("NIF DIFENRETE\nSubiendo factura")
          // console.log(`salesData Number: ${salesData.no}`);
          await this.postToApi(tipo, salesData, tenant, entorno, companyID, token);
          //Si el NifActual es diferente al Nif anterior tengo que primero. subo la factura actual, segundo. vacio el array de mi diccionario y cambio el "vatRegistrationNo" por el nuevo nif. Y repetir el proceso

          salesData.salesLinesBuffer = [];
          salesData.vatRegistrationNo = x.NIF;
          //salesData.sellToCustomerNo = `43000${String(x.CodigoCliente)}`;
          nCliente++;
          cliente = `C${nCliente}`;
          salesData.no = `${x.Nom}_${turno}_${formattedDate}_${cliente}`;
          importAmount = 0;
          salesData.remainingAmount = x.TotalAmbIVA;
          salesData.amountExclVat = x.TotalSenseIVA;
        }
        x.IVA = `IVA${String(x.IVA).replace(/\D/g, '').padStart(2, '0')}`;
        if (x.IVA === 'IVA00') x.IVA = 'IVA0';
        let salesLine = {
          documentNo: `${salesData.no}`,
          type: `G_x002F_L_x0020_Account`,
          no: `700000000`,
          lineNo: i + 1,
          //description: `${x.producte}`,
          quantity: 1,
          lineTotalAmount: parseFloat(x.Importe),
          vatProdPostingGroup: `${x.IVA}`,
          unitPrice: parseFloat(x.Importe),
          locationCode: `${this.extractNumber(x.Nom)}`,
        };
        salesData.salesLinesBuffer.push(salesLine);
        // console.log("Importe a sumar: " + x.Importe)
        NifAnterior = x.NIF;
      }
      // console.log(salesData.remainingAmount)
      // console.log(`salesData Number: ${salesData.no}`)
      await this.postToApi(tipo, salesData, tenant, entorno, companyID, token);
      // console.log(JSON.stringify(salesData, null, 2));
    }
  }

  async postToApi(tipo, salesData, tenant, entorno, companyID, token) {
    if (salesData.no.length > 20) salesData.no = salesData.no.slice(-20);
    if (salesData.locationCode.length > 10) salesData.locationCode = salesData.locationCode.slice(-10);
    if (salesData.shipToCode.length > 10) salesData.shipToCode = salesData.shipToCode.slice(-10);
    let url1 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/salesHeadersBuffer?$filter=contains(no,'${salesData.no}') and documentType eq '${salesData.documentType}'`;
    //console.log(url1);
    let resGet1 = await axios
      .get(url1, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      })
      .catch((error) => {
        console.log(`Url ERROR: ${url1}`);
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
          },
        );
        //console.log('Response:', response.data);
        console.log(`${tipo} subido con exito ${salesData.no}`);
      } catch (error) {
        salesData.salesLinesBuffer = [];
        console.log(JSON.stringify(salesData, null, 2));
        console.error(`Error posting sales ${tipo} data:`, error.response?.data || error.message);
        return;
      }
    } else {
      console.log(`Ya existe la ${tipo}: ${salesData.no}`);
    }
  }

  extractNumber(input: string): string | null {
    input = input.toUpperCase();
    const match = input.match(/[TM]--(\d{3})/);
    return match ? match[1] : null;
  }
}
