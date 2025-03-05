/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable prefer-const */
import { Injectable } from '@nestjs/common';
import { getTokenService } from '../connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConection.service';
import axios from 'axios';
import { response } from 'express';

const mqtt = require('mqtt');
const mqttOptions = {
  host: process.env.MQTT_HOST,
  username: process.env.MQTT_USER,
  password: process.env.MQTT_PASSWORD,
};

// Crear un cliente MQTT
const client = mqtt.connect(mqttOptions);

@Injectable()
export class employeesService {
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) {}

  async syncEmployees(companyID: string, database: string, client_id: string, client_secret: string, tenant: string, entorno: string) {
    //En todo el documento process.env.database y process.env.companyID han sido sustituidos por database y companyID respectivamente
    console.log('CompanyID: ', companyID);
    console.log('Database: ', database);
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    let employees;
    try {
      employees = await this.sql.runSql(`select cast(Codi as nvarchar) Codi, left(Nom, 30) Nom from dependentes order by nom`, database);
    } catch (error) {
      //Comprovacion de errores y envios a mqtt
      client.publish('/Hit/Serveis/Apicultor/Log', 'No existe la database');
      console.log('No existe la database');
      return false;
    }

    if (employees.recordset.length == 0) {
      //Comprovacion de errores y envios a mqtt
      client.publish('/Hit/Serveis/Apicultor/Log', 'No hay registros');
      console.log('No hay registros');
      return false;
    }

    for (let i = 0; i < employees.recordset.length; i++) {
      let x = employees.recordset[i];
      let res = await axios
        .get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/employees?$filter=number eq '${x.Codi}'`, {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        })
        .catch((error) => {
          throw new Error('Failed to obtain employee ' + x.Codi);
        });

      if (!res.data) throw new Error('Failed to obtain employee ' + x.Codi);
      //No está dado de alta en BC
      if (res.data.value.length === 0) {
        let newEmployees = await axios
          .post(
            `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/employees`,
            {
              number: x.Codi,
              givenName: x.Nom,
              middleName: '',
              surname: x.Nom,
            },
            {
              headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json',
              },
            },
          )
          .catch((error) => {
            throw new Error('Failed to post employee ' + x.Codi);
          });

        if (!newEmployees.data) return new Error('Failed to post employee ' + x.Codi);
        //Ya está dado de alta en BC, se tiene que actualizar
      } else {
        let z = res.data.value[0]['@odata.etag'];
        let newEmployees = await axios
          .patch(
            `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/employees(${res.data.value[0].id})`,
            {
              givenName: x.Nom,
              middleName: '',
              surname: x.Nom,
            },
            {
              headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json',
                'if-Match': z,
              },
            },
          )
          .catch((error) => {
            throw new Error('Failed to patch employee ' + x.Codi);
          });
        if (!newEmployees.data) return new Error('Failed to patch employee ' + x.Codi);
      }
    }
    return true;
  }
}
