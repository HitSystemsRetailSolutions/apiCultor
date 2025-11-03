import { Injectable } from '@nestjs/common';
import { getTokenService } from 'src/connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConnection.service';
import axios from 'axios';

@Injectable()
export class salesSilemaRecapManualService {
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) { }

  async getDatosSalesSilemaRecapitulativaManual(idFactura: string[], tabla: string, companyID, database, client_id: string, client_secret: string, tenant: string, entorno: string, manual) {
    for (let i = 0; i < idFactura.length; i++) {
      let sqlQ = `SELECT * FROM [FACTURACIO_${tabla}_IVA] WHERE idFactura = '${idFactura[i]}'`;
      let data = await this.sql.runSql(sqlQ, database);

      if (data.recordset.length === 0) {
        console.log(`No se encontraron datos para la factura ID: ${idFactura[i]}`);
        continue;
      }

      let client = data.recordset[0].ClientCodi;
      let dataInici = data.recordset[0].DataInici.toISOString().split('T')[0];
      let dataFi = data.recordset[0].DataFi.toISOString().split('T')[0];
      let dataFactura = data.recordset[0].DataFactura.toISOString().split('T')[0];

      const tablaYear = tabla.split('-')[0];
      let sqlTickets = `SELECT NumTick FROM Tiquets_Recapitulativa_${tablaYear} WHERE IdFactura = '${idFactura[i]}' order by NumTick`;
      let dataTickets = await this.sql.runSql(sqlTickets, database);

      if (dataTickets.recordset.length === 0) {
        console.log(`No se encontraron tickets para la factura ID: ${idFactura[i]}`);
        continue;
      }
      let TicketsArray: Array<String> = [];
      for (let j = 0; j < dataTickets.recordset.length; j++) {
        TicketsArray.push(dataTickets.recordset[j].NumTick);
      }

      await this.syncSalesSilemaRecapitulativaManual(TicketsArray, client, dataInici, dataFi, dataFactura, companyID, database, client_id, client_secret, tenant, entorno, manual, idFactura[i]);
    }
    return true;
  }

  async syncSalesSilemaRecapitulativaManual(TicketsArray: Array<String>, client, dataInici, dataFi, dataFactura, companyID, database, client_id: string, client_secret: string, tenant: string, entorno: string, manual, idFactura: string) {
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
              CASE cc1.valor WHEN '4' THEN 'CLI_TRANSF' ELSE '' END AS FORMAPAGO,
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
          LEFT JOIN ConstantsClient cc1 ON cc1.codi = @Cliente AND cc1.variable = 'FormaPagoLlista'
          WHERE V.Quantitat > 0
            AND V.num_tick IN (${TicketsString})
      )
      SELECT
          Fecha,
          Tienda AS TIENDA,
          NifTienda,
          NIF,
          FORMAPAGO,
          num_tick AS TICKET,
          plu AS PLU,
          Articulo AS ARTICULO,
          Cantidad,
          IvaPct,
          ROUND(PrecioUnitario, 5) AS unitPrice,
          ROUND(PrecioUnitarioSinIVA, 5) AS unitPriceExcIVA,
          ROUND(ImportSinIVA * IvaPct / 100.0, 5) AS IVA,
          Precio AS importe,
          ROUND(ImportSinIVA, 5) AS importeSinIVA,
          ROUND(SUM(ImportSinIVA) OVER (), 5) AS TotalSinIVA,
          ROUND(SUM(ImportSinIVA * IvaPct / 100.0) OVER (), 5) AS TotalIVA,
          SUM(Precio) OVER () AS TOTAL,
          Pagado,
          (SELECT TOP 1 TipoFactura FROM CTE_TipoFactura) AS TipoFactura
      FROM CTE_Base
      ORDER BY 
      CASE WHEN (SELECT TOP 1 TipoFactura FROM CTE_TipoFactura) = 'SETMANAL' THEN Articulo END,
      CASE WHEN (SELECT TOP 1 TipoFactura FROM CTE_TipoFactura) = 'SETMANAL' THEN Fecha END,
      CASE WHEN (SELECT TOP 1 TipoFactura FROM CTE_TipoFactura) <> 'SETMANAL' THEN Fecha END;`;
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
    const locationCode = codis.length > 1 ? 'REC' : codis[0];
    const locationCodeDocNo = codis.length > 1 ? 'T--REC' : x.TIENDA.substring(0, 6);

    // Calculamos `n` basado en las facturas recapitulativas existentes
    let url
    if (manual === 'true' || manual === true) {
      url = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/salesHeadersBuffer?$filter=contains(no,'${locationCodeDocNo}_${fechaFormateada}_RM')`;
    } else {
      url = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/salesHeadersBuffer?$filter=contains(no,'${locationCodeDocNo}_${fechaFormateada}_R')`;
    }
    let n = (await this.getNumberOfRecap(url, token)) || 1;
    let paymentMethodCode = `${x.FORMAPAGO}`;
    let salesData
    if (manual === 'true' || manual === true) {
      salesData = {
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
        debtorIntercompany: x.Pagado === 0 && x.TipoFactura === 'SETMANAL' ? true : false,
        debtorRecap: x.Pagado === 0 && x.TipoFactura !== 'SETMANAL' ? true : false,
        salesLinesBuffer: [], // Array vacío para las líneas de ventas
      };
    } else {
      salesData = {
        no: `${locationCodeDocNo}_${fechaFormateada}_R${n}`, // Nº factura
        documentType: 'Invoice', // Tipo de documento
        dueDate: `${dataFi}`, // Fecha vencimiento
        externalDocumentNo: `${locationCodeDocNo}_${fechaFormateada}_R${n}`, // Nº documento externo
        locationCode: `${this.extractNumber(x.TIENDA)}`, // Cód. almacén
        orderDate: `${dataFi}`, // Fecha pedido
        postingDate: `${dataFi}`, // Fecha registro
        recapInvoice: true, // Factura recap //false
        remainingAmount: parseFloat(x.TOTAL.toFixed(2)), // Precio total incluyendo IVA por factura
        amountExclVat: parseFloat(x.TotalSinIVA.toFixed(2)), // Precio total sin IVA por factura
        vatAmount: parseFloat((x.TOTAL - x.TotalSinIVA).toFixed(2)), // IVA total por factura
        paymentMethodCode: `${paymentMethodCode}`, // Cód. forma de pago
        shipToCode: '', // Cód. dirección envío cliente
        storeInvoice: false, // Factura tienda
        vatRegistrationNo: `${x.NIF}`, // CIF/NIF
        invoiceStartDate: `${dataInici}`, // Fecha inicio facturación
        invoiceEndDate: `${dataFi}`, // Fecha fin facturación
        salesLinesBuffer: [], // Array vacío para las líneas de ventas
      };
    }
    let countLines = 1;
    let lastAlbaranDescription = '';
    for (let i = 0; i < datosPlanos.length; i++) {
      x = datosPlanos[i];
      let date = new Date(x.Fecha);
      let isoDate = date.toISOString().substring(0, 10);
      let partesAlbaran = isoDate.split('-');
      let formattedDateAlbaran = `${partesAlbaran[2]}/${partesAlbaran[1]}/${partesAlbaran[0]}`;
      let currentAlbaranDescription = `albaran nº ${x.TICKET} ${formattedDateAlbaran}`;
      if (salesData.debtorIntercompany === false || salesData.debtorIntercompany === undefined) {
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
    if (manual === 'false' || manual === false || x.Pagado === 0) {
      await this.postToApi(tipo, salesData, tenant, entorno, companyID, token, database, idFactura);
      return true;
    } else {
      await this.postToApi(tipo, salesData, tenant, entorno, companyID, token);
    }

    // ---------------------------------Abono recap manual---------------------------------
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
    await this.postToApi(tipo, salesData, tenant, entorno, companyID, token, database, idFactura);

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

  async postToApi(tipo, salesData, tenant, entorno, companyID, token, database?: string, idFactura?: string) {
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

        if (database && idFactura) {
          await this.deleteControlTableEntry(database, idFactura);
          console.log(`🗑️ Registro eliminado de recordsFacturacioBC para la factura ${idFactura}`);
        }
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
  async deleteControlTableEntry(database: string, idFactura: string) {
    let sqlDelete = `DELETE FROM recordsFacturacioBC WHERE IdFactura = '${idFactura}'`;
    await this.sql.runSql(sqlDelete, database);
  }
}
