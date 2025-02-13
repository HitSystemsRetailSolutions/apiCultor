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
    private tokenService: getTokenService,
    private sqlService: runSqlService,
    private items: itemsService,
    private customers: customersService,
  ) {}

  async syncVentas(day, month, year, companyID, database, botiga, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let token = await this.tokenService.getToken2(client_id, client_secret, tenant);
    const sqlHora = await this.sqlService.runSql(
      `select CONVERT(VARCHAR(8), CONVERT(Time, Data), 108) AS hora, Import from [V_Moviments_${year}-${month}] where botiga = ${botiga} and Tipus_moviment = 'Z' and day(data)=${day} group by Data, Import order by Data`,
      database,
    );
    let horaAnterior = '00:01:00';
    for (let i = 0; i < sqlHora.recordset.length; i++) {
      const horaActual = sqlHora.recordset[i].hora;
      const sqlRangoTicket = await this.sqlService.runSql(
        `SELECT MAX(num_tick) AS maximo, MIN(num_tick) AS minimo FROM [v_venut_${year}-${month}] where botiga=${botiga} and day(data)=${day} and CONVERT(TIME, data) BETWEEN '${horaAnterior}' AND '${horaActual}'`,
        database,
      );
      console.log(`Rango de num_tick entre ${horaAnterior} y ${horaActual}:`);
      console.log(sqlRangoTicket.recordset);

      const sqlVentas = await this.sqlService.runSql(
        `;WITH PrecioUnitarioCalculado AS (
        SELECT  
        v.plu,
        v.Import / NULLIF(v.Quantitat, 0) AS precioUnitario,
        v.quantitat,
        v.data,
        v.Tipus_venta,
        c.codi AS ClientCodi,
        c.nom as nombreTienda,
        CASE 
            WHEN v.Tipus_venta = 'V' THEN 0 
            WHEN v.Tipus_venta LIKE 'Desc_%' THEN CAST(SUBSTRING(v.Tipus_venta, 6, LEN(v.Tipus_venta) - 5) AS INT) 
            ELSE NULL 
        END AS descuento
    FROM [v_venut_${year}-${month}] v 
    LEFT JOIN clients c ON v.botiga = c.codi
    WHERE v.botiga = ${botiga} 
      AND DAY(v.data) = ${day} 
      AND CONVERT(TIME, v.data) BETWEEN '${horaAnterior}' AND '${horaActual}')
    SELECT ClientCodi, nombreTienda, MIN(CONVERT(DATE, data)) AS Data,Plu,round (precioUnitario,3) AS UnitPrice, SUM(quantitat) AS Quantitat,Descuento
    FROM PrecioUnitarioCalculado puc
    GROUP BY ClientCodi, nombreTienda, plu, precioUnitario, descuento
    order by plu,Quantitat`,
        database,
      );

      horaAnterior = horaActual;

      if (sqlVentas.recordset.length == 0) {
        console.log('No hay ventas');
        return false;
      }
      const x = sqlVentas.recordset[0];
      const datePart = x.Data.toISOString().split('T')[0];
      const numFactura = `${x.nombreTienda}_T${i + 1}_${sqlRangoTicket.recordset[0].minimo}-${sqlRangoTicket.recordset[0].maximo}`;

      console.log(`-------------------SINCRONIZANDO VENTAS ${numFactura} -----------------------`);
      const customerId = await this.customers.getCustomerFromAPI(companyID, database, `${x.ClientCodi}-Tienda`, client_id, client_secret, tenant, entorno);
      console.log('customerId', customerId);

      let res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices?$filter=externalDocumentNumber eq '${numFactura}'`, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      });

      if (!res.data) throw new Error('Failed to obtain sales invoice');
      let ventasID_BC = '';
      if (res.data.value.length === 0) {
        const salesInvoiceData = {
          externalDocumentNumber: numFactura,
          invoiceDate: datePart,
          postingDate: datePart,
          customerId: customerId,
        };
        console.log('salesInvoiceData', salesInvoiceData);
        const ventas = await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices`, salesInvoiceData, {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        });
        ventasID_BC = ventas.data.id;
      } else {
        ventasID_BC = res.data.value[0].id;
      }

      try {
        for (const line of sqlVentas.recordset) {
          console.log(`Sincronizando línea de factura para el producto: ${line.Plu}`);
          const itemAPI = await this.items.getItemFromAPI(companyID, database, line.Plu, client_id, client_secret, tenant, entorno);
          let lineData;
          if (itemAPI && itemAPI.data?.value?.length > 0) {
            lineData = {
              documentId: ventasID_BC,
              itemId: itemAPI.data.value[0].id,
              lineType: 'Item',
              quantity: line.Quantitat,
              unitPrice: line.UnitPrice,
              discountPercent: line.Descuento,
              taxCode: itemAPI.data.value[0].VATProductPostingGroup,
            };
          }
          const res = await axios.get(
            `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices(${ventasID_BC})/salesInvoiceLines?$filter=lineObjectNumber eq '${line.Plu}' and quantity eq ${line.Quantitat} and unitPrice eq ${line.UnitPrice}`,
            {
              headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json',
              },
            },
          );

          if (!res.data) throw new Error('Failed to get factura line');

          if (res.data.value.length === 0) {
            console.log('Línea de factura no encontrada, creando nueva línea...');
            await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices(${ventasID_BC})/salesInvoiceLines`, lineData, {
              headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json',
              },
            });
          } else {
            console.log('Línea de factura encontrada, actualizando línea existente...');
            const etag = res.data.value[0]['@odata.etag'];
            await axios.patch(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices(${ventasID_BC})/salesInvoiceLines(${res.data.value[0].id})`, lineData, {
              headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json',
                'If-Match': etag,
              },
            });
          }
        }
      } catch (error) {
        console.error('Error en synchronizeSalesFacturasLines:', error.message);
      }
    }
    return true;
  }
}
