import { Injectable } from '@nestjs/common';
import { getTokenService } from '../connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConection.service';
import axios from 'axios';

@Injectable()
export class salesSilemaRecapService {
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) { }

  async syncRecapPeriodo(periodoRecap, month, year, companyID, database, client_id: string, client_secret: string, tenant: string, entorno: string) {
    month = String(month).padStart(2, '0'); // Asegura que el mes tenga dos dígitos

    let sqlQ = `;WITH ExtractedData AS (
    SELECT 
        SUBSTRING(v.otros, CHARINDEX('id:', v.otros) + 3, CHARINDEX(']', v.otros, CHARINDEX('id:', v.otros)) - (CHARINDEX('id:', v.otros) + 3)) AS ExtractedValue,
        v.import,
        i.iva,
        v.Botiga,
		v.num_tick
    FROM [v_venut_${year}-${month}] v
    LEFT JOIN articles a ON v.plu = a.codi
    LEFT JOIN TipusIva2012 i ON a.TipoIva = i.Tipus
    WHERE num_tick IN (
        SELECT 
            SUBSTRING(motiu, CHARINDEX(':', motiu) + 2, LEN(motiu)) AS Numero
        FROM [v_moviments_${year}-${month}]
        WHERE  motiu LIKE 'Deute client%'
    )
    AND CHARINDEX('id:', v.otros) > 0
    AND CHARINDEX(']', v.otros, CHARINDEX('id:', v.otros)) > 0
    ),
    FilteredData AS (
    SELECT 
        d.ExtractedValue,
        c.valor,
        c.codi,
        cl.nif,
        cl2.Nif AS nifTienda,
        cl2.Nom AS Nom,
		d.Botiga as CodiTienda,
        CASE WHEN r.valor = 'Recapitulativa' THEN 1 ELSE 0 END AS RecapitulativaAutomatica,
        COALESCE(NULLIF(p.valor, ''), 'Mensual') AS PeriodoFacturacion
    FROM ExtractedData d
    INNER JOIN constantsclient c ON c.valor collate Modern_Spanish_CI_AS = d.ExtractedValue AND c.variable = 'CFINAL' and c.valor <> ''
    INNER JOIN clients cl ON cl.codi = c.codi
    INNER JOIN clients cl2 ON cl2.codi = d.botiga
    LEFT JOIN constantsclient r ON r.codi = cl.codi AND r.variable = 'Recapitulativa'
    LEFT JOIN constantsclient p ON p.codi = cl.codi AND p.variable = 'Per_Facturacio'
	where cl.nif != ''
    )
    SELECT 
        FilteredData.CodiTienda AS Codi,
      FilteredData.Nom AS Nom,
        cl.Nom AS NomClient,
        FilteredData.nifTienda AS NifTienda,
        FilteredData.nif AS NIF,
        FilteredData.codi AS CodigoCliente,
        FilteredData.RecapitulativaAutomatica,
        FilteredData.PeriodoFacturacion
    FROM FilteredData
    INNER JOIN clients cl ON cl.nif = FilteredData.nif
    where FilteredData.RecapitulativaAutomatica = 1
    GROUP BY FilteredData.CodiTienda, FilteredData.Nom, FilteredData.nif, cl.Nom, FilteredData.nifTienda, FilteredData.codi, FilteredData.RecapitulativaAutomatica, FilteredData.PeriodoFacturacion
    ORDER BY FilteredData.nif;`;
    //console.log(sqlQT1);
    let dayStart = 0;
    let dayEnd = 0;
    const today = new Date(year, month - 1, 1); // Fecha con el mes proporcionado

    let data = await this.sql.runSql(sqlQ, database);

    // Verifica si el periodo es semanal con número (ej. "semanal6")
    const match = periodoRecap.match(/^semanal(\d+)$/);
    if (match) {
      // Si una semana pilla otro mes deberia coger la facturas de los dos meses
      const weekNumber = parseInt(match[1], 10); // Extrae el número de semana
      const firstDayOfWeek = await this.getFirstAndLastDayOfWeek(year, weekNumber);

      dayStart = firstDayOfWeek.firstDay.getDate();
      month = (firstDayOfWeek.firstDay.getMonth() + 1).toString().padStart(2, '0');
      dayEnd = firstDayOfWeek.lastDay.getDate();
      periodoRecap = 'Setmanal';
    } else {
      // Lógica normal para otros periodos
      switch (periodoRecap) {
        case 'mensual':
          dayStart = 1;
          dayEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate(); // Último día del mes
          break;
        case 'quincenal1':
          dayStart = 1;
          dayEnd = 15;
          break;
        case 'quincenal2':
          dayStart = 16;
          dayEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
          break;
        default:
          dayStart = 1;
          dayEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
          break;
      }
    }

    console.log(`Periodo: ${periodoRecap}, Días: ${dayStart} - ${dayEnd}, Mes: ${month}, Año: ${year}, - ${data.recordset.length} datos encontrados`);
    // Itera sobre los datos y ejecuta la sincronización solo si coincide el periodo
    for (let i = 0; i < data.recordset.length; i++) {
      if (data.recordset[i].PeriodoFacturacion.toLowerCase() === periodoRecap.toLowerCase()) {
        await this.syncSalesSilemaRecapitulativa(data.recordset[i].CodigoCliente, data.recordset[i].Codi, dayStart, dayEnd, month, year, companyID, database, client_id, client_secret, tenant, entorno);
      } else {
        console.log(`El periodo de facturación para ${data.recordset[i].Nom} no coincide para la tienda ${data.recordset[i].Codi} (${periodoRecap} vs ${data.recordset[i].PeriodoFacturacion})`);
      }
    }
    return true;
  }

  async syncSalesSilemaRecapitulativa(client, botiga, dayStart, dayEnd, month, year, companyID, database, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    let tipo = 'syncSalesSilemaRecapitulativa';
    let sqlQFranquicia = `SELECT * FROM constantsClient WHERE Codi = ${botiga} and Variable = 'Franquicia'`;
    let queryFranquicia = await this.sql.runSql(sqlQFranquicia, database);
    if (queryFranquicia.recordset.length >= 1) return;
    let shortYear = year.slice(-2);
    // Formateamos las fechas
    let formattedDate = `${dayEnd}-${month}-${shortYear}`;
    let formattedDateDayStart = new Date(Date.UTC(year, month - 1, dayStart)).toISOString().substring(0, 10);
    let formattedDateDayEnd = new Date(Date.UTC(year, month - 1, dayEnd)).toISOString().substring(0, 10);
    let sqlQ = `
    DECLARE @Cliente INT = ${parseInt(client, 10)};
    DECLARE @Inicio INT = ${parseInt(dayStart, 10)};
    DECLARE @Fin INT = ${parseInt(dayEnd, 10)};

    DECLARE @TotalSinIVA DECIMAL(18, 2);

    SELECT @TotalSinIVA = 
        SUM(v.Import / (1 + (ISNULL(i.Iva, 10) / 100.0)))
    FROM [v_venut_${year}-${month}] v
    LEFT JOIN articles a ON a.codi = v.plu
    LEFT JOIN TipusIva i ON i.Tipus = a.TipoIva
    LEFT JOIN ConstantsClient cc ON @Cliente = cc.Codi 
                                AND variable COLLATE Modern_Spanish_CI_AS = 'CFINAL' 
                                AND valor COLLATE Modern_Spanish_CI_AS != ''
    WHERE v.otros COLLATE Modern_Spanish_CI_AS LIKE '%' + cc.valor COLLATE Modern_Spanish_CI_AS + '%'
    AND DAY(data) BETWEEN @Inicio AND @Fin
    AND v.botiga = '${botiga}';

    SELECT 
        v.data AS FECHA,
		    cb.nom AS TIENDA,
		    c.NIF AS NIF,
        CASE cc1.valor WHEN '4' THEN 'CLI_TRANSF' ELSE '' END AS FORMAPAGO,
        v.num_tick AS TICKET, 
        V.PLU AS PLU, 
        a.nom AS ARTICULO, 
        V.Quantitat AS CANTIDAD,
		    i.Iva AS IVA, 
		    ROUND(v.Import / NULLIF(v.Quantitat, 0), 5) AS precioUnitario, 
		    ROUND((v.Import / (1 + (ISNULL(i.Iva, 10) / 100.0))) / NULLIF(v.Quantitat, 0), 5) AS precioUnitarioSinIVA,       
        V.Import AS PRECIO, 
		    ROUND(v.Import / (1 + (ISNULL(i.Iva, 10) / 100.0)), 5) AS PRECIO_SIN_IVA,
		    SUM(v.Import) OVER () AS TOTAL, 
		    @TotalSinIVA AS TotalSinIVA
    FROM [v_venut_${year}-${month}] v
    LEFT JOIN articles a ON a.codi = v.plu
    LEFT JOIN TipusIva i ON i.Tipus = a.TipoIva
    LEFT JOIN ConstantsClient cc ON @Cliente = cc.Codi 
                                AND variable COLLATE Modern_Spanish_CI_AS = 'CFINAL' 
                                AND valor COLLATE Modern_Spanish_CI_AS != ''
    LEFT JOIN Clients c ON cc.codi = c.codi
    LEFT JOIN clients cb ON v.botiga = cb.codi
    LEFT JOIN ConstantsClient cc1 ON cc1.codi = @Cliente AND cc1.variable = 'FormaPagoLlista'
    WHERE v.otros COLLATE Modern_Spanish_CI_AS LIKE '%' + cc.valor COLLATE Modern_Spanish_CI_AS + '%'
    AND DAY(data) BETWEEN @Inicio AND @Fin
    AND cb.codi = '${botiga}'
    GROUP BY 
        V.Num_tick, v.plu, a.nom, v.Quantitat, v.data, v.import, i.iva, cb.nom, c.nif, cc1.Valor,
        ROUND(v.Import / NULLIF(v.Quantitat, 0), 5)
    HAVING SUM(quantitat) > 0
    ORDER BY v.data;`;
    if (dayStart > dayEnd) {
      let nextMonth = String(Number(month) + 1).padStart(2, '0');
      sqlQ = `
      DECLARE @Cliente INT = ${parseInt(client, 10)};
      DECLARE @Inicio INT = ${parseInt(dayStart, 10)};
      DECLARE @Fin INT = ${parseInt(dayEnd, 10)};

      WITH Ventas AS (
          SELECT * FROM [v_venut_${year}-${month}] WHERE DAY(data) BETWEEN @Inicio AND 31
          UNION ALL
          SELECT * FROM [v_venut_${year}-${nextMonth}] WHERE DAY(data) BETWEEN 1 AND @Fin
      ),
      VentasConJoin AS (
          SELECT 
              v.*, 
              a.nom AS ARTICULO, 
              i.Iva,
              cb.nom AS TIENDA, 
              c.NIF,
              ROUND(v.Import / NULLIF(v.Quantitat, 0), 5) AS precioUnitario
          FROM Ventas v
          LEFT JOIN articles a ON a.codi = v.plu
          LEFT JOIN TipusIva i ON i.Tipus = a.TipoIva
          LEFT JOIN ConstantsClient cc ON @Cliente = cc.Codi
                                      AND variable COLLATE Modern_Spanish_CI_AS = 'CFINAL'
                                      AND valor COLLATE Modern_Spanish_CI_AS != ''
          LEFT JOIN Clients c ON cc.codi = c.codi
          LEFT JOIN clients cb ON v.botiga = cb.codi
          WHERE v.otros COLLATE Modern_Spanish_CI_AS LIKE '%' + cc.valor COLLATE Modern_Spanish_CI_AS + '%'
          AND cb.codi = '${botiga}'
      )

      SELECT 
          v.data AS FECHA,
		      v.TIENDA,
		      v.NIF,
          CASE cc1.valor WHEN '4' THEN 'CLI_TRANSF' ELSE '' END AS FORMAPAGO,
          v.num_tick AS TICKET,
          v.PLU,
          v.ARTICULO,
          v.Quantitat AS CANTIDAD,
          v.Iva AS IVA,
          v.precioUnitario,
		      ROUND((v.Import / (1 + (ISNULL(v.Iva, 10) / 100.0))) / NULLIF(v.Quantitat, 0), 5) AS precioUnitarioSinIVA, 
          v.Import AS PRECIO,
          ROUND(v.Import / (1 + (ISNULL(v.Iva, 10) / 100.0)), 5) AS PRECIO_SIN_IVA,
          SUM(v.Import) OVER () AS TOTAL,
          ROUND((SELECT SUM(Import / (1 + (ISNULL(Iva, 10) / 100.0))) FROM VentasConJoin),2) AS TotalSinIVA
      FROM VentasConJoin v
      LEFT JOIN ConstantsClient cc1 ON cc1.codi = @Cliente AND cc1.variable = 'FormaPagoLlista'
      GROUP BY 
          v.num_tick, v.PLU, v.ARTICULO, v.Quantitat, v.data, v.Import, v.Iva, v.TIENDA, v.NIF, v.precioUnitario, cc1.Valor
      HAVING SUM(v.Quantitat) > 0
      ORDER BY v.data;`;
      formattedDateDayEnd = new Date(Date.UTC(year, parseFloat(nextMonth) - 1, dayEnd)).toISOString().substring(0, 10);
    }
    //console.log(sqlQ);

    let data = await this.sql.runSql(sqlQ, database);
    let x = data.recordset[0];
    let paymentMethodCode = `${x.FORMAPAGO}`;
    // Calculamos `n` basado en las facturas recapitulativas existentes
    let url = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/salesHeadersBuffer?$filter=contains(no,'${x.TIENDA}_') and contains(no,'_R') and invoiceStartDate ge ${formattedDateDayStart} and invoiceEndDate le ${formattedDateDayEnd}`;
    //console.log(url);
    let n = await this.getNumberOfRecap(url, token);
    if (n == undefined) n = 1;
    if (x.TIENDA.toLowerCase() == 'bot granollers') x.TIENDA = 'T--000';
    let salesData = {
      no: `${x.TIENDA.substring(0, 6)}_${formattedDate}_R${n}`, // Nº factura
      documentType: 'Invoice', // Tipo de documento+
      dueDate: `${formattedDateDayEnd}`, // Fecha vencimiento
      externalDocumentNo: `${x.TIENDA.substring(0, 6)}_${formattedDate}_R${n}`, // Nº documento externo
      locationCode: `${this.extractNumber(x.TIENDA)}`, // Cód. almacén
      orderDate: `${formattedDateDayEnd}`, // Fecha pedido
      postingDate: `${formattedDateDayEnd}`, // Fecha registro
      recapInvoice: true, // Factura recap //false
      remainingAmount: parseFloat(x.TOTAL.toFixed(2)), // Precio total incluyendo IVA por factura
      amountExclVat: parseFloat(x.TotalSinIVA.toFixed(2)), // Precio total sin IVA por factura
      vatAmount: parseFloat((x.TOTAL - x.TotalSinIVA).toFixed(2)), // IVA total por factura
      paymentMethodCode: `${paymentMethodCode}`, // Cód. forma de pago
      storeInvoice: false, // Factura tienda
      vatRegistrationNo: `${x.NIF}`, // CIF/NIF
      invoiceStartDate: `${formattedDateDayStart}`, // Fecha inicio facturación
      invoiceEndDate: `${formattedDateDayEnd}`, // Fecha fin facturación
      salesLinesBuffer: [], // Array vacío para las líneas de ventas
    };

    let countLines = 1;
    let changetLocationCode = false;
    for (let i = 0; i < data.recordset.length; i++) {
      x = data.recordset[i];
      let date = new Date(x.FECHA);
      let day = date.getDate().toString().padStart(2, '0'); // Asegura dos dígitos
      let month = (date.getMonth() + 1).toString().padStart(2, '0'); // Meses van de 0 a 11
      let shortYear = date.getFullYear().toString().slice(-2); // Obtiene los últimos dos dígitos del año
      let isoDate = date.toISOString().substring(0, 10);
      let formattedDateAlbaran = `${day}/${month}/${shortYear}`;
      if (this.extractNumber(x.TIENDA) != salesData.locationCode && !changetLocationCode) {
        salesData.no = `T--000_${formattedDate}_R${n}`;
        salesData.externalDocumentNo = `T--000_${formattedDate}_R${n}`;
        salesData.locationCode = '000';
        changetLocationCode = true;
      }
      let salesLineAlbaran = {
        documentNo: `${salesData.no}`,
        lineNo: countLines,
        description: `albaran nº ${x.TICKET} ${formattedDateAlbaran}`,
        quantity: 1,
        shipmentDate: `${isoDate}`,
        lineTotalAmount: 0,
        locationCode: `${this.extractNumber(x.TIENDA)}`,
      };
      countLines++;
      salesData.salesLinesBuffer.push(salesLineAlbaran);
      x.IVA = `IVA${String(x.IVA).replace(/\D/g, '').padStart(2, '0')}`;
      if (x.IVA === 'IVA00') x.IVA = 'IVA0';
      let salesLine = {
        documentNo: `${salesData.no}`,
        type: `Item`,
        no: `${x.PLU}`,
        lineNo: countLines,
        description: `${x.ARTICULO}`,
        quantity: parseFloat(x.CANTIDAD),
        shipmentDate: `${isoDate}`,
        lineTotalAmount: parseFloat(x.PRECIO),
        lineAmountExclVat: parseFloat(x.PRECIO_SIN_IVA),
        vatProdPostingGroup: `${x.IVA}`,
        unitPrice: parseFloat(x.precioUnitario),
        unitPriceExclVat: parseFloat(x.precioUnitarioSinIVA),
        locationCode: `${this.extractNumber(x.TIENDA)}`,
      };
      countLines++;
      salesData.salesLinesBuffer.push(salesLine);
    }

    let urlExist = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/salesHeadersBuffer?$filter=contains(no,'${x.TIENDA}_') and contains(no,'_R') and invoiceStartDate ge ${formattedDateDayStart} and invoiceEndDate le ${formattedDateDayEnd} and contains(vatRegistrationNo, '${x.NIF}') and remainingAmount eq ${parseFloat(x.TOTAL.toFixed(2))}`;
    let resGetExist = await axios
      .get(urlExist, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      })
      .catch((error) => {
        console.log(`Url ERROR: ${urlExist}`);
        throw new Error('Failed to obtain sale');
      });
    if (resGetExist.data.value.length >= 1) {
      console.log(`Ya existe la recapitulativa ${resGetExist.data.value[0].no}`);
      return;
    }
    // console.log(salesData);
    await this.postToApi(tipo, salesData, tenant, entorno, companyID, token);
    //Abono recap
    sqlQ = `
    DECLARE @Cliente INT = ${parseInt(client, 10)};
    DECLARE @Inicio INT = ${parseInt(dayStart, 10)};
    DECLARE @Fin INT = ${parseInt(dayEnd, 10)};
    
    DECLARE @TotalConIVA DECIMAL(18, 2);
    DECLARE @TotalSinIVA DECIMAL(18, 2);

    SELECT @TotalConIVA = SUM(V.Import)
    FROM [v_venut_${year}-${month}] V
    LEFT JOIN articles A ON A.codi = V.plu
    LEFT JOIN TipusIva I ON I.Tipus = A.TipoIva
    LEFT JOIN ConstantsClient CC ON @Cliente = CC.Codi AND variable = 'CFINAL' AND valor != ''
    LEFT JOIN Clients C ON CC.codi = C.codi
    LEFT JOIN clients CB ON V.botiga = CB.codi
    WHERE V.otros LIKE '%' + CC.valor + '%'
      AND DAY(data) BETWEEN @Inicio AND @Fin
      AND CB.codi = '${botiga}';

    SELECT @TotalSinIVA = 
        SUM(V.Import / (1 + (ISNULL(I.Iva, 10) / 100.0)))
    FROM [v_venut_${year}-${month}] V
    LEFT JOIN articles A ON A.codi = V.plu
    LEFT JOIN TipusIva I ON I.Tipus = A.TipoIva
    LEFT JOIN ConstantsClient CC ON @Cliente = CC.Codi AND variable = 'CFINAL' AND valor != ''
    LEFT JOIN Clients C ON CC.codi = C.codi
    LEFT JOIN clients CB ON V.botiga = CB.codi
    WHERE V.otros LIKE '%' + CC.valor + '%'
      AND DAY(data) BETWEEN @Inicio AND @Fin
      AND CB.codi = '${botiga}';

    SELECT 
        V.PLU AS PLU, 
        A.nom AS ARTICULO, 
        SUM(V.Quantitat) AS CANTIDAD_TOTAL, 
        SUM(V.Import) AS IMPORTE_TOTAL, 
        MIN(V.data) AS FECHA_PRIMERA_VENTA, 
        MAX(V.data) AS FECHA_ULTIMA_VENTA, 
        I.Iva AS IVA, 
        CB.nom AS TIENDA, 
        C.NIF AS NIF, 
        ROUND(SUM(V.Import) / NULLIF(SUM(V.Quantitat), 0), 5) AS precioUnitario,
        @TotalSinIVA AS TotalSinIVA,
        @TotalConIVA AS TOTAL
    FROM [v_venut_${year}-${month}] V
    LEFT JOIN articles A ON A.codi = V.plu
    LEFT JOIN TipusIva I ON I.Tipus = A.TipoIva
    LEFT JOIN ConstantsClient CC ON @Cliente = CC.Codi AND variable = 'CFINAL' AND valor != ''
    LEFT JOIN Clients C ON CC.codi = C.codi
    LEFT JOIN clients CB ON V.botiga = CB.codi
    WHERE V.otros LIKE '%' + CC.valor + '%'
      AND DAY(data) BETWEEN @Inicio AND @Fin
      AND CB.codi = '${botiga}'
    GROUP BY 
        V.PLU, 
        A.nom, 
        I.Iva, 
        CB.nom, 
        C.NIF
    HAVING SUM(V.Quantitat) > 0
    ORDER BY MIN(V.data);`;
    if (dayStart > dayEnd) {
      let nextMonth = String(Number(month) + 1).padStart(2, '0');
      sqlQ = `
      DECLARE @Cliente INT = ${parseInt(client, 10)};
      DECLARE @Inicio INT = ${parseInt(dayStart, 10)};
      DECLARE @Fin INT = ${parseInt(dayEnd, 10)};

      DECLARE @TotalConIVA DECIMAL(18, 2);
      DECLARE @TotalSinIVA DECIMAL(18, 2);

      SELECT @TotalConIVA = SUM(V.Import)
      FROM (
          SELECT * FROM [v_venut_${year}-${month}] WHERE DAY(data) BETWEEN @Inicio AND 31
          UNION ALL
          SELECT * FROM [v_venut_${year}-${nextMonth}] WHERE DAY(data) BETWEEN 1 AND @Fin
      ) V
      LEFT JOIN articles A ON A.codi = V.plu
      LEFT JOIN TipusIva I ON I.Tipus = A.TipoIva
      LEFT JOIN ConstantsClient CC ON @Cliente = CC.Codi AND variable COLLATE Modern_Spanish_CI_AS = 'CFINAL' AND valor COLLATE Modern_Spanish_CI_AS != ''
      LEFT JOIN Clients C ON CC.codi = C.codi
      LEFT JOIN clients CB ON V.botiga = CB.codi
      WHERE V.otros COLLATE Modern_Spanish_CI_AS LIKE '%' + CC.valor COLLATE Modern_Spanish_CI_AS + '%'
        AND CB.codi = '${botiga}';

      SELECT @TotalSinIVA = 
          SUM(V.Import / (1 + (ISNULL(I.Iva, 10) / 100.0)))
      FROM (
          SELECT * FROM [v_venut_${year}-${month}] WHERE DAY(data) BETWEEN @Inicio AND 31
          UNION ALL
          SELECT * FROM [v_venut_${year}-${nextMonth}] WHERE DAY(data) BETWEEN 1 AND @Fin
      ) V
      LEFT JOIN articles A ON A.codi = V.plu
      LEFT JOIN TipusIva I ON I.Tipus = A.TipoIva
      LEFT JOIN ConstantsClient CC ON @Cliente = CC.Codi AND variable COLLATE Modern_Spanish_CI_AS = 'CFINAL' AND valor COLLATE Modern_Spanish_CI_AS != ''
      LEFT JOIN Clients C ON CC.codi = C.codi
      LEFT JOIN clients CB ON V.botiga = CB.codi
      WHERE V.otros COLLATE Modern_Spanish_CI_AS LIKE '%' + CC.valor COLLATE Modern_Spanish_CI_AS + '%'
        AND CB.codi = '${botiga}';

      SELECT 
          V.PLU AS PLU, 
          A.nom AS ARTICULO, 
          SUM(V.Quantitat) AS CANTIDAD_TOTAL, 
          SUM(V.Import) AS IMPORTE_TOTAL, 
          MIN(V.data) AS FECHA_PRIMERA_VENTA, 
          MAX(V.data) AS FECHA_ULTIMA_VENTA, 
          I.Iva AS IVA, 
          CB.nom AS TIENDA, 
          C.NIF AS NIF, 
          ROUND(SUM(V.Import) / NULLIF(SUM(V.Quantitat), 0), 5) AS precioUnitario,
          @TotalSinIVA AS TotalSinIVA,
          @TotalConIVA AS TOTAL
      FROM (
          SELECT * FROM [v_venut_${year}-${month}] WHERE DAY(data) BETWEEN @Inicio AND 31
          UNION ALL
          SELECT * FROM [v_venut_${year}-${nextMonth}] WHERE DAY(data) BETWEEN 1 AND @Fin
      ) V
      LEFT JOIN articles A ON A.codi = V.plu
      LEFT JOIN TipusIva I ON I.Tipus = A.TipoIva
      LEFT JOIN ConstantsClient CC ON @Cliente = CC.Codi AND variable COLLATE Modern_Spanish_CI_AS = 'CFINAL' AND valor COLLATE Modern_Spanish_CI_AS != ''
      LEFT JOIN Clients C ON CC.codi = C.codi
      LEFT JOIN clients CB ON V.botiga = CB.codi
      WHERE V.otros COLLATE Modern_Spanish_CI_AS LIKE '%' + CC.valor COLLATE Modern_Spanish_CI_AS + '%'
        AND CB.codi = '${botiga}'
      GROUP BY 
          V.PLU, 
          A.nom, 
          I.Iva, 
          CB.nom, 
          C.NIF
      HAVING SUM(V.Quantitat) > 0
      ORDER BY MIN(V.data);`;
    }
    //console.log(sqlQ);

    data = await this.sql.runSql(sqlQ, database);
    x = data.recordset[0];
    shortYear = year.slice(-2);

    // Formateamos la fecha en el formato ddmmyy
    formattedDate = `${dayEnd}-${month}-${shortYear}`;
    formattedDateDayStart = new Date(Date.UTC(year, month - 1, dayStart)).toISOString().substring(0, 10);
    formattedDateDayEnd = new Date(Date.UTC(year, month - 1, dayEnd)).toISOString().substring(0, 10);

    salesData = {
      no: `${x.TIENDA.substring(0, 6)}_${formattedDate}_AR${n}`, // Nº factura
      documentType: 'Credit_x0020_Memo', // Tipo de documento
      dueDate: `${formattedDateDayEnd}`, // Fecha vencimiento
      externalDocumentNo: `${x.TIENDA.substring(0, 6)}_${formattedDate}_AR${n}`, // Nº documento externo
      locationCode: `${this.extractNumber(x.TIENDA)}`, // Cód. almacén
      orderDate: `${formattedDateDayEnd}`, // Fecha pedido
      postingDate: `${formattedDateDayEnd}`, // Fecha registro
      recapInvoice: true, // Factura recap //false
      remainingAmount: parseFloat(x.TOTAL.toFixed(2)), // Precio total incluyendo IVA por factura
      amountExclVat: parseFloat(x.TotalSinIVA.toFixed(2)), // Precio total sin IVA por factura
      vatAmount: parseFloat((x.TOTAL - x.TotalSinIVA).toFixed(2)), // IVA total por factura
      paymentMethodCode: `${paymentMethodCode}`,  // Cód. forma de pago
      storeInvoice: false, // Factura tienda
      vatRegistrationNo: `${x.NIF}`, // CIF/NIF
      invoiceStartDate: `${formattedDateDayStart}`, // Fecha inicio facturación
      invoiceEndDate: `${formattedDateDayEnd}`, // Fecha fin facturación
      salesLinesBuffer: [], // Array vacío para las líneas de ventas
    };
    countLines = 1;
    changetLocationCode = false;
    for (let i = 0; i < data.recordset.length; i++) {
      x = data.recordset[i];
      let date = new Date(x.FECHA_PRIMERA_VENTA);
      let isoDate = date.toISOString().substring(0, 10);
      if (this.extractNumber(x.TIENDA) != salesData.locationCode && !changetLocationCode) {
        salesData.no = `T--000_${formattedDate}_AR${n}`;
        salesData.externalDocumentNo = `T--000_${formattedDate}_AR${n}`;
        salesData.locationCode = '000';
        changetLocationCode = true;
      }
      x.IVA = `IVA${String(x.IVA).replace(/\D/g, '').padStart(2, '0')}`;
      if (x.IVA === 'IVA00') x.IVA = 'IVA0';
      let salesLine = {
        documentNo: `${salesData.no}`,
        type: `Item`,
        no: `${x.PLU}`,
        lineNo: countLines,
        description: `${x.ARTICULO}`,
        quantity: parseFloat(x.CANTIDAD_TOTAL),
        shipmentDate: `${isoDate}`,
        lineTotalAmount: parseFloat(x.IMPORTE_TOTAL.toFixed(2)),
        vatProdPostingGroup: `${x.IVA}`,
        unitPrice: parseFloat(x.precioUnitario),
        locationCode: `${this.extractNumber(x.TIENDA)}`,
      };
      countLines++;
      salesData.salesLinesBuffer.push(salesLine);
    }
    // console.log(salesData);
    await this.postToApi(tipo, salesData, tenant, entorno, companyID, token);

    return true;
  }

  private getFirstAndLastDayOfWeek(year: number, weekNumber: number) {
    // Primer día del año
    const firstDayOfYear = new Date(year, 0, 1);

    // Si es la semana 1, calculamos desde el 1 de enero hasta el primer domingo
    if (weekNumber === 1) {
      const firstSunday = new Date(firstDayOfYear);
      firstSunday.setDate(firstDayOfYear.getDate() + (7 - firstDayOfYear.getDay())); // Primer domingo del año

      return {
        firstDay: firstDayOfYear, // El primer día es el 1 de enero
        lastDay: firstSunday, // El último día es el primer domingo
      };
    }

    // Obtener el primer jueves del año
    const firstThursday = new Date(firstDayOfYear);
    firstThursday.setDate(firstDayOfYear.getDate() + ((4 - firstDayOfYear.getDay() + 7) % 7)); // Primer jueves

    // Obtener el primer lunes del año
    const firstMonday = new Date(firstThursday);
    firstMonday.setDate(firstThursday.getDate() - 3); // El lunes antes del primer jueves

    // Calcular el primer día de la semana 1
    const firstDayOfWeek1 = new Date(firstMonday);

    if (weekNumber === 53) {
      // Si es la semana 53, establecer 30 y 31 de diciembre
      const lastDateOfYear = new Date(year, 11, 31); // 31 de diciembre
      if (lastDateOfYear.getDay() === 3 || lastDateOfYear.getDay() === 4) {
        // 30 y 31 de diciembre
        return {
          firstDay: new Date(year, 11, 30), // 30 de diciembre
          lastDay: new Date(year, 11, 31), // 31 de diciembre
        };
      }
    }

    // Calcular el primer día de la semana deseada
    const startDateOfWeek = new Date(firstDayOfWeek1);
    startDateOfWeek.setDate(firstDayOfWeek1.getDate() + (weekNumber - 1) * 7);

    // Calcular el último día de la semana (domingo de esa semana)
    const endDateOfWeek = new Date(startDateOfWeek);
    endDateOfWeek.setDate(startDateOfWeek.getDate() + 6); // Domingo de esa semana

    return { firstDay: startDateOfWeek, lastDay: endDateOfWeek };
  }
  async postToApi(tipo, salesData, tenant, entorno, companyID, token) {
    if (salesData.no.length > 20) salesData.no = salesData.no.slice(-20);
    if (salesData.locationCode.length > 10) salesData.locationCode = salesData.locationCode.slice(-10);
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
  async getNumberOfRecap(url: string, token: string) {
    try {
      // Obtenemos las facturas filtradas desde Business Central
      let resGet = await axios.get(url, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      });
      // Determinamos `n` basado en el total de facturas recapitulativas encontradas
      return resGet.data.value.length + 1;
      //console.log(`Número de facturas recapitulativas existentes: ${resGet.data.value.length}. Usando número: ${n}`);
    } catch (error) {
      console.error(`Error al obtener las facturas recapitulativas:`, error);
      // Dejamos `n = 1` como valor por defecto
    }
  }
  extractNumber(input: string): string | null {
    input = input.toUpperCase();
    const match = input.match(/[TM]--(\d{3})/);
    return match ? match[1] : null;
  }
}
