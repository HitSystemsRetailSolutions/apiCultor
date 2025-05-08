import { Injectable } from '@nestjs/common';
import { getTokenService } from '../connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConection.service';
import axios from 'axios';

@Injectable()
export class salesSilemaRecapManualService {
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) {}

  async syncSalesSilemaRecapitulativaManual(TicketsArray: Array<String>, client, monthInicial, mesFinal, year, companyID, database, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    let tipo = 'syncSalesSilemaRecapitulativaManual';
    let importTotal: number = 0;
    // let sqlQFranquicia = `SELECT * FROM constantsClient WHERE Codi = ${botiga} and Variable = 'Franquicia'`;
    // let queryFranquicia = await this.sql.runSql(sqlQFranquicia, database);
    // if (queryFranquicia.recordset.length >= 1) return;
    const TicketsString = TicketsArray.join(',');
    let arrayDatos = [];
    //console.log(`Mes inicial: ${monthInicial}, Mes final: ${mesFinal}`);
    for (let i = parseInt(monthInicial, 10); i <= parseInt(mesFinal, 10); i++) {
      const month = String(i).padStart(2, '0'); // Asegura que el mes tenga dos dígitos
      let sqlQ = `
      DECLARE @Cliente INT = ${parseInt(client, 10)};

      DECLARE @TotalSinIVA DECIMAL(18, 2);
      SELECT @TotalSinIVA = 
          SUM(V.Import / (1 + (ISNULL(I.Iva, 10) / 100.0)))
      FROM [v_venut_${year}-${month}] V
      LEFT JOIN articles A ON A.codi = V.plu
      LEFT JOIN TipusIva I ON I.Tipus = A.TipoIva
      LEFT JOIN ConstantsClient CC ON @Cliente = CC.Codi AND variable COLLATE Modern_Spanish_CI_AS = 'CFINAL' AND valor COLLATE Modern_Spanish_CI_AS != ''
      LEFT JOIN Clients C ON CC.codi = C.codi
      LEFT JOIN clients CB ON V.botiga = CB.codi
      WHERE V.otros COLLATE Modern_Spanish_CI_AS LIKE '%' + CC.valor COLLATE Modern_Spanish_CI_AS + '%'
        AND V.num_tick IN (${TicketsString});

      SELECT 
          V.num_tick AS TICKET,
          V.PLU AS PLU,
          A.nom AS ARTICULO,
          V.Quantitat AS CANTIDAD,
          V.data AS FECHA,
          V.Import AS PRECIO,
          I.Iva AS IVA,
          CB.nom AS TIENDA,
          C.NIF AS NIF,
          SUM(V.Import) OVER () AS TOTAL,
          ROUND(V.Import / NULLIF(V.Quantitat, 0), 5) AS precioUnitario,
          @TotalSinIVA AS TotalSinIVA
      FROM [v_venut_${year}-${month}] V
      LEFT JOIN articles A ON A.codi = V.plu
      LEFT JOIN TipusIva I ON I.Tipus = A.TipoIva
      LEFT JOIN ConstantsClient CC ON @Cliente = CC.Codi AND variable COLLATE Modern_Spanish_CI_AS = 'CFINAL' AND valor COLLATE Modern_Spanish_CI_AS != ''
      LEFT JOIN Clients C ON CC.codi = C.codi
      LEFT JOIN clients CB ON V.botiga = CB.codi
      WHERE V.otros COLLATE Modern_Spanish_CI_AS LIKE '%' + CC.valor COLLATE Modern_Spanish_CI_AS + '%'
        AND V.num_tick IN (${TicketsString})
      GROUP BY 
          V.num_tick, 
          V.plu, 
          A.nom, 
          V.Quantitat, 
          V.data, 
          V.import, 
          I.Iva, 
          CB.nom, 
          C.NIF,
          ROUND(V.Import / NULLIF(V.Quantitat, 0), 5)
      HAVING SUM(V.Quantitat) > 0
      ORDER BY V.data;`;
      //console.log(sqlQ);
      let data = await this.sql.runSql(sqlQ, database);
      arrayDatos.push(data.recordset);
      console.log(`Mes ${month} - ${data.recordset.length} datos encontrados`);
    }
    if (arrayDatos.length === 0) {
      throw new Error('No se encontraron facturas en la base de datos.');
    }
    let datosPlanos = arrayDatos.flat();
    //console.log(datosPlanos.length);

    let x = datosPlanos[0];
    let fechas = datosPlanos.map((item) => new Date(item.FECHA));

    // Determinar la fecha más antigua y más reciente correctamente
    let fechaMasAntigua = new Date(Math.min(...fechas.map((f) => f.getTime()))); // Fecha más antigua
    let fechaMasNueva = new Date(Math.max(...fechas.map((f) => f.getTime()))); // Fecha más reciente

    // Extraer día, mes y año en el formato adecuado
    let shortYear = String(year).slice(-2);
    let day = fechaMasAntigua.getDate().toString().padStart(2, '0'); // Asegura que el día tenga dos dígitos
    monthInicial = monthInicial.padStart(2, '0'); // Asegura que el mes tenga dos dígitos
    let monthFormatted = `${monthInicial}-${shortYear}`;
    let formattedDate = `${day}-${monthFormatted}`; // Factura más antigua (para externalDocumentNo)
    let formattedDateDayStart = fechaMasAntigua.toISOString().substring(0, 10); // Factura más antigua (YYYY-MM-DD)
    let formattedDateDayEnd = fechaMasNueva.toISOString().substring(0, 10); // Factura más reciente (YYYY-MM-DD) // Factura más reciente (YYYY-MM-DD)

    // Calculamos `n` basado en las facturas recapitulativas existentes
    let url = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/salesHeadersBuffer?$filter=contains(no,'${x.TIENDA}_') and contains(no,'_RM') and invoiceStartDate ge ${formattedDateDayStart} and invoiceEndDate le ${formattedDateDayEnd}`;
    let n = await this.getNumberOfRecap(url, token);
    if (n == undefined) n = 1;

    let salesData = {
      no: `${x.TIENDA.substring(0, 6)}_${formattedDate}_RM${n}`, // Nº factura
      documentType: 'Invoice', // Tipo de documento
      dueDate: `${formattedDateDayEnd}`, // Fecha vencimiento
      externalDocumentNo: `${x.TIENDA.substring(0, 6)}_${formattedDate}_RM${n}`, // Nº documento externo
      locationCode: `${this.extractNumber(x.TIENDA)}`, // Cód. almacén
      orderDate: `${formattedDateDayEnd}`, // Fecha pedido
      postingDate: `${formattedDateDayEnd}`, // Fecha registro
      recapInvoice: false, // Factura recap //false
      manualRecapInvoice: true, // Factura manual
      remainingAmount: parseFloat(x.TOTAL.toFixed(2)), // Precio total incluyendo IVA por factura
      amountExclVat: parseFloat(x.TotalSinIVA.toFixed(2)), // Precio total sin IVA por factura
      shipToCode: `${this.extractNumber(x.TIENDA).toUpperCase()}`, // Cód. dirección envío cliente
      storeInvoice: false, // Factura tienda
      vatRegistrationNo: `${x.NIF}`, // CIF/NIF
      invoiceStartDate: `${formattedDateDayStart}`, // Fecha inicio facturación
      invoiceEndDate: `${formattedDateDayEnd}`, // Fecha fin facturación
      salesLinesBuffer: [], // Array vacío para las líneas de ventas
    };

    let countLines = 1;
    let changetLocationCode = false;
    for (let i = 0; i < datosPlanos.length; i++) {
      x = datosPlanos[i];
      let date = new Date(x.FECHA);
      let day = date.getDate().toString().padStart(2, '0'); // Asegura dos dígitos
      let month = (date.getMonth() + 1).toString().padStart(2, '0'); // Meses van de 0 a 11
      let shortYear = date.getFullYear().toString().slice(-2); // Obtiene los últimos dos dígitos del año
      let isoDate = date.toISOString().substring(0, 10);
      let formattedDateAlbaran = `${day}/${month}/${shortYear}`;
      if (this.extractNumber(x.TIENDA) != salesData.locationCode && !changetLocationCode) {
        salesData.no = `T--000_${formattedDate}_RM${n}`;
        salesData.externalDocumentNo = `T--000_${formattedDate}_RM${n}`;
        salesData.locationCode = '000';
        salesData.shipToCode = '000';
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
      let salesLine = {
        documentNo: `${salesData.no}`,
        type: `Item`,
        no: `${x.PLU}`,
        lineNo: countLines,
        description: `${x.ARTICULO}`,
        quantity: parseFloat(x.CANTIDAD),
        shipmentDate: `${isoDate}`,
        lineTotalAmount: parseFloat(x.PRECIO),
        vatProdPostingGroup: `${x.IVA}`,
        unitPrice: parseFloat(x.precioUnitario),
        locationCode: `${this.extractNumber(x.TIENDA)}`,
      };
      countLines++;
      importTotal += parseFloat(x.PRECIO);
      salesData.salesLinesBuffer.push(salesLine);
    }
    //salesData.remainingAmount = Number(importTotal.toFixed(2));
    // console.log(salesData)
    await this.postToApi(tipo, salesData, tenant, entorno, companyID, token);

    // ---------------------------------Abono recap manual---------------------------------
    arrayDatos = [];

    //console.log(`Mes inicial: ${monthInicial}, Mes final: ${mesFinal}`);
    for (let i = parseInt(monthInicial, 10); i <= parseInt(mesFinal, 10); i++) {
      const month = String(i).padStart(2, '0'); // Asegura que el mes tenga dos dígitos
      let sqlQ = `
      DECLARE @Cliente INT = ${parseInt(client, 10)};
                      
      DECLARE @TotalConIVA DECIMAL(18, 2);
      DECLARE @TotalSinIVA DECIMAL(18, 2);

      -- Calcular total con IVA
      SELECT @TotalConIVA = SUM(V.Import)
      FROM [v_venut_${year}-${month}] V
      LEFT JOIN articles A ON A.codi = V.plu
      LEFT JOIN TipusIva I ON I.Tipus = A.TipoIva
      LEFT JOIN ConstantsClient CC ON @Cliente = CC.Codi AND variable = 'CFINAL' AND valor != ''
      LEFT JOIN Clients C ON CC.codi = C.codi
      LEFT JOIN clients CB ON V.botiga = CB.codi
      WHERE V.otros LIKE '%' + CC.valor + '%'
        AND V.Num_tick IN (${TicketsString});

      SELECT @TotalSinIVA = 
          SUM(V.Import / (1 + (ISNULL(I.Iva, 10) / 100.0)))
      FROM [v_venut_${year}-${month}] V
      LEFT JOIN articles A ON A.codi = V.plu
      LEFT JOIN TipusIva I ON I.Tipus = A.TipoIva
      LEFT JOIN ConstantsClient CC ON @Cliente = CC.Codi AND variable = 'CFINAL' AND valor != ''
      LEFT JOIN Clients C ON CC.codi = C.codi
      LEFT JOIN clients CB ON V.botiga = CB.codi
      WHERE V.otros LIKE '%' + CC.valor + '%'
        AND V.Num_tick IN (${TicketsString});

      SELECT 
          V.PLU AS PLU, 
          A.nom AS ARTICULO, 
          SUM(V.Quantitat) AS CANTIDAD_TOTAL, 
          SUM(V.Import) AS IMPORTE_TOTAL, 
          MIN(V.data) AS FECHA_PRIMERA_VENTA, 
          MAX(V.data) AS FECHA_ULTIMA_VENTA, 
          I.Iva AS IVA, 
          CB.nom AS TIENDA, 
          CB.Nif AS NIFTIENDA, 
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
        AND V.Num_tick IN (${TicketsString})
      GROUP BY 
          V.PLU, 
          A.nom, 
          I.Iva, 
          CB.nom, 
          CB.Nif, 
          C.NIF
      HAVING SUM(V.Quantitat) > 0
      ORDER BY MIN(V.data);`;
    //   console.log(sqlQ);
      let data = await this.sql.runSql(sqlQ, database);
      console.log(data.recordset);
      arrayDatos.push(data.recordset);
      console.log(`Mes ${month} - ${data.recordset.length} datos encontrados`);
    }
    if (arrayDatos.length === 0) {
      throw new Error('No se encontraron facturas en la base de datos.');
    }
    datosPlanos = arrayDatos.flat();
    //console.log(datosPlanos.length);

    x = datosPlanos[0];
    fechas = datosPlanos.map((item) => new Date(item.FECHA_PRIMERA_VENTA));

    // Extraer todas las fechas de última venta
    let fechasUltimaVenta = datosPlanos.map((row) => new Date(row.FECHA_ULTIMA_VENTA));

    // Determinar la fecha más antigua y más reciente correctamente
    fechaMasAntigua = new Date(Math.min(...fechas.map((f) => f.getTime()))); // Fecha más antigua
    fechaMasNueva = new Date(Math.max(...fechas.map((f) => f.getTime()))); // Fecha más reciente

    // Extraer día, mes y año en el formato adecuado
    shortYear = String(year).slice(-2);
    monthFormatted = `${monthInicial}-${shortYear}`;
    day = fechaMasAntigua.getDate().toString().padStart(2, '0'); // Asegura que el día tenga dos dígitos
    monthInicial = monthInicial.padStart(2, '0'); // Asegura que el mes tenga dos dígitos
    formattedDate = `${day}-${monthFormatted}`; // Factura más antigua (para externalDocumentNo)
    formattedDateDayStart = fechaMasAntigua.toISOString().substring(0, 10); // Factura más antigua (YYYY-MM-DD)
    formattedDateDayEnd = fechaMasNueva.toISOString().substring(0, 10); // Factura más reciente (YYYY-MM-DD)

    importTotal = 0;
    salesData = {
      no: `${x.TIENDA.substring(0, 6)}_${formattedDate}_ARM${n}`, // Nº factura
      documentType: 'Credit_x0020_Memo', // Tipo de documento
      dueDate: `${formattedDateDayEnd}`, // Fecha vencimiento
      externalDocumentNo: `${x.TIENDA.substring(0, 6)}_${formattedDate}_ARM${n}`, // Nº documento externo
      locationCode: `${this.extractNumber(x.TIENDA)}`, // Cód. almacén
      orderDate: `${formattedDateDayEnd}`, // Fecha pedido
      postingDate: `${formattedDateDayEnd}`, // Fecha registro
      recapInvoice: false, // Factura recap //false
      manualRecapInvoice: true, // Factura manual
      remainingAmount: parseFloat(x.TOTAL.toFixed(2)), // Precio total incluyendo IVA por factura
      amountExclVat: parseFloat(x.TotalSinIVA.toFixed(2)), // Precio total sin IVA por factura
      shipToCode: `${this.extractNumber(x.TIENDA).toUpperCase()}`, // Cód. dirección envío cliente
      storeInvoice: false, // Factura tienda
      vatRegistrationNo: `${x.NIF}`, // CIF/NIF
      invoiceStartDate: `${formattedDateDayStart}`, // Fecha inicio facturación
      invoiceEndDate: `${formattedDateDayEnd}`, // Fecha fin facturación
      salesLinesBuffer: [], // Array vacío para las líneas de ventas
    };
    countLines = 1;
    changetLocationCode = false;
    for (let i = 0; i < datosPlanos.length; i++) {
      x = datosPlanos[i];
      let date = new Date(x.FECHA_PRIMERA_VENTA);
      let isoDate = date.toISOString().substring(0, 10);
      if (this.extractNumber(x.TIENDA) != salesData.locationCode && !changetLocationCode) {
        salesData.no = `T--000_${formattedDate}_ARM${n}`;
        salesData.externalDocumentNo = `T--000_${formattedDate}_ARM${n}`;
        salesData.locationCode = '000';
        salesData.shipToCode = '000';
        changetLocationCode = true;
      }
      let salesLine = {
        documentNo: `${salesData.no}`,
        type: `Item`,
        no: `${x.PLU}`,
        lineNo: countLines,
        description: `${x.ARTICULO}`,
        quantity: parseFloat(x.CANTIDAD_TOTAL),
        shipmentDate: `${isoDate}`,
        lineTotalAmount: parseFloat(x.IMPORTE_TOTAL),
        vatProdPostingGroup: `${x.IVA}`,
        unitPrice: parseFloat(x.precioUnitario),
        locationCode: `${this.extractNumber(x.TIENDA)}`,
      };
      countLines++;

      importTotal += parseFloat(x.IMPORTE_TOTAL);
      salesData.salesLinesBuffer.push(salesLine);
    }
    //salesData.remainingAmount = Number(importTotal.toFixed(2));
    // console.log(salesData)
    await this.postToApi(tipo, salesData, tenant, entorno, companyID, token);

    return true;
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
