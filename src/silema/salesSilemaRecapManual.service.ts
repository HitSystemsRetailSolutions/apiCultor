import { Injectable } from '@nestjs/common';
import { getTokenService } from '../connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConection.service';
import axios from 'axios';

@Injectable()
export class salesSilemaRecapManualService {
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) { }

  async syncSalesSilemaRecapitulativaManual(TicketsArray: Array<String>, client, dataInici, dataFi, dataFactura, companyID, database, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    let tipo = 'syncSalesSilemaRecapitulativaManual';
    // let sqlQFranquicia = `SELECT * FROM constantsClient WHERE Codi = ${botiga} and Variable = 'Franquicia'`;
    // let queryFranquicia = await this.sql.runSql(sqlQFranquicia, database);
    // if (queryFranquicia.recordset.length >= 1) return;
    const TicketsString = TicketsArray.join(',');
    let arrayDatos = [];
    let totalBase = 0;
    let totalCuota = 0;
    let totalConIVA = 0;
    let monthInicial = dataInici.substring(5, 7);
    let monthFinal = dataFi.substring(5, 7);
    let year = dataInici.substring(0, 4);
    //console.log(`Mes inicial: ${monthInicial}, Mes final: ${monthFinal}`);
    for (let i = parseInt(monthInicial, 10); i <= parseInt(monthFinal, 10); i++) {
      const month = String(i).padStart(2, '0'); // Asegura que el mes tenga dos dígitos
      let sqlQ = `
      DECLARE @Cliente INT = ${parseInt(client, 10)};

      WITH CTE_Const AS (
          SELECT
              CC.valor COLLATE Modern_Spanish_CI_AS AS CFinal,
              C.NIF
          FROM ConstantsClient CC
          JOIN Clients C
              ON CC.Codi = C.Codi
          WHERE CC.Codi = @Cliente
            AND CC.variable COLLATE Modern_Spanish_CI_AS = 'CFINAL'
            AND CC.valor COLLATE Modern_Spanish_CI_AS <> ''
      ),
       CTE_TipoFactura AS (
            SELECT valor AS TipoFactura
            FROM configuraFacturaClient
            WHERE nom = 'TIPUSFACTURA'
              AND client = @Cliente
      ),
      CTE_Base AS (
          SELECT
              V.num_tick,
              V.plu,
              A.nom AS Articulo,
              V.Quantitat AS Cantidad,
              V.data AS Fecha,
              V.Import AS Precio,
              I.Iva AS IvaPct,
              CB.nom AS Tienda,
              CB.Nif AS NifTienda,
              CTE.NIF,
              V.Import / (1.0 + I.Iva / 100.0) AS ImportSinIVA,
              V.Import / NULLIF(V.Quantitat, 0) AS PrecioUnitario,
              (V.Import / NULLIF(V.Quantitat, 0)) / (1.0 + I.Iva / 100.0) AS PrecioUnitarioSinIVA,
              CASE 
                WHEN EXISTS (
                    SELECT 1
                    FROM [v_moviments_${year}-${month}] M
                    WHERE M.botiga = V.botiga
                      AND M.motiu = 'Deute client: ' + CAST(CAST(V.num_tick AS bigint) AS nvarchar(20))
                ) THEN 0  
                ELSE 1  
              END AS Pagado
          FROM [v_venut_${year}-${month}] V
          INNER JOIN CTE_Const CTE
              ON V.otros COLLATE Modern_Spanish_CI_AS LIKE '%' + CTE.CFinal + '%' COLLATE Modern_Spanish_CI_AS
          LEFT JOIN articles A
              ON A.codi = V.plu
          LEFT JOIN TipusIva I
              ON I.Tipus = A.TipoIva
          LEFT JOIN clients CB
              ON CB.codi = V.botiga
          WHERE V.Quantitat > 0
            AND V.num_tick IN (${TicketsString})
      )
      SELECT
          Fecha,
          Tienda AS TIENDA,
          NifTienda,
          NIF,
          num_tick AS TICKET,
          plu AS PLU,
          Articulo AS ARTICULO,
          Cantidad,
          IvaPct,
          ROUND(PrecioUnitario, 3) AS unitPrice,
          ROUND(PrecioUnitarioSinIVA, 3) AS unitPriceExcIVA,
          ROUND(ImportSinIVA * IvaPct / 100.0, 3) AS IVA,
          Precio AS importe,
          ROUND(ImportSinIVA, 3) AS importeSinIVA,
          ROUND(SUM(ImportSinIVA) OVER (), 3) AS TotalSinIVA,
          ROUND(SUM(ImportSinIVA * IvaPct / 100.0) OVER (), 3) AS TotalIVA,
          SUM(Precio) OVER () AS TOTAL,
          Pagado,
          (SELECT TOP 1 TipoFactura FROM CTE_TipoFactura) AS TipoFactura
      FROM CTE_Base
      ORDER BY Fecha;`;
      // console.log(sqlQ);
      let data = await this.sql.runSql(sqlQ, database);
      arrayDatos.push(data.recordset);
      if (data.recordset.length > 0) {
        const rawBase = data.recordset[0].TotalSinIVA;
        const rawCuota = data.recordset[0].TotalIVA;

        totalBase += rawBase;
        totalCuota += rawCuota;
        totalBase = Math.round(totalBase * 1000) / 1000;
        totalCuota = Math.round(totalCuota * 1000) / 1000;
      }

      console.log(`Mes ${month} - ${data.recordset.length} datos encontrados`);
    }
    totalBase = Math.round(totalBase * 100) / 100;
    totalCuota = Math.round(totalCuota * 100) / 100;
    totalConIVA = totalBase + totalCuota;
    if (arrayDatos.length === 0) {
      throw new Error('No se encontraron facturas en la base de datos.');
    }
    let datosPlanos = arrayDatos.flat();
    //console.log(datosPlanos.length);

    let x = datosPlanos[0];

    let partes = dataFactura.split('-');
    let fechaFormateada = `${partes[2]}-${partes[1]}-${partes[0].toString().slice(-2)}`;
    const codis = Array.from(new Set(datosPlanos.map((x) => this.extractNumber(x.TIENDA))));
    const locationCode = codis.length > 1 ? '000' : codis[0];
    const locationCodeDocNo = codis.length > 1 ? 'T--000' : x.TIENDA.substring(0, 6);

    // Calculamos `n` basado en las facturas recapitulativas existentes
    let url = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/salesHeadersBuffer?$filter=contains(no,'${locationCodeDocNo}_') and contains(no,'${fechaFormateada}_RM')`;
    let n = (await this.getNumberOfRecap(url, token)) || 1;

    let salesData = {
      no: `${locationCodeDocNo}_${fechaFormateada}_RM${n}`, // Nº factura
      documentType: 'Invoice', // Tipo de documento
      dueDate: `${dataFi}`, // Fecha vencimiento
      externalDocumentNo: `${locationCodeDocNo}_${fechaFormateada}_RM${n}`, // Nº documento externo
      locationCode: `${locationCode}`, // Cód. almacén
      orderDate: `${dataInici}`, // Fecha pedido
      postingDate: `${dataFactura}`, // Fecha registro
      recapInvoice: false, // Factura recap //false
      manualRecapInvoice: true, // Factura manual
      remainingAmount: totalConIVA, // Precio total incluyendo IVA por factura
      amountExclVat: totalBase, // Precio total sin IVA por factura
      vatAmount: totalCuota, // IVA total por factura
      storeInvoice: false, // Factura tienda
      vatRegistrationNo: `${x.NIF}`, // CIF/NIF
      invoiceStartDate: `${dataInici}`, // Fecha inicio facturación
      invoiceEndDate: `${dataFi}`, // Fecha fin facturación
      documentDate: `${dataInici}`, // Fecha de documento
      shipToCode: '',
      debtorIntercompany: x.TipoFactura === 'SETMANAL' ? true : false,
      debtorRecap: x.Pagado === 0 ? true : false,
      salesLinesBuffer: [], // Array vacío para las líneas de ventas
    };

    let countLines = 1;
    let lastAlbaranDescription = '';
    for (let i = 0; i < datosPlanos.length; i++) {
      x = datosPlanos[i];
      let date = new Date(x.Fecha);
      let isoDate = date.toISOString().substring(0, 10);
      let partesAlbaran = isoDate.split('-');
      let formattedDateAlbaran = `${partesAlbaran[2]}/${partesAlbaran[1]}/${partesAlbaran[0]}`;
      let currentAlbaranDescription = `albaran nº ${x.TICKET} ${formattedDateAlbaran}`;

      if (currentAlbaranDescription !== lastAlbaranDescription) {
        let salesLineAlbaran = {
          documentNo: `${salesData.no}`,
          lineNo: countLines,
          description: currentAlbaranDescription,
          quantity: 1,
          shipmentDate: `${isoDate}`,
          lineTotalAmount: 0,
          locationCode: `${this.extractNumber(x.TIENDA)}`,
        };
        countLines++;
        salesData.salesLinesBuffer.push(salesLineAlbaran);
        lastAlbaranDescription = currentAlbaranDescription;
      }
      x.IvaPct = `IVA${String(x.IvaPct).replace(/\D/g, '').padStart(2, '0')}`;
      if (x.IvaPct === 'IVA00') x.IvaPct = 'IVA0';
      let salesLine = {
        documentNo: `${salesData.no}`,
        type: `Item`,
        no: `${x.PLU}`,
        lineNo: countLines,
        description: `${x.ARTICULO}`,
        quantity: parseFloat(x.Cantidad),
        shipmentDate: `${isoDate}`,
        lineTotalAmount: parseFloat(x.importe),
        lineAmountExclVat: parseFloat(x.importeSinIVA),
        vatProdPostingGroup: `${x.IvaPct}`,
        unitPrice: parseFloat(x.unitPrice),
        unitPriceExclVat: parseFloat(x.unitPriceExcIVA),
        locationCode: `${this.extractNumber(x.TIENDA)}`,
      };
      countLines++;
      salesData.salesLinesBuffer.push(salesLine);
    }
    // console.log('factura:', salesData);
    await this.postToApi(tipo, salesData, tenant, entorno, companyID, token);
    if (x.Pagado === 0) {
      return true;
    }

    // ---------------------------------Abono recap manual---------------------------------
    // arrayDatos = [];

    //console.log(`Mes inicial: ${monthInicial}, Mes final: ${mesFinal}`);
    // for (let i = parseInt(monthInicial, 10); i <= parseInt(monthFinal, 10); i++) {
    //   const month = String(i).padStart(2, '0'); // Asegura que el mes tenga dos dígitos
    //   let sqlQ = `
    //   DECLARE @Cliente INT = ${parseInt(client, 10)};
    //   DECLARE @TotalSinIVA DECIMAL(18, 2);

    //   SELECT 
    //       @TotalSinIVA = SUM(V.Import / (1 + (ISNULL(I.Iva, 10) / 100.0)))
    //   FROM [v_venut_${year}-${month}] V
    //   LEFT JOIN articles A 
    //       ON A.codi = V.plu
    //   LEFT JOIN TipusIva I 
    //       ON I.Tipus = A.TipoIva
    //   LEFT JOIN ConstantsClient CC 
    //       ON @Cliente = CC.Codi
    //     AND CC.variable COLLATE Modern_Spanish_CI_AS = 'CFINAL'
    //     AND CC.valor COLLATE Modern_Spanish_CI_AS != ''
    //   LEFT JOIN Clients C 
    //       ON CC.codi = C.codi
    //   LEFT JOIN clients CB 
    //       ON V.botiga = CB.codi
    //   WHERE V.otros COLLATE Modern_Spanish_CI_AS LIKE '%' + CC.valor COLLATE Modern_Spanish_CI_AS + '%'
    //     AND V.num_tick IN (${TicketsString});

    //   SELECT 
    //       V.PLU AS PLU,
    //       A.nom AS ARTICULO,
    //       V.Quantitat AS CANTIDAD,
    //       V.data AS FECHA,
    //       V.Import AS PRECIO,
    //       I.Iva AS IVA,
    //       CB.nom AS TIENDA,
    //       C.NIF AS NIF,
    //       SUM(V.Import) OVER () AS TOTAL,
    //       ROUND(V.Import / NULLIF(V.Quantitat, 0), 5) AS precioUnitario,
    //       @TotalSinIVA AS TotalSinIVA
    //   FROM [v_venut_${year}-${month}] V
    //   LEFT JOIN articles A 
    //       ON A.codi = V.plu
    //   LEFT JOIN TipusIva I 
    //       ON I.Tipus = A.TipoIva
    //   LEFT JOIN ConstantsClient CC 
    //       ON @Cliente = CC.Codi
    //     AND CC.variable COLLATE Modern_Spanish_CI_AS = 'CFINAL'
    //     AND CC.valor COLLATE Modern_Spanish_CI_AS != ''
    //   LEFT JOIN Clients C 
    //       ON CC.codi = C.codi
    //   LEFT JOIN clients CB 
    //       ON V.botiga = CB.codi
    //   WHERE V.otros COLLATE Modern_Spanish_CI_AS LIKE '%' + CC.valor COLLATE Modern_Spanish_CI_AS + '%'
    //     AND V.num_tick IN (${TicketsString})
    //   GROUP BY 
    //       V.plu,
    //       A.nom,
    //       V.Quantitat,
    //       V.data,
    //       V.import,
    //       I.Iva,
    //       CB.nom,
    //       C.NIF,
    //       ROUND(V.Import / NULLIF(V.Quantitat, 0), 5)
    //   HAVING SUM(V.Quantitat) > 0
    //   ORDER BY V.data;`;
    //   // console.log(sqlQ);
    //   let data = await this.sql.runSql(sqlQ, database);
    //   arrayDatos.push(data.recordset);
    //   console.log(`Mes ${month} - ${data.recordset.length} datos encontrados`);
    // }
    // if (arrayDatos.length === 0) {
    //   throw new Error('No se encontraron facturas en la base de datos.');
    // }
    // datosPlanos = arrayDatos.flat();
    //console.log(datosPlanos.length);

    // x = datosPlanos[0];

    // salesData = {
    //   no: `${locationCodeDocNo}_${fechaFormateada}_ARM${n}`, // Nº factura
    //   documentType: 'Credit_x0020_Memo', // Tipo de documento
    //   dueDate: `${dataFi}`, // Fecha vencimiento
    //   externalDocumentNo: `${locationCodeDocNo}_${fechaFormateada}_ARM${n}`, // Nº documento externo
    //   locationCode: `${locationCode}`, // Cód. almacén
    //   orderDate: `${dataInici}`, // Fecha pedido
    //   postingDate: `${dataFactura}`, // Fecha registro
    //   recapInvoice: false, // Factura recap //false
    //   manualRecapInvoice: true, // Factura manual
    //   remainingAmount: totalConIVA, // Precio total incluyendo IVA por factura
    //   amountExclVat: totalBase, // Precio total sin IVA por factura
    //   vatAmount: totalCuota, // IVA total por factura
    //   storeInvoice: false, // Factura tienda
    //   vatRegistrationNo: `${x.NIF}`, // CIF/NIF
    //   invoiceStartDate: `${dataInici}`, // Fecha inicio facturación
    //   invoiceEndDate: `${dataFi}`, // Fecha fin facturación
    //   documentDate: `${dataInici}`, // Fecha de documento
    //   salesLinesBuffer: [], // Array vacío para las líneas de ventas
    // };
    salesData.no = `${locationCodeDocNo}_${fechaFormateada}_ARM${n}`;
    salesData.documentType = 'Credit_x0020_Memo';
    salesData.externalDocumentNo = `${locationCodeDocNo}_${fechaFormateada}_ARM${n}`;
    salesData.vatRegistrationNo = `${x.NifTienda}`;
    salesData.shipToCode = `${locationCode}`;
    salesData.salesLinesBuffer = [];

    countLines = 1;
    lastAlbaranDescription = '';

    for (let i = 0; i < datosPlanos.length; i++) {
      x = datosPlanos[i];
      let date = new Date(x.Fecha);
      let isoDate = date.toISOString().substring(0, 10);
      let partesAlbaran = isoDate.split('-');
      let formattedDateAlbaran = `${partesAlbaran[2]}/${partesAlbaran[1]}/${partesAlbaran[0]}`;
      let currentAlbaranDescription = `albaran nº ${x.TICKET} ${formattedDateAlbaran}`;

      if (currentAlbaranDescription !== lastAlbaranDescription) {
        let salesLineAlbaran = {
          documentNo: `${salesData.no}`,
          lineNo: countLines,
          description: currentAlbaranDescription,
          quantity: 1,
          shipmentDate: `${isoDate}`,
          lineTotalAmount: 0,
          locationCode: `${this.extractNumber(x.TIENDA)}`,
        };
        countLines++;
        salesData.salesLinesBuffer.push(salesLineAlbaran);
        lastAlbaranDescription = currentAlbaranDescription;
      }

      x.IvaPct = `IVA${String(x.IvaPct).replace(/\D/g, '').padStart(2, '0')}`;
      if (x.IvaPct === 'IVA00') x.IvaPct = 'IVA0';

      let salesLine = {
        documentNo: `${salesData.no}`,
        type: `Item`,
        no: `${x.PLU}`,
        lineNo: countLines,
        description: `${x.ARTICULO}`,
        quantity: parseFloat(x.Cantidad),
        shipmentDate: `${isoDate}`,
        lineTotalAmount: parseFloat(x.importe),
        lineAmountExclVat: parseFloat(x.importeSinIVA),
        vatProdPostingGroup: `${x.IvaPct}`,
        unitPrice: parseFloat(x.unitPrice),
        unitPriceExclVat: parseFloat(x.unitPriceExcIVA),
        locationCode: `${this.extractNumber(x.TIENDA)}`,
      };
      countLines++;
      salesData.salesLinesBuffer.push(salesLine);
    }
    // console.log('abono', salesData);
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
    let url1 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/salesHeadersBuffer?$filter=contains(no,'RM') and documentType eq '${salesData.documentType}' and 
    vatRegistrationNo eq '${salesData.vatRegistrationNo}' and amountExclVat eq ${salesData.amountExclVat} and postingDate eq ${salesData.postingDate} and locationCode eq '${salesData.locationCode}'`;

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
