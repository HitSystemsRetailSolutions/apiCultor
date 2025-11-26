import { Injectable } from '@nestjs/common';
import { getTokenService } from 'src/connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConnection.service';
import axios from 'axios';
import { response } from 'express';
import * as mqtt from 'mqtt';

@Injectable()
export class salespersonService {

  private client = mqtt.connect({
    host: process.env.MQTT_HOST,
    username: process.env.MQTT_USER,
    password: process.env.MQTT_PASSWORD,
  });

  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) { }

  async syncSalespersons(companyID: string, database: string, client_id: string, client_secret: string, tenant: string, entorno: string, codiHIT: string) {
    let salespersons;
    try {
      salespersons = await this.sql.runSql(`select CODI,NOM,TELEFON from Dependentes where CODI = ${codiHIT}`, database);
    } catch (error) {
      this.logError('Error al obtener comerciales', error);
      return false;
    }
    if (salespersons.recordset.length == 0) {
      this.client.publish('/Hit/Serveis/Apicultor/Log', 'No hay registros');
      console.log('No hay registros');
      return false;
    }
    let token = await this.token.getToken2(client_id, client_secret, tenant);

    const salesperson = salespersons.recordset[0];
    const salesPersonData = {
      Code: `${salesperson.CODI}`,
      Name: `${salesperson.NOM}`,
      PhoneNo: `${salesperson.TELEFON}`,
    };

    let res;
    try {
      res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/Salesperson?$filter=Code eq '${salesperson.CODI}'`, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      })
    } catch (error) {
      this.logError(`Error al obtener el comercial ${salesperson.CODI}`, error);
    };

    if (res.data.value.length === 0) {
      await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/Salesperson`, salesPersonData, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      });
    } else {
      let etag = res.data.value[0]['@odata.etag'];
      await axios.patch(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/employees(${res.data.value[0].id})`, salesPersonData, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
          'if-Match': etag,
        },
      });
    }
    return true;
  }

  private logError(message: string, error: any) {
    this.client.publish('/Hit/Serveis/Apicultor/Log', JSON.stringify({ message, error: error.response?.data || error.message }));
    console.error(message, error.response?.data || error.message);
  }

}
