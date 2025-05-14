import { Injectable } from '@nestjs/common';
import { getTokenService } from '../connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConection.service';
import axios from 'axios';

@Injectable()
export class salesSilemaCierreService {
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) {}

  //Sincroniza tickets HIT-BC, Ventas
  async syncSalesSilemaCierre(day, month, year, companyID, database, botiga, turno, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    let tipo = 'syncSalesSilemaCierre';
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
      await this.processTurnoSalesSilemaCierre(i + (Number(turno) === 2 ? 2 : 1), botiga, day, month, year, formattedHoraInicio, formattedHoraFin, database, tipo, tenant, entorno, companyID, token);
    }
    return true;
  }

  private getSQLQuerySalesSilemaCierre(botiga: number, day: number, month: number, year: number, horaInicio: string, horaFin: string) {
    return `
    DECLARE @botiga INT = ${botiga};
    DECLARE @day INT = ${day};
    DECLARE @HoraInicio TIME = '${horaInicio}';
    DECLARE @HoraFin TIME = '${horaFin}';

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
          AND CONVERT(TIME, m.Data) BETWEEN @HoraInicio AND @HoraFin
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
      AND CONVERT(TIME, m.Data) BETWEEN @HoraInicio AND @HoraFin
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
      AND CONVERT(TIME, m.Data) BETWEEN @HoraInicio AND @HoraFin
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
      AND CONVERT(TIME, m.Data) BETWEEN @HoraInicio AND @HoraFin
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

  async processTurnoSalesSilemaCierre(turno, botiga, day, month, year, horaInicio, horaFin, database, tipo, tenant, entorno, companyID, token) {
    let sqlQ = await this.getSQLQuerySalesSilemaCierre(botiga, day, month, year, horaInicio, horaFin);
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
        // console.log(JSON.stringify(salesCierre, null, 2));
        await this.postToApiCierre(tipo, salesCierre, tenant, entorno, companyID, token);
        // console.log(salesCierre);
      }
    }
    return true;
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
