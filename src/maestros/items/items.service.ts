import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { getTokenService } from 'src/connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConnection.service';
import axios from 'axios';
import * as mqtt from 'mqtt';
import * as cliProgress from 'cli-progress';

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
  ) { }

  async syncItems(companyID: string, database: string, client_id: string, client_secret: string, tenant: string, entorno: string, codiHIT?: string) {
    if (tenant === process.env.tenaTenant) return;
    let items;
    try {
      const sqlQuery = `
        SELECT a.Codi, a.Nom, a.Preu/(1+(t.Iva/100)) PreuSinIva, a.Preu, LEFT(a.Familia, 20) Familia, a.EsSumable, t.Iva 
        FROM (
          SELECT codi, nom, preu, familia, esSumable, tipoIva FROM Articles 
          UNION ALL 
          SELECT codi, nom, preu, familia, esSumable, tipoIva FROM articles_Zombis
        ) a 
        LEFT JOIN tipusIva2012 t ON a.Tipoiva=t.Tipus 
        ${codiHIT ? `WHERE a.codi = ${codiHIT}` : 'ORDER BY a.codi'}
      `;
      items = await this.sqlService.runSql(sqlQuery, database);
    } catch (error) {
      this.logError(`❌ Error al ejecutar la consulta SQL en la base de datos '${database}'`, error);
      return false;
    }

    if (items.recordset.length == 0) {
      this.client.publish('/Hit/Serveis/Apicultor/Log', 'No hay registros');
      console.warn(`⚠️ Advertencia: No se encontraron registros de artículos`);
      return false;
    }

    let token = await this.tokenService.getToken2(client_id, client_secret, tenant);
    let itemId = '';
    const bar = new cliProgress.SingleBar({
      format: '⏳ Sincronizando producto: {item} |{bar}| {percentage}% | {value}/{total} | ⏰ Tiempo restante: {eta_formatted}',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      barGlue: '',
      hideCursor: true,
      noTTYOutput: true
    });
    bar.start(items.recordset.length, 0, { item: 'N/A' });
    let i = 1;
    for (const item of items.recordset) {
      try {
        const baseUnitOfMeasure = this.getBaseUnitOfMeasure(item.EsSumable);
        //Datos para crear el artículo
        const itemData1 = {
          number: `${item.Codi}`,
          displayName: `${item.Nom.substring(0, 100)}`,
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

        let res;
        try {
          res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/items?$filter=number eq '${item.Codi}'`, {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          });
        } catch (error) {
          if (error.response?.status === 401) {
            console.log('Token expirado. Renovando token...');
            token = await this.tokenService.getToken2(client_id, client_secret, tenant);
            if (!token) {
              console.log('No se pudo renovar el token');
              return false;
            }
            res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/items?$filter=number eq '${item.Codi}'`, {
              headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json',
              },
            });
          }
          this.logError(`❌ Error consultando articulo en BC con plu ${item.Codi}`, error);
          continue;
        }
        if (res.data.value.length === 0) {
          const createItem = await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/items`, itemData1, {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          });

          itemId = createItem.data.id;
          const createdItemEtag = createItem.data['@odata.etag'];
          if (createItem.data.VATProductPostingGroup) {
            await axios.patch(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/items(${itemId})`, itemData2, {
              headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json',
                'If-Match': createdItemEtag,
              },
            });
          }
        } else {
          let etag = res.data.value[0]['@odata.etag'];
          const { type, ...itemDataWithoutType } = itemData1;
          const updateItem = await axios.patch(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/items(${res.data.value[0].id})`, itemDataWithoutType, {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
              'If-Match': etag,
            },
          });
          etag = updateItem.data['@odata.etag'];
          if (updateItem.data.VATProductPostingGroup) {
            await axios.patch(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/items(${res.data.value[0].id})`, itemData2, {
              headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json',
                'If-Match': etag,
              },
            });
          }
          itemId = res.data.value[0].id;
        }
      } catch (error) {
        if (error.response?.status === 401) {
          console.log('Token expirado. Renovando token...');
          token = await this.tokenService.getToken2(client_id, client_secret, tenant);
          if (!token) {
            console.log('No se pudo renovar el token');
            return false;
          }
          i--;
          continue;
        }
        this.logError(`❌ Error al procesar el artículo ${item.Nom}, ${item.Codi}`, error);
        if (codiHIT) {
          throw error;
        }
        continue;
      }
      bar.update(i, { item: item.Nom });
      i++;
    }
    if (codiHIT) {
      bar.stop();
      return itemId;
    }
    bar.stop();
    return true;
  }

  private getBaseUnitOfMeasure(esSumable: number | boolean): string {
    const value = typeof esSumable === 'boolean' ? Number(esSumable) : esSumable;
    return value === 0 ? 'KG' : 'UDS';
  }

  async getItemFromAPI(companyID: string, database: string, codiHIT: string, client_id: string, client_secret: string, tenant: string, entorno: string,): Promise<string | false> {
    let token = await this.tokenService.getToken2(client_id, client_secret, tenant);
    let res;
    try {
      res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/items?$filter=number eq '${codiHIT}'`,
        {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        },
      );
    } catch (error) {
      this.logError(`❌ Error consultando item con codiHIT ${codiHIT}`, error);
      throw error;
    }

    if (res.data.value.length > 0) {
      const item = res.data.value[0];
      const itemId = item.id;
      const needsUpdate = !item.generalProductPostingGroupCode?.trim() || item.type !== 'Non_x002D_Inventory' || !item.VATProductPostingGroup?.trim();

      if (needsUpdate) {
        const updatedItemId = await this.syncItems(companyID, database, client_id, client_secret, tenant, entorno, codiHIT);
        return updatedItemId ? String(updatedItemId) : itemId;
      }
      return itemId;
    }

    const newItemId = await this.syncItems(companyID, database, client_id, client_secret, tenant, entorno, codiHIT);
    if (!newItemId) {
      console.warn(`⚠️ No se pudo crear el artículo con codiHIT ${codiHIT}`);
      return false;
    }
    return String(newItemId);
  }

  private logError(message: string, error: any) {
    const errorDetail = error?.response?.data || error?.message || 'Error desconocido';
    this.client.publish('/Hit/Serveis/Apicultor/Log', JSON.stringify({ message, error: errorDetail }));
    console.error(message, errorDetail);
  }
}
