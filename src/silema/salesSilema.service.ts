import { Injectable } from '@nestjs/common';
import { getTokenService } from '../connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConection.service';
import axios from 'axios';

@Injectable()
export class salesSilemaService {
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) {}

  // Funcion que utiliza la tabla records mira donde se quedo la ultima sincronizacion y sincroniza los datos faltantes hasta el dia y hora actuales
  async syncSalesSilemaRecords(companyID, database, botiga, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let sqlRecords = `SELECT * FROM records WHERE Concepte = 'BC_Silema${botiga}'`;
    try {
      let queryRecords = await this.sql.runSql(sqlRecords, database);
      if (queryRecords.recordset.length == 0) {
        let sqlInsert = `INSERT INTO records (timestamp, concepte) SELECT MIN(TimeStamp), 'BC_Silema${botiga}' FROM incidencias;`;
        let recordsInsert = await this.sql.runSql(sqlInsert, database);
        queryRecords = await this.sql.runSql(sqlRecords, database);
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
          //await this.syncSalesSilema(day, month, year, companyID, database, botiga, client_id, client_secret, tenant, entorno);
          //await this.syncSalesSilemaAbono(day, month, year, companyID, database, botiga, client_id, client_secret, tenant, entorno);
        }

        const updateQuery: string = `UPDATE records SET timestamp = GETDATE() WHERE Concepte = 'BC_Silema${botiga}';`;
        await this.sql.runSql(updateQuery, database);
      } else {
        console.log('La fecha de la base de datos es en el futuro.');
      }
    } catch (error) {
      throw new Error('Error');
    }
    return true;
  }

  // Funcion que pasandole un dia de inicio y otro de fin sincroniza los datos de ventas de silema
  async syncSalesSilemaDate(dayStart, dayEnd, month, year, companyID, database, botigas: Array<String>, client_id: string, client_secret: string, tenant: string, entorno: string) {
    try {
      let errorWhere = '';
      let cierre = true;
      for (const botiga of botigas) {
        // Itera desde el día inicial hasta el día final
        for (let day = dayStart; day <= dayEnd; day++) {
          try {
            // Formatea el día y el mes para asegurarse de que tengan 2 dígitos
            const formattedDay = String(day).padStart(2, '0');
            const formattedMonth = String(month).padStart(2, '0');
            const formattedYear = String(year);

            console.log(`Procesando ventas para el día: ${formattedDay}/${formattedMonth}/${formattedYear} | Tienda: ${botiga}`);

            // Llama a tu función con el día formateado
            let turno = 0;
            console.log('Iniciando syncSalesSilema...');
            await this.syncSalesSilema(formattedDay, formattedMonth, formattedYear, companyID, database, botiga, turno, client_id, client_secret, tenant, entorno);

            console.log('syncSalesSilema completado.');

            errorWhere = 'syncSalesSilemaAbono';

            console.log('Iniciando syncSalesSilemaAbono...');
            await this.syncSalesSilemaAbono(formattedDay, formattedMonth, formattedYear, companyID, database, botiga, turno, client_id, client_secret, tenant, entorno);

            console.log('syncSalesSilemaAbono completado.');
            if (cierre) {
              console.log('Iniciando syncSalesSilemaCierre...');

              errorWhere = 'syncSalesSilemaCierre';
              await this.syncSalesSilemaCierre(formattedDay, formattedMonth, formattedYear, companyID, database, botiga, turno, client_id, client_secret, tenant, entorno);

              console.log('syncSalesSilemaCierre completado.');
            }
          } catch (error) {
            console.error(`Error ${errorWhere} para el día ${day}/${month}/${year} en la empresa ${companyID}, tienda ${botiga}:`, error);
            console.error(error);
          }
        }
      }
    } catch (error) {
      console.error('Error general en syncSalesSilemaDate:', error);
    }
    return true;
  }

  // Funcion que pasandole un dia de inicio y otro de fin sincroniza los datos de ventas de silema
  async syncSalesSilemaDateTurno(dayStart, dayEnd, month, year, companyID, database, botigas: Array<String>, turno, client_id: string, client_secret: string, tenant: string, entorno: string) {
    try {
      let errorWhere = '';
      let cierre = true;
      for (const botiga of botigas) {
        // Itera desde el día inicial hasta el día final
        for (let day = dayStart; day <= dayEnd; day++) {
          try {
            // Formatea el día y el mes para asegurarse de que tengan 2 dígitos
            const formattedDay = String(day).padStart(2, '0');
            const formattedMonth = String(month).padStart(2, '0');
            const formattedYear = String(year);

            console.log(`Procesando ventas para el día: ${formattedDay}/${formattedMonth}/${formattedYear} | Tienda: ${botiga}`);

            // Llama a tu función con el día formateado

            errorWhere = 'syncSalesSilema';
            await this.syncSalesSilema(formattedDay, formattedMonth, formattedYear, companyID, database, botiga, turno, client_id, client_secret, tenant, entorno);
            errorWhere = 'syncSalesSilemaAbono';
            await this.syncSalesSilemaAbono(formattedDay, formattedMonth, formattedYear, companyID, database, botiga, turno, client_id, client_secret, tenant, entorno);
            if (cierre) {
              errorWhere = 'syncSalesSilemaCierre';
              await this.syncSalesSilemaCierre(formattedDay, formattedMonth, formattedYear, companyID, database, botiga, turno, client_id, client_secret, tenant, entorno);
            }
          } catch (error) {
            console.error(`Error ${errorWhere} para el día ${day}/${month}/${year} en la empresa ${companyID}, tienda ${botiga}:`, error);
            console.error(error);
          }
        }
      }
    } catch (error) {
      console.error('Error general en syncSalesSilemaDate:', error);
    }
    return true;
  }

  //Sincroniza tickets HIT-BC, Ventas
  async syncSalesSilema(day, month, year, companyID, database, botiga, turno, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    let tipo = 'syncSalesSilema';
    let sqlQFranquicia = `SELECT * FROM constantsClient WHERE Codi = ${botiga} and Variable = 'Franquicia'`;
    let queryFranquicia = await this.sql.runSql(sqlQFranquicia, database);
    if (queryFranquicia.recordset.length >= 1) return;
    let sqlQHora = `select CONVERT(Time, Data) as hora, Import from [V_Moviments_${year}-${month}] where botiga = ${botiga} and Tipus_moviment = 'Z' and day(data)=${day} group by Data, Import order by Data`;
    let queryHora = await this.sql.runSql(sqlQHora, database);
    if (queryHora.recordset.length == 0) return;
    let hora = queryHora.recordset[0].hora;
    let importTurno1 = queryHora.recordset[0].Import;
    let importTurno2;
    if (queryHora.recordset.length > 1) importTurno2 = queryHora.recordset[1].Import;

    // Formatear en "hh:mm:ss"
    let formattedHora = `${String(hora.getUTCHours()).padStart(2, '0')}:${String(hora.getMinutes()).padStart(2, '0')}:${String(hora.getSeconds()).padStart(2, '0')}`;
    //console.log(formattedHora)
    switch (Number(turno)) {
      case 1:
        await this.processTurnoSalesSilema(1, '<', importTurno1, botiga, day, month, year, formattedHora, database, tipo, tenant, entorno, companyID, token);
        break;
      case 2:
        await this.processTurnoSalesSilema(2, '>', importTurno2, botiga, day, month, year, formattedHora, database, tipo, tenant, entorno, companyID, token);
        break;
      default:
        await this.processTurnoSalesSilema(1, '<', importTurno1, botiga, day, month, year, formattedHora, database, tipo, tenant, entorno, companyID, token);
        await this.processTurnoSalesSilema(2, '>', importTurno2, botiga, day, month, year, formattedHora, database, tipo, tenant, entorno, companyID, token);
        break;
    }
    return true;
  }

  //Abono
  async syncSalesSilemaAbono(day, month, year, companyID, database, botiga, turno, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    let tipo = 'syncSalesSilemaAbono';
    let sqlQFranquicia = `SELECT * FROM constantsClient WHERE Codi = ${botiga} and Variable = 'Franquicia'`;
    let queryFranquicia = await this.sql.runSql(sqlQFranquicia, database);
    if (queryFranquicia.recordset.length >= 1) return;
    let sqlQHora = `select CONVERT(Time, Data) as hora, CONVERT(Date, Data) as data, Import from [V_Moviments_${year}-${month}] where botiga = ${botiga} and Tipus_moviment = 'Z' and day(data)=${day} group by Data, Import order by Data`;
    //console.log(sqlQHora);
    let queryHora = await this.sql.runSql(sqlQHora, database);
    if (queryHora.recordset.length == 0) return;
    let hora = queryHora.recordset[0].hora;
    // Formatear en "hh:mm:ss"
    let formattedHora = `${String(hora.getUTCHours()).padStart(2, '0')}:${String(hora.getMinutes()).padStart(2, '0')}:${String(hora.getSeconds()).padStart(2, '0')}`;
    //console.log(formattedHora); // Debería mostrar "14:31:43"
    switch (Number(turno)) {
      case 1:
        await this.processTurnoSalesSilemaAbono(1, '<', botiga, day, month, year, queryHora, formattedHora, database, tipo, tenant, entorno, companyID, token);
        break;
      case 2:
        await this.processTurnoSalesSilemaAbono(2, '>', botiga, day, month, year, queryHora, formattedHora, database, tipo, tenant, entorno, companyID, token);
        break;
      default:
        await this.processTurnoSalesSilemaAbono(1, '<', botiga, day, month, year, queryHora, formattedHora, database, tipo, tenant, entorno, companyID, token);
        await this.processTurnoSalesSilemaAbono(2, '>', botiga, day, month, year, queryHora, formattedHora, database, tipo, tenant, entorno, companyID, token);
        break;
    }
    return true;
  }

  //Sincroniza tickets HIT-BC, Ventas
  async syncSalesSilemaCierre(day, month, year, companyID, database, botiga, turno, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    let tipo = 'syncSalesSilemaCierre';
    let sqlQFranquicia = `SELECT * FROM constantsClient WHERE Codi = ${botiga} and Variable = 'Franquicia'`;
    let queryFranquicia = await this.sql.runSql(sqlQFranquicia, database);
    if (queryFranquicia.recordset.length >= 1) return;
    let sqlQHora = `select CONVERT(Time, Data) as hora, Import from [V_Moviments_${year}-${month}] where botiga = ${botiga} and Tipus_moviment = 'Z' and day(data)=${day} group by Data, Import order by Data`;
    //console.log(sqlQHora);

    let queryHora = await this.sql.runSql(sqlQHora, database);
    if (queryHora.recordset.length == 0) return;
    let hora = queryHora.recordset[0].hora;
    // Formatear en "hh:mm:ss"
    let formattedHora = `${String(hora.getUTCHours()).padStart(2, '0')}:${String(hora.getMinutes()).padStart(2, '0')}:${String(hora.getSeconds()).padStart(2, '0')}`;
    //console.log(formattedHora); // Debería mostrar "14:31:43"
    switch (Number(turno)) {
      case 1:
        await this.processTurnoSalesSilemaCierre(1, '<=', botiga, day, month, year, formattedHora, database, tipo, tenant, entorno, companyID, token);
        break;
      case 2:
        await this.processTurnoSalesSilemaCierre(2, '>', botiga, day, month, year, formattedHora, database, tipo, tenant, entorno, companyID, token);
        break;
      default:
        await this.processTurnoSalesSilemaCierre(1, '<=', botiga, day, month, year, formattedHora, database, tipo, tenant, entorno, companyID, token);
        await this.processTurnoSalesSilemaCierre(2, '>', botiga, day, month, year, formattedHora, database, tipo, tenant, entorno, companyID, token);
        break;
    }
    return true;
  }

  private getSQLQuerySalesSilema(botiga: number, day: number, month: number, year: number, formattedHora: string, operador: string) {
    return `
    DECLARE @Botiga INT =${botiga};
    DECLARE @Dia INT = ${day};
    DECLARE @Hora TIME = '${formattedHora}';

    DECLARE @TotalSinIVA DECIMAL(18, 2);

    SELECT @TotalSinIVA = SUM(v.import / (1 + (ISNULL(COALESCE(t.Iva, tz.Iva), 10) / 100.0)))
    FROM [v_venut_${year}-${month}] v
    LEFT JOIN articles a ON v.plu = a.codi 
    LEFT JOIN articles_zombis az ON v.plu = az.codi AND a.codi IS NULL 
    LEFT JOIN TipusIva2012 t ON a.TipoIva = t.Tipus 
    LEFT JOIN TipusIva2012 tz ON az.TipoIva = tz.Tipus AND t.Tipus IS NULL 
    WHERE v.botiga = @Botiga AND DAY(v.data) = @Dia AND CONVERT(TIME, v.data) ${operador} @Hora;

    SELECT 
        LTRIM(RTRIM(c.Nom)) AS Nom, 
        LTRIM(RTRIM(c.Nif)) AS Nif, 
        MIN(CONVERT(DATE, v.data)) AS Data, 
        LTRIM(RTRIM(COALESCE(a.Codi, az.Codi))) AS Codi, 
        LTRIM(RTRIM(COALESCE(a.NOM, az.NOM))) AS Producte, 
        COALESCE(a.PREU, az.PREU) AS Preu, 
        SUM(import) AS Import, 
        SUM(quantitat) AS Quantitat, 
        COALESCE(t.Iva, tz.Iva) AS Iva, 
        ROUND(v.Import / NULLIF(v.Quantitat, 0), 5) AS precioUnitario, 
        SUM(SUM(import)) OVER () AS Total,
        ROUND(SUM(v.import) / (1 + (ISNULL(COALESCE(t.Iva, tz.Iva), 10) / 100)),5) AS SinIVA,
        @TotalSinIVA AS TotalSinIVA,
        (SELECT MIN(num_tick) FROM [v_venut_${year}-${month}] WHERE botiga = @Botiga AND DAY(data) = @Dia AND CONVERT(TIME, data) ${operador} @Hora) AS MinNumTick, 
        (SELECT MAX(num_tick) FROM [v_venut_${year}-${month}] WHERE botiga = @Botiga AND DAY(data) = @Dia AND CONVERT(TIME, data) ${operador} @Hora) AS MaxNumTick
    FROM [v_venut_${year}-${month}] v 
    LEFT JOIN articles a ON v.plu = a.codi 
    LEFT JOIN articles_zombis az ON v.plu = az.codi AND a.codi IS NULL 
    LEFT JOIN clients c ON v.botiga = c.codi 
    LEFT JOIN TipusIva2012 t ON a.TipoIva = t.Tipus 
    LEFT JOIN TipusIva2012 tz ON az.TipoIva = tz.Tipus AND t.Tipus IS NULL 
    WHERE v.botiga = @Botiga AND DAY(v.data) = @Dia AND CONVERT(TIME, v.data) ${operador} @Hora 
    GROUP BY 
        LTRIM(RTRIM(c.nom)), 
        LTRIM(RTRIM(c.Nif)), 
        LTRIM(RTRIM(COALESCE(a.NOM, az.NOM))), 
        LTRIM(RTRIM(COALESCE(a.Codi, az.Codi))), 
        COALESCE(a.PREU, az.PREU), 
        COALESCE(t.Iva, tz.Iva), 
        ROUND(v.Import / NULLIF(v.Quantitat, 0), 5)
    HAVING SUM(quantitat) > 0;`;
  }

  async processTurnoSalesSilema(
    turno: number,
    operador: string,
    importAmount: string,
    botiga: number,
    day: number,
    month: number,
    year: number,
    formattedHora: string,
    database: string,
    tipo: string,
    tenant: string,
    entorno: string,
    companyID: string,
    token: string,
  ) {
    let sqlQuery = await this.getSQLQuerySalesSilema(botiga, day, month, year, formattedHora, operador);
    let data = await this.sql.runSql(sqlQuery, database);

    if (data.recordset.length > 0) {
      let x = data.recordset[0];
      let date = new Date(x.Data);

      // Extraemos el día, el mes y el año
      let formattedDay = String(date.getDate()).padStart(2, '0');
      let formattedMonth = String(date.getMonth() + 1).padStart(2, '0'); // getMonth() es 0-indexado, así que sumamos 1
      let formattedYear = String(date.getFullYear()).slice(2); // Últimos dos dígitos del año
      let formattedDate = `${formattedDay}-${formattedMonth}-${formattedYear}`;
      let formattedDate2 = date.toISOString().substring(0, 10);

      let sellToCustomerNo = x.Nif === 'B61957189' ? '430001314' : '';
      x.Nom = x.Nom.substring(0, 6);
      let salesData = {
        no: `${x.Nom}_${turno}_${formattedDate}`,
        documentType: 'Invoice',
        dueDate: formattedDate2,
        externalDocumentNo: `${x.Nom}_${turno}_${formattedDate}`,
        locationCode: `${this.extractNumber(x.Nom)}`,
        orderDate: formattedDate2,
        postingDate: formattedDate2,
        recapInvoice: false,
        remainingAmount: parseFloat(x.Total.toFixed(2)), // Esto parece que debería ser diferente para cada turno, revísalo
        amountExclVat: parseFloat(x.TotalSinIVA.toFixed(2)),
        shift: `Shift_x0020_${turno}`,
        sellToCustomerNo: sellToCustomerNo,
        shipToCode: `${this.extractNumber(x.Nom).toUpperCase()}`,
        storeInvoice: true,
        vatRegistrationNo: x.Nif,
        firstSummaryDocNo: x.MinNumTick.toString(),
        lastSummaryDocNo: x.MaxNumTick.toString(),
        invoiceStartDate: formattedDate2,
        invoiceEndDate: formattedDate2,
        salesLinesBuffer: [],
      };
      for (let i = 0; i < data.recordset.length; i++) {
        x = data.recordset[i];
        let isoDate = new Date(x.Data).toISOString().substring(0, 10);
        x.Iva = `IVA${String(x.Iva).replace(/\D/g, '').padStart(2, '0')}`;
        if (x.Iva === 'IVA00') x.Iva = 'IVA0';
        let salesLine = {
          documentNo: salesData.no,
          type: `Item`,
          no: x.Codi,
          lineNo: i + 1,
          description: x.Producte,
          quantity: parseFloat(x.Quantitat),
          shipmentDate: isoDate,
          lineTotalAmount: parseFloat(x.Import),
          vatProdPostingGroup: `${x.Iva}`,
          unitPrice: parseFloat(x.precioUnitario),
          locationCode: `${this.extractNumber(x.Nom)}`,
        };
        salesData.salesLinesBuffer.push(salesLine);
      }
      //salesData.remainingAmount = parseFloat(Number(x.Total).toFixed(2));
      await this.postToApi(tipo, salesData, tenant, entorno, companyID, token);
    }
  }

  private getSQLQuerySalesSilemaAbono(botiga: number, day: number, month: number, year: number, formattedHora: string, operador: string, sqlAbono: boolean) {
    if (sqlAbono) {
      return `
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
                AND CONVERT(TIME, data) ${operador} @Hora
                AND motiu LIKE 'Deute client%'
          )
          AND CHARINDEX('id:', v.otros) > 0
          AND CHARINDEX(']', v.otros, CHARINDEX('id:', v.otros)) > 0
          AND CONVERT(TIME, data) ${operador} @Hora
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
              cl2.Nom as Nom
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
              SUM(fd.import) AS Importe
          FROM   FilteredData fd
          GROUP  BY
              fd.Nom,
              LTRIM(RTRIM(fd.nifTienda)),
              fd.iva
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
          Round(t.TotalSenseIVA,2) as TotalSenseIVA
      FROM   Aggregated a
      CROSS  JOIN Totals t
      ORDER  BY
          a.IVA,
          a.NifTienda;`;
    } else {
      return `
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
                AND CONVERT(TIME, data) ${operador} @Hora
                AND motiu LIKE 'Deute client%'
          )
          AND CHARINDEX('id:', v.otros) > 0
          AND CHARINDEX(']', v.otros, CHARINDEX('id:', v.otros)) > 0
          AND CONVERT(TIME, data) ${operador} @Hora
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

  async processTurnoSalesSilemaAbono(turno, operador, botiga, day, month, year, queryHora, formattedHora, database, tipo, tenant, entorno, companyID, token) {
    //Abono
    let sqlQ = this.getSQLQuerySalesSilemaAbono(botiga, day, month, year, formattedHora, operador, true);
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
      let formattedDate2 = new Date(queryHora.recordset[0].data).toISOString().substring(0, 10);
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

      //console.log(salesData)
      await this.postToApi(tipo, salesData, tenant, entorno, companyID, token);

      //Facturas
      sqlQ = this.getSQLQuerySalesSilemaAbono(botiga, day, month, year, formattedHora, operador, false);
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
          // console.log(`salesData Number: ${salesData.no}`)
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
      //console.log(salesData)
    }
  }

  private getSQLQuerySalesSilemaCierre(botiga: number, day: number, month: number, year: number, formattedHora: string, operador: string) {
    return `
    DECLARE @botiga INT = ${botiga};
    DECLARE @day INT = ${day};
    DECLARE @Hora TIME = '${formattedHora}';

    ;WITH Totales AS (
        SELECT 
            LEFT(c.nom, 6) AS Botiga,
            MIN(m.Data) AS Data,
            SUM(CASE WHEN m.Tipus_moviment = 'Z' THEN m.Import ELSE 0 END) AS TotalVentas,
            SUM(CASE WHEN m.Tipus_moviment = 'DATAFONO' THEN m.Import ELSE 0 END) AS Tarjeta,
            SUM(CASE WHEN m.Tipus_moviment = 'DATAFONO_3G' THEN m.Import ELSE 0 END) AS Tarjeta3G,
            SUM(CASE WHEN m.Tipus_moviment = 'Wi' THEN m.Import ELSE 0 END) AS CambioInicial,
            SUM(CASE WHEN m.Tipus_moviment = 'W' THEN m.Import ELSE 0 END) AS CambioFinal,
            SUM(CASE WHEN m.Tipus_moviment = 'J' THEN m.Import ELSE 0 END) AS Descuadre,
            SUM(CASE WHEN m.Tipus_moviment = 'O' AND m.motiu LIKE 'Pagat TkRs:%' THEN m.Import ELSE 0 END) AS TicketRestaurante,
            SUM(CASE WHEN m.Tipus_moviment = 'O' AND m.motiu LIKE 'Excs.TkRs:%' THEN m.Import ELSE 0 END) AS TicketRestauranteExcs,
            SUM(CASE WHEN m.Tipus_moviment = 'O' AND m.motiu LIKE '%Deute client:%' THEN m.Import ELSE 0 END) AS TotalDeudas
        FROM [v_moviments_${year}-${month}] m
        INNER JOIN clients c ON m.Botiga = c.codi
        WHERE DAY(m.Data) = @day 
          AND m.Botiga = @botiga
          AND CONVERT(TIME, m.Data) ${operador} @Hora
        GROUP BY LEFT(c.nom, 6)
    )

    SELECT 
        Botiga, CONVERT(Date, Data) AS Data, 'Total' AS Tipo_moviment,
        ((TotalVentas + TotalDeudas) * -1) AS Import,
        'Payment' AS documentType, 'Total' AS description, 1 AS Orden
    FROM Totales
    WHERE CambioInicial <> 0

    UNION ALL

    SELECT 
        Botiga, CONVERT(Date, Data), 'Efectivo',
        (TotalVentas - ((TotalDeudas * -1) + (Tarjeta * -1) + (Tarjeta3G * -1) + (COALESCE(TicketRestaurante, 0)* -1)) - (Descuadre * -1)),
        '', 'Efectivo', 2
    FROM Totales
    WHERE (TotalVentas - ((TotalDeudas * -1) + (Tarjeta * -1) + (Tarjeta3G * -1) + (COALESCE(TicketRestaurante, 0)* -1)) - (Descuadre * -1)) <> 0

    UNION ALL

    SELECT 
        Botiga, CONVERT(Date, Data), 'Tarjeta', (Tarjeta * -1), '', 'Tarjeta', 3
    FROM Totales
    WHERE Tarjeta <> 0

    UNION ALL

    SELECT 
        Botiga, CONVERT(Date, Data), 'Tarjeta 3G', (Tarjeta3G * -1), '', 'Tarjeta 3G', 4
    FROM Totales
    WHERE Tarjeta3G <> 0

    UNION ALL

    SELECT 
        Botiga, CONVERT(Date, Data), 'Ticket Restaurante', ((TicketRestaurante + TicketRestauranteExcs)* -1), '', 'Ticket Restaurante', 5
    FROM Totales
    WHERE TicketRestaurante <> 0

    UNION ALL

    SELECT 
        Botiga, CONVERT(Date, Data), 'Ticket Restaurante Exceso', TicketRestauranteExcs, '', 'Exceso Ticket Restaurante', 6
    FROM Totales
    WHERE TicketRestaurante <> 0

    UNION ALL

    SELECT 
        Botiga, CONVERT(Date, Data), 'Descuadre', (Descuadre * -1), '', 'Descuadre', 7
    FROM Totales
    WHERE Descuadre <> 0

    UNION ALL

    SELECT 
        LEFT(c.nom, 6), CONVERT(Date, m.Data), 'Entrega diaria', (m.Import * -1), '', 'Entrega diaria', 8
    FROM [v_moviments_${year}-${month}] m
    INNER JOIN clients c ON m.Botiga = c.codi
    WHERE m.Tipus_moviment = 'O'
      AND DAY(m.Data) = @day 
      AND m.Botiga = @botiga 
      AND CONVERT(TIME, m.Data) ${operador} @Hora
      AND m.motiu = 'Entrega Diària'
      AND m.Import <> 0

    UNION ALL

    SELECT 
        LEFT(c.nom, 6), CONVERT(Date, m.Data), 'Salida gastos', (m.Import * -1), '', m.motiu, 9
    FROM [v_moviments_${year}-${month}] m
    INNER JOIN clients c ON m.Botiga = c.codi
    WHERE m.Tipus_moviment = 'O'
      AND DAY(m.Data) = @day 
      AND m.Botiga = @botiga 
      AND CONVERT(TIME, m.Data) ${operador} @Hora
      AND m.motiu <> '' 
      AND m.motiu NOT LIKE '%pagat%' 
      AND m.motiu NOT LIKE 'Entrega Diària%' 
      AND m.motiu NOT LIKE '%deute client%' 
      AND m.motiu NOT LIKE '%tkrs%' 
      AND m.motiu NOT LIKE '%dejaACuenta%' 
      AND m.Import <> 0

    UNION ALL

    SELECT 
        LEFT(c.nom, 6), CONVERT(Date, m.Data), 'Entrada', m.Import, '', m.motiu, 10
    FROM [v_moviments_${year}-${month}] m
    INNER JOIN clients c ON m.Botiga = c.codi
    WHERE m.Tipus_moviment = 'A'
      AND DAY(m.Data) = @day 
      AND m.Botiga = @botiga 
      AND CONVERT(TIME, m.Data) ${operador} @Hora
      AND m.motiu <> '' 
      AND m.motiu NOT LIKE '%dev t%' 
      AND m.motiu NOT LIKE '%dejaACuenta%' 
      AND m.Import <> 0

    UNION ALL

    SELECT 
        Botiga, CONVERT(Date, Data), 'Cambio Inicial', (CambioInicial * -1), '', 'Cambio Inicial', 11
    FROM Totales
    WHERE CambioInicial <> 0

    UNION ALL

    SELECT 
        Botiga, CONVERT(Date, Data), 'Cambio Final', CambioFinal, '', 'Cambio Final', 12
    FROM Totales
    WHERE CambioFinal <> 0

    ORDER BY Orden;`;
  }

  async processTurnoSalesSilemaCierre(turno, operador, botiga, day, month, year, formattedHora, database, tipo, tenant, entorno, companyID, token) {
    let sqlQ = await this.getSQLQuerySalesSilemaCierre(botiga, day, month, year, formattedHora, operador);
    let data = await this.sql.runSql(sqlQ, database);
    // console.log(sqlQ);
    if (data.recordset.length > 0) {
      let x = data.recordset[0];
      let date = new Date(x.Data);

      // Extraemos el día, el mes y el año
      day = String(date.getDate()).padStart(2, '0');
      month = String(date.getMonth() + 1).padStart(2, '0'); // getMonth() es 0-indexado, así que sumamos 1
      let formattedYear = String(date.getFullYear()).slice(2); // Obtenemos solo los últimos dos dígitos del año

      // Formateamos la fecha en el formato ddmmyy
      let formattedDate = `${day}-${month}-${formattedYear}`;
      let formattedDate2 = new Date(x.Data).toISOString().substring(0, 10);

      let changetLocationCode = false;
      //let nLines = await this.getJournalLinesCount(tenant, entorno, companyID, token);
      for (let i = 0; i < data.recordset.length; i++) {
        x = data.recordset[i];
        let formattedTittle = `${x.Botiga.toUpperCase()}_${turno}_${formattedDate}_CT`;
        let salesCierre = {
          documentType: `${x.documentType}`,
          documentNo: `${formattedTittle}`,
          lineNo: i + 1,
          amount: parseFloat(parseFloat(x.Import).toFixed(2)), //Float
          description: `${x.description}`,
          externalDocumentNo: `${formattedTittle}`,
          postingDate: `${formattedDate2}`,
          shift: `Shift_x0020_${turno}`,
          dueDate: `${formattedDate2}`,
          locationCode: `${this.extractNumber(x.Botiga)}`,
          closingStoreType: '',
        };

        switch (x.Tipo_moviment) {
          case 'Efectivo':
            salesCierre.closingStoreType = 'Cash';
            break;
          case 'Tarjeta':
            salesCierre.closingStoreType = 'Card';
            break;
          case 'Tarjeta 3G':
            salesCierre.closingStoreType = '3G Card';
            break;
          case 'Ticket Restaurante':
            salesCierre.closingStoreType = 'Restaurant Ticket';
            break;
          case 'Ticket Restaurante Exceso':
            salesCierre.closingStoreType = 'Excess Restaurant Ticket';
            break;
          case 'Cambio Inicial':
            salesCierre.closingStoreType = 'Drawer Opening';
            break;
          case 'Cambio Final':
            salesCierre.closingStoreType = 'Drawer Closing';
            break;
          case 'Descuadre':
            salesCierre.closingStoreType = 'Discrepancy';
            break;
          case 'Entrega diaria':
            salesCierre.closingStoreType = 'Cash Withdrawals';
            break;
          case 'Salida gastos':
            salesCierre.closingStoreType = 'Withdrawals for Expenses';
            break;
          case 'Entrada':
            salesCierre.closingStoreType = 'Entries in Drawer';
            break;
          case 'Total':
            salesCierre.closingStoreType = 'Total invoice';
            break;
          default:
            //no se
            break;
        }
        //nLines++;
        //console.log(JSON.stringify(salesCierre, null, 2));
        await this.postToApiCierre(tipo, salesCierre, tenant, entorno, companyID, token);
        // console.log(salesCierre)
      }

      // console.log(salesCierre)
    }
    return true;
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

  async postToApiCierre(tipo, salesData, tenant, entorno, companyID, token) {
    let url1 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/journalLinesBuffer?$filter=contains(documentNo,'${salesData.documentNo}') and lineNo eq ${salesData.lineNo}`;
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
      let url2 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/journalLinesBuffer`;
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
        console.log(`${tipo} subido con exito ${salesData.documentNo}`);
      } catch (error) {
        salesData.salesLinesBuffer = [];
        console.log(JSON.stringify(salesData, null, 2));
        console.error(`Error posting sales ${tipo} data:`, error.response?.data || error.message);
        return;
      }
    } else {
      console.log(`Ya existe la ${tipo}: ${salesData.documentNo} Linea: ${salesData.lineNo}`);
    }
  }

  async getJournalLinesCount(tenant: string, entorno: string, companyID: string, token: string) {
    const url = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/journalLinesBuffer?$count=true&$top=0`;

    try {
      let resGet1 = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      // Extraer la cantidad de registros desde @odata.count
      const count = resGet1.data['@odata.count'];
      console.log(`Cantidad de registros: ${count}`);
      return count;
    } catch (error) {
      console.error(`Url ERROR: ${url}`, error);
      throw new Error('Failed to obtain sale count');
    }
  }

  extractNumber(input: string): string | null {
    input = input.toUpperCase();
    const match = input.match(/[TM]--(\d{3})/);
    return match ? match[1] : null;
  }
}
