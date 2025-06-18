import { Injectable } from '@nestjs/common';
import { getTokenService } from '../connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConection.service';
import axios from 'axios';
import * as mqtt from 'mqtt';
import { response } from 'express';
import * as moment from 'moment-timezone';

@Injectable()
export class IncidenciaService {
  private client = mqtt.connect({
    host: process.env.MQTT_HOST,
    username: process.env.MQTT_USER,
    password: process.env.MQTT_PASSWORD,
  });
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) {}

  async syncIncidencias(companyID: string, database: string, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    //Miro si existe en records el 'BC_incidencias' y si no existe lo inserta con el TimeStamp mas antiguo de incidencias
    let timestamp;
    try {
      let records = await this.sql.runSql(`SELECT * FROM records WHERE concepte = 'BC_incidencias'`, database);
      if (records.recordset.length > 0) {
        timestamp = new Date(records.recordset[0].TimeStamp).toISOString().slice(0, 19).replace('T', ' ');
      } else {
        let tsResult = await this.sql.runSql(`SELECT MIN(TimeStamp) as TimeStamp FROM incidencias WHERE datepart(year,TimeStamp) = YEAR(GETDATE());`, database);
        timestamp = new Date(tsResult.recordset[0].timestamp).toISOString().slice(0, 19).replace('T', ' ');
        await this.sql.runSql(`INSERT INTO records (timestamp, concepte) VALUES ('${timestamp}', 'BC_incidencias')`, database);
      }
    } catch (error) {
      this.logError('❌ Error al obtener el timestamp de records', error);
      return false;
    }

    let incidencias;
    try {
      const sqlQuery = `SELECT 
                          inc.Id, 
                          TimeStamp, 
                          COALESCE(c.nom, cli.nom) AS Cliente, 
                          Incidencia, 
                          Estado, 
                          inc_c.Nom AS Observaciones, 
                          CASE 
                            WHEN Prioridad = -1 THEN 'Cualquier prioridad'
                            WHEN Prioridad = 0 THEN 'Puede esperar'
                            WHEN Prioridad = 1 THEN 'Urgente'
                            WHEN Prioridad = 2 THEN 'Muy urgente'
                            WHEN Prioridad = 3 THEN 'Millora'
                            ELSE 'Desconocida'
                          END AS Prioridad,   
                          d.NOM AS Tecnico, 
                          d1.NOM AS Usuario, 
                          FFinReparacion 
                        FROM incidencias inc
                        LEFT JOIN Inc_Categorias inc_c ON inc_c.id = inc.Observaciones
                        LEFT JOIN Dependentes d ON d.CODI = inc.Tecnico
                        LEFT JOIN Dependentes d1 ON d1.CODI = inc.Usuario
                        LEFT JOIN Clients c ON TRY_CAST(inc.Cliente AS INT) = c.Codi
                        LEFT JOIN Inc_Clientes cli ON cli.id = inc.Cliente
                        WHERE 
                          (TimeStamp >= '${timestamp}' OR lastupdate >= '${timestamp}')
                          AND 
                          (YEAR(TimeStamp) >= YEAR(GETDATE()) AND YEAR(lastupdate) >= YEAR(GETDATE()))
                        ORDER BY TimeStamp;`;
      incidencias = await this.sql.runSql(sqlQuery, database);
    } catch (error) {
      this.logError('❌ Error al obtener las incidencias', error);
      return false;
    }
    if (incidencias.recordset.length == 0) {
      this.client.publish('/Hit/Serveis/Apicultor/Log', 'No hay registros');
      console.warn(`⚠️ Advertencia: No se encontraron registros`);
      return false;
    }
    let i = 1;
    for (const record of incidencias.recordset) {
      let tmst = moment.utc(record.TimeStamp).tz('Europe/Madrid', true).format('YYYY-MM-DDTHH:mm:ss.SSSZ');
      let fFinReparacion = record.FFinReparacion ? moment.utc(record.FFinReparacion).tz('Europe/Madrid', true).format('YYYY-MM-DDTHH:mm:ss.SSSZ') : null;
      const data = {
        id: record.Id,
        tmst: tmst,
        usuario: record.Usuario,
        cliente: record.Cliente,
        incidencia: record.Incidencia,
        estado: record.Estado,
        categoria: record.Observaciones || '',
        fFinReparacion: fFinReparacion,
        prioridad: record.Prioridad,
        tecnico: record.Tecnico,
      };
      let urlGet = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/incidencias?$filter=id eq ${record.Id}`;
      let urlPost = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/incidencias`;
      //Hace un get de BC para ver si existe ya el dato
      let res = await axios
        .get(urlGet, {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        })
        .catch((error) => {
          throw new Error('Failed to obtain access token');
        });

      try {
        if (res.data.value.length === 0) {
          await axios.post(urlPost, data, {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          });
        } else {
          // Si ya existe, actualiza el registro
          let urlPatch = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/incidencias(${res.data.value[0].id})`;
          await axios.patch(urlPatch, data, {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
              'If-Match': '*',
            },
          });
        }
      } catch (error) {
        this.logError(`❌ Error al sincronizar la incidencia con ID ${record.Id}`, error);
        continue; // Continúa con la siguiente incidencia en caso de error
      }
      console.log(`⏳ Sincronizando incidencia ${record.Id} ... -> ${i}/${incidencias.recordset.length} --- ${((i / incidencias.recordset.length) * 100).toFixed(2)}% `);
      i++;
    }

    await this.sql.runSql(`UPDATE records SET timestamp = GETDATE() WHERE Concepte ='BC_incidencias';`, database);
    return true;
  }
  private logError(message: string, error: any) {
    this.client.publish('/Hit/Serveis/Apicultor/Log', JSON.stringify({ message, error: error.response?.data || error.message }));
    console.error(message, error.response?.data || error.message);
  }
}
