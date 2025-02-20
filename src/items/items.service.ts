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

  async syncItems(companyID: string, database: string, client_id: string, client_secret: string, tenant: string, entorno: string, codiHIT?: string) {
    let items;
    try {
      if (codiHIT) {
        items = await this.sqlService.runSql(
          `SELECT a.Codi, a.Nom, a.Preu/(1+(t.Iva/100)) PreuSinIva, a.Preu, LEFT(a.Familia, 20) Familia, a.EsSumable, t.Iva 
           FROM (SELECT codi, nom, preu, familia, esSumable, tipoIva FROM Articles UNION ALL SELECT codi, nom, preu, familia, esSumable, tipoIva FROM articles_Zombis) a 
           LEFT JOIN tipusIva2012 t ON a.Tipoiva=t.Tipus WHERE a.codi= ${codiHIT}`,
          database,
        );
      } else {
        items = await this.sqlService.runSql(
          `SELECT a.Codi, a.Nom, a.Preu/(1+(t.Iva/100)) PreuSinIva, a.Preu, LEFT(a.Familia, 20) Familia, a.EsSumable, t.Iva 
         FROM (SELECT codi, nom, preu, familia, esSumable, tipoIva FROM Articles UNION ALL SELECT codi, nom, preu, familia, esSumable, tipoIva FROM articles_Zombis) a 
         LEFT JOIN tipusIva2012 t ON a.Tipoiva=t.Tipus ORDER BY a.codi`,
          database,
        );
      }
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
    let itemId = '';
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

          itemId = createItem.data.id;
          const createdItemEtag = createItem.data['@odata.etag'];

          await axios.patch(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/items(${itemId})`, itemData2, {
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
          itemId = res.data.value[0].id;
        }
      } catch (error) {
        this.logError(`Error processing item ${item.Nom}`, error);
      }
      console.log(`Synchronizing item ${item.Nom} ... -> ${i}/${items.recordset.length} --- ${((i / items.recordset.length) * 100).toFixed(2)}% `);
      i++;
    }
    if (codiHIT) {
      return itemId;
    }
    return true;
  }

  private getBaseUnitOfMeasure(esSumable: number | boolean): string {
    const value = typeof esSumable === 'boolean' ? Number(esSumable) : esSumable;
    return value === 0 ? 'KG' : 'UDS';
  }

  async getItemFromAPI(companyID, database, codiHIT, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let itemId = '';
    const token = await this.tokenService.getToken2(client_id, client_secret, tenant);
    let res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/items?$filter=number eq '${codiHIT}'`, {
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
    });

    if (!res.data) throw new Error('Failed to obtain item');

    if (res.data.value.length > 0) {
      itemId = res.data.value[0].id;
      return itemId;
    }

    const newItem = await this.syncItems(companyID, database, client_id, client_secret, tenant, entorno, codiHIT);
    console.log(`itemId nuevo : ${newItem}`);
    if (newItem) {
      itemId = String(newItem);
      return itemId;
    }else{
      return false;
    }
  }

  private logError(message: string, error: any) {
    this.client.publish('/Hit/Serveis/Apicultor/Log', message);
    console.error(message, error);
  }
}
