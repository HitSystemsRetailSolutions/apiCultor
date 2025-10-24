import { Injectable } from '@nestjs/common';
import { getTokenService } from 'src/connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConnection.service';
import axios from 'axios';
import * as mqtt from 'mqtt';
import * as moment from 'moment-timezone';

@Injectable()
export class ventasPrevisionService {
  private client = mqtt.connect({
    host: process.env.MQTT_HOST,
    username: process.env.MQTT_USER,
    password: process.env.MQTT_PASSWORD,
  });
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) { }

  async syncVentasPrevision(companyID: string, database: string, client_id: string, client_secret: string, tenant: string, entorno: string) {
    const token = await this.token.getToken2(client_id, client_secret, tenant);
    if (!token) {
      this.logError('Error al obtener el token', { client_id, tenant });
      return false;
    }
    let timestamp;
    let records = await this.sql.runSql(`SELECT * FROM records WHERE concepte = 'BC_PowerBIData'`, database);
    if (records.recordset.length > 0) {
      timestamp = new Date(records.recordset[0].TimeStamp).toISOString().slice(0, 19).replace('T', ' ');
    } else {
      let tsResult = await this.sql.runSql(`SELECT MIN(Fecha) as timestamp FROM PowerBIData`, database);
      timestamp = new Date(tsResult.recordset[0].timestamp).toISOString().slice(0, 19).replace('T', ' ');
      await this.sql.runSql(`INSERT INTO records (timestamp, concepte) VALUES ('${timestamp}', 'BC_PowerBIData')`, database);
    }
    let ventasPrevision;
    try {
      ventasPrevision = await this.sql.runSql(
        `SELECT Id, Fecha, c.Nom AS Lugar, Concepto, ROUND(Importe,2) AS Importe FROM PowerBIData pb LEFT JOIN clients c on c.Codi = pb.Lugar WHERE FechaSincro >= '${timestamp}' or FechaSincro IS NULL ORDER BY Fecha, Lugar`,
        database,
      );
    } catch (error) {
      this.logError(`❌ Error al ejecutar la consulta SQL en la base de datos '${database}'`, error);
      return false;
    }
    if (ventasPrevision.recordset.length == 0) {
      this.client.publish('/Hit/Serveis/Apicultor/Log', 'No hay registros de previsiones de ventas');
      console.warn(`⚠️ Advertencia: No se encontraron registros de previsiones de ventas`);
      return false;
    }
    let i = 1;
    for (const record of ventasPrevision.recordset) {
      let tmst = moment.utc(record.Fecha).tz('Europe/Madrid', true).format('YYYY-MM-DDTHH:mm:ss.SSSZ');
      const data = {
        tmst: tmst,
        lloc: record.Lugar,
        concepte: record.Concepto,
        import: parseFloat(record.Importe),
      };

      try {
        const date = new Date(data.tmst);
        const tmstString = date.toISOString().replace(/\.\d{3}Z$/, 'Z');
        const response = await axios.get(
          `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/powerBI_Data?$filter=tmst eq ${tmstString} and lloc eq '${data.lloc}' and concepte eq '${data.concepte}' and import eq ${data.import}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          },
        );
        // Verifica si ya existe un registro con el mismo timestamp para evitar duplicados
        if (response.data.value.length === 0) {
          try {
            const postResponse = await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/powerBI_Data`, data, {
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
            });

            if (postResponse.status === 201 || postResponse.status === 200) {
              await this.sql.runSql(`UPDATE PowerBIData SET FechaSincro = GETDATE() WHERE id = '${record.Id}'`, database);
            }
          } catch (postError) {
            this.logError(`❌ Error en el post del registro: ${JSON.stringify(data)}`, postError.response ? postError.response.data : postError);
          }
        }
      } catch (error) {
        this.logError(`❌ Error al enviar el registro: ${JSON.stringify(data)}`, error.response ? error.response.data : error);
      }
      console.log(`⏳ Sincronizando registros ... -> ${i}/${ventasPrevision.recordset.length} --- ${((i / ventasPrevision.recordset.length) * 100).toFixed(2)}% `);
      i++;
    }
    await this.sql.runSql(`UPDATE records SET TimeStamp = GETDATE() WHERE concepte = 'BC_PowerBIData'`, database);
    return true;
  }

  private logError(message: string, error: any) {
    this.client.publish('/Hit/Serveis/Apicultor/Log', JSON.stringify({ message, error: error.response?.data || error.message }));
    console.error(message, error.response?.data || error.message);
  }
}
