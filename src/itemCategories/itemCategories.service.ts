import { Injectable } from '@nestjs/common';
import { getTokenService } from '../conection/getToken.service';
import { runSqlService } from 'src/conection/sqlConection.service';
import axios from 'axios';
import { response } from 'express';

const mqtt = require('mqtt');
const mqttBrokerUrl = 'mqtt://santaana2.nubehit.com';

// Crear un cliente MQTT
const client = mqtt.connect(mqttBrokerUrl);

@Injectable()
export class itemCategoriesService {
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) {}

  async syncItemCategories(companyID: string, database: string) {
    console.log(companyID)
    console.log(database)
    let token = await this.token.getToken();
    let categoryId = '';
    let categories;
    try {
      categories = await this.sql.runSql(
        'SELECT left(nom, 20) Code, Nom FROM Families',
        database
      );
    } catch (error){
      client.publish('/Hit/Serveis/Apicultor/Log', 'No existe la database');
      console.log('No existe la database')
      return false;
    }
    
  if(categories.recordset.length == 0){
    client.publish('/Hit/Serveis/Apicultor/Log', 'No hay registros');
    console.log('No hay registros')
    return false;
  }
    for (let i = 0; i < categories.recordset.length; i++) {
      let x = categories.recordset[i];
      console.log(x.Nom);

      let res = await axios
        .get(
          `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${companyID})/itemCategories?$filter=code eq '${x.Code}'`,
          {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          },
        )
        .catch((error) => {
          throw new Error('Failed get category');
        });

      if (!res.data) throw new Error('Failed get category');
      if (res.data.value.length === 0) {
        let newCategories = await axios
          .post(
            `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${companyID})/itemCategories`,
            {
                code: x.Code ,
                displayName: x.Nom,
            },
            {
              headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json',
              },
            },
          )
          .catch((error) => {
            throw new Error('Failed post category ' + x.Nom);
          });

        if (!newCategories.data)
          return new Error('Failed post category');

        categoryId = newCategories.data.id;
      } else {
        let z = res.data.value[0]['@odata.etag'];
        categoryId = res.data.value[0].id;

        let newCategories = await axios
          .patch(
            `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${companyID})/itemCategories(${res.data.value[0].id})`,
            {
                code: x.Code ,
                displayName: x.Nom,
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
            throw new Error('Failed to update category');
          });
        if (!newCategories.data)
          return new Error('Failed to update category');
      }
    }
    return true;
  }

}
