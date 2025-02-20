import { Injectable } from '@nestjs/common';
import { getTokenService } from '../conection/getToken.service';
import { runSqlService } from 'src/conection/sqlConection.service';
import { itemsService } from 'src/items/items.service';
import { customersService } from 'src/customers/customers.service';
import { locationsService } from 'src/locations/locations.service';
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
    private locations: locationsService,
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
      console.log(`Rango de num_tick entre ${horaAnterior} y ${horaActual}`);

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
        i.iva as Iva,
        CASE 
            WHEN v.Tipus_venta = 'V' THEN 0 
            WHEN v.Tipus_venta LIKE 'Desc_%' THEN CAST(SUBSTRING(v.Tipus_venta, 6, LEN(v.Tipus_venta) - 5) AS INT) 
            ELSE NULL 
        END AS descuento
        FROM [v_venut_${year}-${month}] v 
        LEFT JOIN clients c ON v.botiga = c.codi
        LEFT JOIN articles a ON v.plu = a.codi
        LEFT JOIN articles_zombis az ON v.plu = az.codi AND a.codi IS NULL
        LEFT JOIN tipusiva_historial i ON COALESCE(a.TipoIva, az.TipoIva) = i.Tipus
          AND v.data >= COALESCE(i.Desde, '1900-01-01')
          AND (i.Hasta IS NULL OR v.data <= i.Hasta)
        WHERE v.botiga = ${botiga} 
          AND DAY(v.data) = ${day} 
          AND CONVERT(TIME, v.data) BETWEEN '${horaAnterior}' AND '${horaActual}')
        SELECT ClientCodi, nombreTienda, MIN(CONVERT(DATE, data)) AS Data,Plu,round (precioUnitario,3) AS UnitPrice, SUM(quantitat) AS Quantitat,Iva,Descuento
        FROM PrecioUnitarioCalculado puc
        GROUP BY ClientCodi, nombreTienda, plu, precioUnitario, descuento, iva
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
      const customerId = await this.customers.getCustomerFromAPI(companyID, database, `22222222T`, client_id, client_secret, tenant, entorno);

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
        const salesInvoiceData2 = {
          LocationCode: `${x.ClientCodi}`,
        };
        const ventas = await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices`, salesInvoiceData, {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        });

        ventasID_BC = ventas.data.id;
        await this.locations.getLocationFromAPI(companyID, database, x.ClientCodi, client_id, client_secret, tenant, entorno);
        await axios.patch(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/salesHeader(${ventasID_BC})`, salesInvoiceData2, {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
            'If-Match': '*',
          },
        });
      } else {
        ventasID_BC = res.data.value[0].id;
      }

      try {
        for (const line of sqlVentas.recordset) {
          const itemAPI = await this.items.getItemFromAPI(companyID, database, line.Plu, client_id, client_secret, tenant, entorno);

          if (!itemAPI) {
            console.warn(`Item no encontrado para Plu: ${line.Plu}`);
            continue;
          }

          let lineData = {
            documentId: ventasID_BC,
            itemId: itemAPI,
            lineType: 'Item',
            quantity: line.Quantitat,
            unitPrice: line.UnitPrice,
            discountPercent: line.Descuento,
            taxCode: `IVA${line.Iva}`,
          };

          const getURL = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices(${ventasID_BC})/salesInvoiceLines?$filter=lineObjectNumber eq '${line.Plu}' and quantity eq ${line.Quantitat} and unitPrice eq ${line.UnitPrice}`;

          const res = await axios.get(getURL, {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          });

          if (!res.data || res.data.value.length === 0) {
            console.log('Línea de factura no encontrada, creando nueva línea para el producto', line.Plu);
            await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices(${ventasID_BC})/salesInvoiceLines`, lineData, {
              headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json',
              },
            });
          } else {
            console.log('Línea de factura encontrada, actualizando línea existente para el producto', line.Plu);
            const existingLine = res.data.value[0];
            const etag = existingLine['@odata.etag'];
            await axios.patch(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices(${ventasID_BC})/salesInvoiceLines(${existingLine.id})`, lineData, {
              headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json',
                'If-Match': etag,
              },
            });
          }
        }
      } catch (error) {
        console.error('Error en synchronizeSalesFacturasLines:', error.response?.data || error.message);
      }
      console.log(`Sincronizando ventas ${numFactura} ... -> ${i + 1}/${sqlHora.recordset.length} --- ${((i + 1 / sqlHora.recordset.length) * 100).toFixed(2)}% `);
    }
    return true;
  }
}
