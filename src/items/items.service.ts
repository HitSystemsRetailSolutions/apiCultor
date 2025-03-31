import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { getTokenService } from '../connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConection.service';
import axios from 'axios';
import * as mqtt from 'mqtt';
import { salesFacturasService } from 'src/sales/salesFacturas.service';

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
    @Inject(forwardRef(() => salesFacturasService))
    private salesFacturas: salesFacturasService,
  ) {}

  async syncItems(companyID: string, database: string, client_id: string, client_secret: string, tenant: string, entorno: string, codiHIT?: string) {
    if (tenant === process.env.blockedTenant) return;
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
      this.logError(`❌ Error al ejecutar la consulta SQL en la base de datos '${database}'`, error);
      return false;
    }

    if (items.recordset.length == 0) {
      this.client.publish('/Hit/Serveis/Apicultor/Log', 'No hay registros');
      console.warn(`⚠️ Advertencia: No se encontraron registros de artículos`);
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

        let res;
        try {
          res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/items?$filter=number eq '${item.Codi}'`, {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          });
        } catch (error) {
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
          const updateItem = await axios.patch(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/items(${res.data.value[0].id})`, itemData1, {
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
        this.logError(`❌ Error al procesar el artículo ${item.Nom}, ${item.Codi}`, error);
        if (codiHIT) {
          throw error;
        }
        continue;
      }
      console.log(`⏳ Sincronizando artículo ${item.Nom} ... -> ${i}/${items.recordset.length} --- ${((i / items.recordset.length) * 100).toFixed(2)}% `);
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
    let res;
    if (tenant === process.env.blockedTenant) {
      const getBCcode = await this.sqlService.runSql(`select IdBc from BC_SincroIds where TipoDato = 'item' and IdHit = ${codiHIT}`, database);
      if (getBCcode.recordset.length === 0) {
        console.log(`❌ Item con código ${codiHIT} no encontrado en tabla de mapeo, el item no existe en BC`);
        this.salesFacturas.addError(`Item con código ${codiHIT} no encontrado en tabla de mapeo, el item no existe en BC`);
        return 'error';
      } else {
        codiHIT = getBCcode.recordset[0].IdBc;
        console.log('📘 Código HIT convertido a ID BC:', codiHIT);
      }
      try {
        res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/items?$filter=number eq '${codiHIT}'`, {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        });
      } catch (error) {
        this.logError(`❌ Error consultando item con plu ${codiHIT}`, error);
        throw error;
      }
      if (res.data.value.length > 0) {
        itemId = res.data.value[0].id;
        return itemId;
      } else {
        console.log(`❌ Item con codigo ${codiHIT} no encontrado en BC pero si en la tabla de mapeo, seguramente se haya eliminado`);
        this.salesFacturas.addError(`Item con codigo ${codiHIT} no encontrado en BC pero si en la tabla de mapeo, seguramente se haya eliminado`);
        return 'error';
      }
    } else {
      try {
        res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/items?$filter=number eq '${codiHIT}'`, {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        });
      } catch (error) {
        this.logError(`❌ Error consultando item con plu ${codiHIT}`, error);
        throw error;
      }

      if (res.data.value.length > 0) {
        itemId = res.data.value[0].id;
        // Comprobar si los campos necesarios existen
        const item = res.data.value[0];
        if (!item.generalProductPostingGroupCode?.trim() || item.type !== 'Non_x002D_Inventory' || !item.VATProductPostingGroup?.trim()) {
          // Si faltan campos, volver a sincronizar el artículo
          const syncResult = await this.syncItems(companyID, database, client_id, client_secret, tenant, entorno, codiHIT);
          if (syncResult) {
            return await this.getItemFromAPI(companyID, database, codiHIT, client_id, client_secret, tenant, entorno);
          } else {
            return false;
          }
        }
        return itemId;
      }

      const newItem = await this.syncItems(companyID, database, client_id, client_secret, tenant, entorno, codiHIT);
      if (newItem) {
        itemId = String(newItem);
        return itemId;
      } else {
        return false;
      }
    }
  }

  private logError(message: string, error: any) {
    this.client.publish('/Hit/Serveis/Apicultor/Log', JSON.stringify({ message, error: error.response?.data || error.message }));
    console.error(message, error.response?.data || error.message);
  }
}
