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
        SELECT a.Codi, a.Nom, a.Preu/(1+(t.Iva/100)) PreuSinIva, a.Preu, LEFT(a.Familia, 20) Familia, a.EsSumable, t.Iva , isnull(fe3.valor, isnull(fe2.valor, isnull(fe1.valor, '700000000'))) Cuenta
        FROM (
          SELECT codi, nom, preu, familia, esSumable, tipoIva FROM Articles 
          UNION ALL 
          SELECT codi, nom, preu, familia, esSumable, tipoIva FROM articles_Zombis
        ) a          
        LEFT JOIN tipusIva2012 t ON a.Tipoiva=t.Tipus 
        LEFT JOIN families f3 on a.familia=f3.Nom 
        LEFT JOIN families f2 on f3.pare=f2.Nom 
        LEFT JOIN families f1 on f2.pare=f1.Nom 
        LEFT JOIN familiesextes fe3 on f3.nom=fe3.familia and fe3.variable='CUENTA_CONTABLE'
        LEFT JOIN familiesextes fe2 on f2.nom=fe2.familia and fe2.variable='CUENTA_CONTABLE'
        LEFT JOIN familiesextes fe1 on f1.nom=fe1.familia and fe1.variable='CUENTA_CONTABLE'
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
          generalProductPostingGroupCode: item.Cuenta.substring(0, 3) == '705' ? 'SERVICIOS' : 'MERCADERÍA',
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
          const existingItem = res.data.value[0];
          let etag = existingItem['@odata.etag'];
          const { type, ...itemDataWithoutType } = itemData1;

          // Comprobar si hay cambios en cualquiera de los campos
          const hasChanged1 =
            existingItem.displayName !== itemDataWithoutType.displayName ||
            existingItem.baseUnitOfMeasureCode !== itemDataWithoutType.baseUnitOfMeasureCode ||
            Number(existingItem.unitPrice) !== Number(itemDataWithoutType.unitPrice) ||
            existingItem.generalProductPostingGroupCode !== itemDataWithoutType.generalProductPostingGroupCode ||
            existingItem.VATProductPostingGroup !== itemDataWithoutType.VATProductPostingGroup;

          const hasChanged2 = existingItem.priceIncludesTax !== itemData2.priceIncludesTax;

          if (hasChanged1) {
            const updateItem = await axios.patch(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/items(${existingItem.id})`, itemDataWithoutType, {
              headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json',
                'If-Match': etag,
              },
            });
            etag = updateItem.data['@odata.etag'];
          }

          if (hasChanged2 && itemDataWithoutType.VATProductPostingGroup) {
            await axios.patch(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/items(${existingItem.id})`, itemData2, {
              headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json',
                'If-Match': etag,
              },
            });
          }
          itemId = existingItem.id;
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
      console.log(`⏳ Sincronizando producto ${item.Nom} ... -> ${i}/${items.recordset.length} --- ${((i / items.recordset.length) * 100).toFixed(2)}% `);
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

  async getItemFromAPI(companyID: string, database: string, codiHIT: string, client_id: string, client_secret: string, tenant: string, entorno: string): Promise<string | false> {
    let token = await this.tokenService.getToken2(client_id, client_secret, tenant);
    let res;
    try {
      res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/items?$filter=number eq '${codiHIT}'`, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      });
    } catch (error) {
      this.logError(`❌ Error consultando item con codiHIT ${codiHIT}`, error);
      throw error;
    }

    if (res.data.value.length > 0) {
      const item = res.data.value[0];
      const itemId = item.id;

      const updatedItemId = await this.syncItems(companyID, database, client_id, client_secret, tenant, entorno, codiHIT);
      return updatedItemId ? String(updatedItemId) : itemId;
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
