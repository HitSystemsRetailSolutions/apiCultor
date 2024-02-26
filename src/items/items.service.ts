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
export class itemsService {
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) {}

  async syncItems(companyID: string, database: string) {
    let token = await this.token.getToken();
    let itemId = '';

    let items;
    try {
      items = await this.sql.runSql(
        'SELECT a.Codi, a.Nom, a.Preu/(1+(t.Iva/100)) PreuSinIva, a.Preu, left(a.Familia, 20) Familia, a.EsSumable, t.Iva FROM (select codi, nom, preu, familia, esSumable, tipoIva from Articles union all select codi, nom, preu, familia, esSumable, tipoIva from articles_Zombis) a left join tipusIva2012 t on a.Tipoiva=t.Tipus where a.codi>0 order by a.codi',
        database,
      );
    } catch (error) {
      //Comprovacion de errores y envios a mqtt
      client.publish('/Hit/Serveis/Apicultor/Log', 'No existe la database');
      console.log('Items. No existe la database');
      return false;
    }

    if (items.recordset.length == 0) {
      //Comprovacion de errores y envios a mqtt
      client.publish('/Hit/Serveis/Apicultor/Log', 'No hay registros');
      console.log('Items. No hay registros');
      return false;
    }

    for (let i = 0; i < items.recordset.length; i++) {
      let x = items.recordset[i];

      let baseUnitOfMeasure = 'UDS';
      //Unidad de medida (obligatorio)
      if (x.EsSumable === 0) {
        baseUnitOfMeasure = 'KG'; //A peso
      } else {
        baseUnitOfMeasure = 'UDS'; //Por unidades
      }

      //IVA
      let ivaItem = x.Iva;

      let res = await axios
        .get(
          `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${companyID})/items?$filter=number eq 'CODI-${x.Codi}'`,
          {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          },
        )
        .catch((error) => {
          throw new Error('Failed get item');
        });

      if (!res.data) throw new Error('Failed get item');
      if (res.data.value.length === 0) {
        let newItems = await axios
          .post(
            `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${companyID})/items`,
            {
              number: 'CODI-' + x.Codi,
              displayName: x.Nom,
              generalProductPostingGroupCode: 'IVA' + x.Iva,
              unitPrice: x.Preu,
              baseUnitOfMeasureCode: baseUnitOfMeasure,
            },
            {
              headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json',
              },
            },
          )
          .catch((error) => {
            throw new Error('Failed post item ' + x.Nom);
          });

        if (!newItems.data) return new Error('Failed post item');
        itemId = newItems.data.id;
      } else {
        let z = res.data.value[0]['@odata.etag'];
        itemId = res.data.value[0].id;

        let newItems = await axios
          .patch(
            `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${companyID})/items(${res.data.value[0].id})`,
            {
              number: 'CODI-' + x.Codi,
              displayName: x.Nom,
              generalProductPostingGroupCode: 'IVA' + x.Iva,
              unitPrice: x.Preu,
              priceIncludesTax: true,
              baseUnitOfMeasureCode: baseUnitOfMeasure,
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
            throw new Error('Failed to update item');
          });
        if (!newItems.data) return new Error('Failed to update item');
      }
    }
    return true;
  }

  async getItemFromAPI(companyID, database, codiHIT) {
    let itemId = '';

    // Get the authentication token
    let token = await this.token.getToken();
    let items;
    let sqlQ1 =
      'SELECT a.Codi, a.Nom, a.Preu/(1+(t.Iva/100)) PreuSinIva, a.Preu, left(a.Familia, 20) Familia, a.EsSumable, t.Iva FROM (select codi, nom, preu, familia, esSumable, tipoIva from Articles union all select codi, nom, preu, familia, esSumable, tipoIva from articles_Zombis) a left join tipusIva2012 t on a.Tipoiva=t.Tipus where a.codi=' +
      codiHIT;

    try {
      items = await this.sql.runSql(sqlQ1, database);
    } catch (error) {
      console.log(error);
    }

    let baseUnitOfMeasure = 'UDS';
    //Unidad de medida (obligatorio)
    if (items.recordset[0].EsSumable === 0) {
      baseUnitOfMeasure = 'KG'; //A peso
    } else {
      baseUnitOfMeasure = 'UDS'; //Por unidades
    }

    let url = `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${companyID})/items?$filter=number eq 'CODI-${codiHIT}'`;

    // Get Item from API
    let res = await axios
      .get(url, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      })
      .catch((error) => {
        throw new Error('Failed to obtain item');
      });

    if (!res.data) throw new Error('Failed to obtain item');

    if (res.data.value.length === 0) {
      let newItems = await axios
        .post(
          `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${companyID})/items`,
          {
            number: 'CODI-' + codiHIT,
            displayName: items.recordset[0].Nom,
            generalProductPostingGroupCode: 'IVA' + items.recordset[0].Iva,
            unitPrice: items.recordset[0].Preu,
            baseUnitOfMeasureCode: baseUnitOfMeasure,
          },
          {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          },
        )
        .catch((error) => {
          throw new Error('Failed post item ' + items.recordset[0].Nom);
        });
      itemId = newItems.data.id;
    } else {
      itemId = res.data.value[0].id;
    }

    return itemId;
  }
}
