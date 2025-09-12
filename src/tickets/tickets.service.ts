import { Injectable } from '@nestjs/common';
import { getTokenService } from '../connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConection.service';
import axios from 'axios';
import * as mqtt from 'mqtt';
import * as moment from 'moment-timezone';
import * as cliProgress from 'cli-progress';
import { locationsService } from 'src/locations/locations.service';

@Injectable()
export class ticketsService {
  private client = mqtt.connect({
    host: process.env.MQTT_HOST,
    username: process.env.MQTT_USER,
    password: process.env.MQTT_PASSWORD,
  });
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
    private locations: locationsService
  ) { }

  async syncTickets(companyID: string, database: string, client_id: string, client_secret: string, tenant: string, entorno: string, botiga: string[]) {
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    if (!token) {
      this.logError('Error al obtener el token', { client_id, tenant });
      return false;
    }
    for (const licencia of botiga) {

      let timestamp;
      let records = await this.sql.runSql(`SELECT * FROM records WHERE concepte = 'BC_Tickets_${licencia}'`, database);
      if (records.recordset.length > 0) {
        timestamp = new Date(records.recordset[0].TimeStamp).toISOString().slice(0, 19).replace('T', ' ');
      } else {
        const year = new Date().getFullYear();
        const month = (new Date().getMonth() + 1).toString().padStart(2, '0'); // Asegura que el mes tenga dos dígitos
        let tsResult = await this.sql.runSql(`SELECT MIN(Data) as timestamp FROM [v_venut_${year}-${month}] WHERE Botiga = ${licencia}`, database);
        timestamp = new Date(tsResult.recordset[0].timestamp).toISOString().slice(0, 19).replace('T', ' ');
        await this.sql.runSql(`INSERT INTO records (timestamp, concepte) VALUES ('${timestamp}', 'BC_Tickets_${licencia}')`, database);
      }
      let tickets;
      try {
        const timestampDate = new Date(timestamp);
        const now = new Date();
        const months = this.getMonthsBetween(timestampDate, now);
        const unionQueries = months
          .map((m) => `SELECT * FROM [v_venut_${m}]`)
          .join('\nUNION ALL\n');

        const query =
          `;WITH all_articles AS (
                SELECT Codi, Nom, TipoIva FROM articles
                UNION ALL
                SELECT Codi, Nom, TipoIva FROM articles_zombis
           ),
           v_venut_union AS (
             ${unionQueries}
           )
          SELECT 
            v.Botiga,
            v.Data,
            d.MEMO AS Dependenta,
            v.Num_tick,
            v.Plu,
            v.Quantitat,
            v.Import,
            ti.Iva,
            v.Tipus_venta,
            v.FormaMarcar,
            CASE
                WHEN v.otros LIKE '%tarjeta%' THEN 'Paytef'
                WHEN v.otros LIKE '%3g%' THEN '3g'
                ELSE 'Efectivo'
            END AS MetodoPago,
            c.nif AS NIF_Client
          FROM v_venut_union v
          LEFT JOIN Dependentes d ON d.Codi = v.Dependenta
          OUTER APPLY (
              SELECT
                  CASE 
                      WHEN CHARINDEX('[Id:', v.otros) > 0 
                          AND CHARINDEX(']', v.otros, CHARINDEX('[Id:', v.otros)) > 0
                      THEN SUBSTRING(
                              v.otros,
                              CHARINDEX('[Id:', v.otros) + 4,
                              CHARINDEX(']', v.otros, CHARINDEX('[Id:', v.otros)) 
                                  - CHARINDEX('[Id:', v.otros) - 4
                          )
                      ELSE NULL
                  END AS ClientCode
          ) extracted
          LEFT JOIN constantsclient cc ON cc.valor = extracted.ClientCode
          LEFT JOIN clients c ON c.codi = cc.codi
          LEFT JOIN all_articles a ON a.Codi = v.Plu
          LEFT JOIN TipusIva ti ON ti.Tipus = a.TipoIva
          WHERE v.data >= '${timestamp}' AND v.botiga = ${licencia}
          ORDER BY v.Data, v.Num_tick;
          `
        tickets = await this.sql.runSql(query, database);
      } catch (error) {
        this.logError(`❌ Error al ejecutar la consulta SQL en la base de datos '${database}'`, error);
        return false;
      }
      if (tickets.recordset.length == 0) {
        this.client.publish('/Hit/Serveis/Apicultor/Log', 'No hay registros de previsiones de ventas');
        console.warn(`⚠️ Advertencia: No se encontraron registros de previsiones de ventas`);
        continue;
      }
      const bar = new cliProgress.SingleBar({
        format: '⏳ Sincronizando día {dia} |{bar}| {percentage}% | {value}/{total} registros | ⏰ Tiempo restante: {eta_formatted}',
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
        barGlue: '',
        hideCursor: true
      });
      await this.locations.getLocationFromAPI(companyID, database, licencia, client_id, client_secret, tenant, entorno);
      bar.start(tickets.recordset.length, 0, { dia: 'N/A' });
      let ultimaFechaSincronizada = null;

      for (let i = 0; i < tickets.recordset.length; i++) {
        const record = tickets.recordset[i];
        const dia = moment.utc(record.Data).tz('Europe/Madrid', true).format('DD/MM');

        let tmst = moment.utc(record.Data).tz('Europe/Madrid', true).format('YYYY-MM-DDTHH:mm:ss.SSSZ');
        const data = {
          Botiga: record.Botiga,
          Data: tmst,
          Dependenta: record.Dependenta,
          Num_tick: record.Num_tick,
          Plu: record.Plu,
          Quantitat: record.Quantitat,
          Import: record.Import,
          Iva: `IVA${record.Iva}`,
          Tipus_venta: record.Tipus_venta,
          FormaMarcar: record.FormaMarcar,
          MetodoPago: record.MetodoPago,
          Nif: record.NIF_Client || '',
          Procesado: false
        };
        let response
        try {
          const date = new Date(data.Data);
          const tmstString = date.toISOString().replace(/\.\d{3}Z$/, 'Z');
          const importeData = parseFloat(
            typeof data.Import === 'string' ? data.Import.replace(',', '.') : data.Import
          );
          const quantitatData = parseFloat(
            typeof data.Quantitat === 'string' ? data.Quantitat.replace(',', '.') : data.Quantitat
          );
          const url = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/v_venut?$filter=Data eq ${tmstString} and Botiga eq ${data.Botiga} and Num_tick eq ${data.Num_tick} and Plu eq ${data.Plu} and Import eq ${importeData} and Quantitat eq ${quantitatData}`;
          // console.log(`🔍 Verificando existencia en BC: ${url}`);
          response = await axios.get(
            url,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
            },
          );
          const backendCount = response.data.value.length;

          const localCount = tickets.recordset.slice(0, i + 1).filter(item => {
            const importeItem = parseFloat(
              typeof item.Import === 'string' ? item.Import.replace(',', '.') : item.Import
            );
            const quantitatItem = parseFloat(
              typeof item.Quantitat === 'string' ? item.Quantitat.replace(',', '.') : item.Quantitat
            );
            const itemData = moment.utc(item.Data).tz('Europe/Madrid', true).format('YYYY-MM-DDTHH:mm:ss.SSSZ');

            return (
              itemData === data.Data &&
              item.Botiga === data.Botiga &&
              item.Num_tick === data.Num_tick &&
              item.Plu === data.Plu &&
              importeItem === importeData &&
              quantitatItem === quantitatData
            );
          }).length;

          // Solo insertamos si aún no hay más en BC que en los datos locales
          if (backendCount < localCount) {
            let postResponse;
            try {
              postResponse = await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/v_venut`, data, {
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
              });
            } catch (postError) {
              if (postError.response?.status === 401) {
                console.log('Token expirado. Renovando token...');
                token = await this.token.getToken2(client_id, client_secret, tenant);
                if (!token) {
                  console.log('No se pudo renovar el token');
                  return false;
                }
                postResponse = await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/v_venut`, data, {
                  headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                  },
                });
              } else if (postError.code === 'ECONNABORTED' || postError.code === 'Timeout') {
                console.log('⏳ Timeout detectado, reintentando...');
                // 🔁 Reintento en caso de timeout
                postResponse = await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/v_venut`, data, {
                  headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                  },
                });
              } else {
                this.logError(`❌ Error en el post del registro: ${JSON.stringify(data)}`, postError);
              }
            }
          }
          ultimaFechaSincronizada = record.Data;
        } catch (error) {
          if (error.response?.status === 401) {
            console.log('Token expirado. Renovando token...');
            token = await this.token.getToken2(client_id, client_secret, tenant);
            if (!token) {
              console.log('No se pudo renovar el token');
              return false;
            }
            const date = new Date(data.Data);
            const tmstString = date.toISOString().replace(/\.\d{3}Z$/, 'Z');

            response = await axios.get(
              `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/v_venut?$filter=Data eq ${tmstString} and Botiga eq ${data.Botiga} and Num_tick eq ${data.Num_tick} and Plu eq ${data.Plu} and Import eq ${data.Import}`,
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
              }
            );
          } else if (error.code === 'ECONNABORTED' || error.code === 'Timeout') {
            console.log('⏳ Timeout detectado, reintentando...');
            // 🔁 Reintento en caso de timeout
            response = await axios.get(
              `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/v_venut?$filter=Data eq ${tmstString} and Botiga eq ${data.Botiga} and Num_tick eq ${data.Num_tick} and Plu eq ${data.Plu} and Import eq ${data.Import}`,
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
              }
            );
          }
          else {
            this.logError(`❌ Error al enviar el registro: ${JSON.stringify(data)}`, error);
          }
        }
        // console.log(`⏳ Sincronizando registros de la fecha ${data.Data} ... -> ${i}/${tickets.recordset.length} --- ${((i / tickets.recordset.length) * 100).toFixed(2)}% `);
        bar.update(i, { dia });
      }
      bar.stop();
      if (ultimaFechaSincronizada) {
        const ts = new Date(ultimaFechaSincronizada).toISOString().slice(0, 19).replace('T', ' ');
        await this.sql.runSql(`UPDATE records SET TimeStamp = '${ts}' WHERE concepte = 'BC_Tickets_${licencia}'`, database);
      }
    }
    return true;
  }

  private getMonthsBetween(startDate: Date, endDate: Date) {
    const months = [];
    const date = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    while (date <= endDate) {
      const y = date.getFullYear();
      const m = (date.getMonth() + 1).toString().padStart(2, '0');
      months.push(`${y}-${m}`);
      date.setMonth(date.getMonth() + 1);
    }
    return months;
  }


  private logError(message: string, error: any) {
    this.client.publish('/Hit/Serveis/Apicultor/Log', JSON.stringify({ message, error: error.response?.data || error.message }));
    console.error(message, error.response?.data || error.message);
  }
}
