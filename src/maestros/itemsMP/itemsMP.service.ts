import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { getTokenService } from 'src/connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConnection.service';
import { vendorsService } from 'src/maestros/vendors/vendors.service';
import axios from 'axios';
import * as mqtt from 'mqtt';
import * as cliProgress from 'cli-progress';

@Injectable()
export class itemsMPService {
  private client = mqtt.connect({
    host: process.env.MQTT_HOST,
    username: process.env.MQTT_USER,
    password: process.env.MQTT_PASSWORD,
  });

  constructor(
    private tokenService: getTokenService,
    private sqlService: runSqlService,
    private vendors: vendorsService,
  ) {}

  async syncItemsMP(companyID: string, database: string, client_id: string, client_secret: string, tenant: string, entorno: string, codiHIT?: string) {
    if (tenant === process.env.tenaTenant) return;
    let items;
    try {
      const sqlQuery = `
        SELECT mp.Codigo codi, mp.Nombre nom, mp.Precio/(1+(t.Iva/100)) PreuSinIva, mp.Precio, '' Familia, '1' EsSumable, t.Iva ,
        CASE
            WHEN CHARINDEX('|', cc.valor) > 0
            THEN SUBSTRING(cc.valor, CHARINDEX('|', cc.valor) + 1, LEN(cc.valor))
            ELSE isnull(cc.valor, '')
        END AS Cuenta,
        isnull(prov.NIF, '') as NIFProveedor, cc2.valor Refinterna
        FROM ccMateriasPrimas mp
        LEFT JOIN tipusIva2012 t ON mp.iva=t.Tipus
        LEFT JOIN ccNombreValor cc on mp.id = cc.id and cc.nombre='Contrapartida'
        LEFT JOIN ccNombreValor cc2 on mp.id = cc2.id and cc2.nombre='Refinterna'
        LEFT JOIN ccProveedores prov ON mp.proveedor = prov.id
        where mp.activo=1 and isnull(mp.codigo, '')<>''
        ${codiHIT ? `AND mp.Codigo = '${codiHIT}'` : 'ORDER BY mp.Codigo'}
      `;

      items = await this.sqlService.runSql(sqlQuery, database);

      if (items.recordset.length > 0) console.log('🔍 Primer registro:', JSON.stringify(items.recordset[0]));
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
        console.log(`🔄 Procesando artículo MP: ${item.codi} - ${item.nom}`);
        const itemData1 = {
          number: `${item.codi}`,
          displayName: `${item.nom.substring(0, 100)}`,
          type: 'Non_x002D_Inventory',
          baseUnitOfMeasureCode: `${baseUnitOfMeasure}`,
          unitPrice: item.Precio,
          generalProductPostingGroupCode: item.Cuenta.substring(0, 3) == '705' ? 'SERVICIOS' : 'MERCADERÍA',
          VATProductPostingGroup: 'IVA' + (item.Iva ?? 0),
        };
        //Hay parámetros que no se pueden poner cuando creas el artículo y hay que actualizarlos despues de crearlo
        let vendorNo = '';
        if (item.NIFProveedor) {
          try {
            const vendorData = await this.vendors.getVendorFromAPI(companyID, database, item.NIFProveedor, client_id, client_secret, tenant, entorno);
            if (vendorData && typeof vendorData !== 'boolean') {
              vendorNo = vendorData.vendorNumber;
            }
          } catch (error) {
            this.logError(`⚠️ No se pudo crear/obtener el proveedor con NIF ${item.NIFProveedor}`, error);
          }
        }
        const itemData2 = {
          priceIncludesTax: true,
          vendorNo: vendorNo,
          vendorItemNo: item.Refinterna || '',
        };

        let res;
        try {
          res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/items?$filter=number eq '${item.codi}'`, {
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
            res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/items?$filter=number eq '${item.codi}'`, {
              headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json',
              },
            });
          }
          this.logError(`❌ Error consultando articulo en BC con plu ${item.codi}`, error);
          continue;
        }

        if (res.data.value.length > 0) console.log('🔍 Campos disponibles en item BC:', JSON.stringify(res.data.value[0], null, 2));
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
        this.logError(`❌ Error al procesar el artículo ${item.nom}, ${item.codi}`, error);
        if (codiHIT) {
          throw error;
        }
        continue;
      }
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

      const updatedItemId = await this.syncItemsMP(companyID, database, client_id, client_secret, tenant, entorno, codiHIT);
      return updatedItemId ? String(updatedItemId) : itemId;
    }

    const newItemId = await this.syncItemsMP(companyID, database, client_id, client_secret, tenant, entorno, codiHIT);
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
