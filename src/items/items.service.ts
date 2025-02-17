import { Injectable } from '@nestjs/common';
import { getTokenService } from '../conection/getToken.service';
import { runSqlService } from 'src/conection/sqlConection.service';
import axios from 'axios';
import * as mqtt from 'mqtt';

@Injectable()
export class itemsService {
  private client = mqtt.connect({
    host: process.env.MQTT_HOST,
    username: process.env.MQTT_USER,
    password: process.env.MQTT_PASSWORD,
  });

  constructor(
    private tokenService: getTokenService,
    private sqlService: runSqlService,
  ) {}

  async syncItems(companyID: string, database: string, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let items;
    try {
      items = await this.sqlService.runSql(
        `SELECT a.Codi, a.Nom, a.Preu/(1+(t.Iva/100)) PreuSinIva, a.Preu, LEFT(a.Familia, 20) Familia, a.EsSumable, t.Iva 
         FROM (SELECT codi, nom, preu, familia, esSumable, tipoIva FROM Articles UNION ALL SELECT codi, nom, preu, familia, esSumable, tipoIva FROM articles_Zombis) a 
         LEFT JOIN tipusIva2012 t ON a.Tipoiva=t.Tipus ORDER BY a.codi`,
        database,
      );
    } catch (error) {
      this.logError(`Database '${database}' does not exist`, error);
      return false;
    }

    if (items.recordset.length == 0) {
      this.client.publish('/Hit/Serveis/Apicultor/Log', 'No hay registros');
      console.log('Items. No hay registros');
      return false;
    }

    const token = await this.tokenService.getToken2(client_id, client_secret, tenant);
    let i = 1;
    for (const item of items.recordset) {
      try {
        const baseUnitOfMeasure = this.getBaseUnitOfMeasure(item.EsSumable);
        //Datos para crear el artículo
        const itemData1 = {
          number: `${item.Codi}`,
          displayName: `${item.Nom}`,
          type: 'Non_x002D_Inventory',
          baseUnitOfMeasureCode: `${baseUnitOfMeasure}`,
          unitPrice: item.Preu,
          generalProductPostingGroupCode: 'MERCADERÍA',
          VATProductPostingGroup: 'IVA' + (item.Iva ?? 0),
        };
        //Hay parámetros que no se pueden poner cuando creas el artículo y hay que actualizarlos despues de crearlo
        const itemData2 = {
          priceIncludesTax: true,
        };
        //Para hacer un patch con todos los datos si el artículo ya existe
        const itemData = {
          ...itemData1,
          ...itemData2,
        };

        const res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/items?$filter=number eq '${item.Codi}'`, {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        });
        if (res.data.value.length === 0) {
          const createItem = await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/items`, itemData1, {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          });

          const createdItemId = createItem.data.id;
          const createdItemEtag = createItem.data['@odata.etag'];

          await axios.patch(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/items(${createdItemId})`, itemData2, {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
              'If-Match': createdItemEtag,
            },
          });
        } else {
          const etag = res.data.value[0]['@odata.etag'];
          await axios.patch(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/items(${res.data.value[0].id})`, itemData, {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
              'If-Match': etag,
            },
          });
        }
      } catch (error) {
        this.logError(`Error processing item ${item.Nom}`, error);
      }
      console.log(`Synchronizing item ${item.Nom} ... -> ${i}/${items.recordset.length} --- ${((i / items.recordset.length) * 100).toFixed(2)}% `);
      i++;
    }
    return true;
  }

  private getBaseUnitOfMeasure(esSumable: number | boolean): string {
    const value = typeof esSumable === 'boolean' ? Number(esSumable) : esSumable;
    return value === 0 ? 'KG' : 'UDS';
  }

  async getItemFromAPI(companyID, database, codiHIT, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let itemAPI = '';
    const token = await this.tokenService.getToken2(client_id, client_secret, tenant);
    let res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/items?$filter=number eq '${codiHIT}'`, {
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
    });

    if (!res.data) throw new Error('Failed to obtain item');

    if (res.data.value.length > 0) {
      const existingItem = res.data.value[0];
      console.log('itemAPI existente', existingItem.displayName);
      return { data: { value: [existingItem] } }; // Estandarizar el retorno
    }

    let item;
    try {
      item = await this.sqlService.runSql(
        `SELECT a.Codi, a.Nom, a.Preu/(1+(t.Iva/100)) PreuSinIva, a.Preu, LEFT(a.Familia, 20) Familia, a.EsSumable, t.Iva 
         FROM (SELECT codi, nom, preu, familia, esSumable, tipoIva FROM Articles UNION ALL SELECT codi, nom, preu, familia, esSumable, tipoIva FROM articles_Zombis) a 
         LEFT JOIN tipusIva2012 t ON a.Tipoiva=t.Tipus WHERE a.codi= ${codiHIT}`,
        database,
      );
    } catch (error) {
      this.logError(`Database '${database}' does not exist`, error);
      return false;
    }

    if (item.recordset.length == 0) {
      this.client.publish('/Hit/Serveis/Apicultor/Log', 'No hay registros');
      console.log('Items. No hay registros');
      return null;
    }
    const itemRes = item.recordset[0];
    const baseUnitOfMeasure = this.getBaseUnitOfMeasure(itemRes.EsSumable);

    const itemData1 = {
      number: `${itemRes.Codi}`,
      displayName: `${itemRes.Nom}`,
      type: 'Non_x002D_Inventory',
      baseUnitOfMeasureCode: `${baseUnitOfMeasure}`,
      unitPrice: itemRes.Preu,
      generalProductPostingGroupCode: 'MERCADERÍA',
      VATProductPostingGroup: 'IVA' + (itemRes.Iva ?? 0),
    };
    const itemData2 = {
      priceIncludesTax: true,
    };

    const createItem = await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/items`, itemData1, {
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
    });

    const createdItemId = createItem.data.id;
    const createdItemEtag = createItem.data['@odata.etag'];

    await axios.patch(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/items(${createdItemId})`, itemData2, {
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        'If-Match': createdItemEtag,
      },
    });
    console.log('itemAPI nuevo', createItem.data.displayName);

    return { data: { value: [createItem.data] } };
  }

  private logError(message: string, error: any) {
    this.client.publish('/Hit/Serveis/Apicultor/Log', message);
    console.error(message, error);
  }
}
