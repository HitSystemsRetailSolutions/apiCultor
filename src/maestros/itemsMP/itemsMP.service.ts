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
  ) { }

  async syncItemsMP(companyID: string, database: string, client_id: string, client_secret: string, tenant: string, entorno: string, codiHIT?: string) {
    if (tenant === process.env.tenaTenant) return;

    let items;
    try {
      const sqlQuery = `
        SELECT 'MP_' + case when isnull(mp.Codigo, '')='' then left(mp.Nombre, 5) else mp.Codigo end codi, mp.Nombre nom, mp.Precio/(1+(t.Iva/100)) PreuSinIva, mp.Precio, '' Familia, '1' EsSumable, t.Iva ,
        CASE
            WHEN CHARINDEX('|', cc.valor) > 0
            THEN SUBSTRING(cc.valor, CHARINDEX('|', cc.valor) + 1, LEN(cc.valor))
            ELSE isnull(cc.valor, '')
        END AS Cuenta,
        isnull(prov.NIF, '') as NIFProveedor, cc2.valor Refinterna, isnull(cc3.valor, '') Inventari
        FROM ccMateriasPrimas mp
        LEFT JOIN tipusIva2012 t ON mp.iva=t.Tipus
        LEFT JOIN ccNombreValor cc on mp.id = cc.id and cc.nombre='Contrapartida'
        LEFT JOIN ccNombreValor cc2 on mp.id = cc2.id and cc2.nombre='Refinterna'
        LEFT JOIN ccNombreValor cc3 on mp.id = cc3.id and cc3.nombre='Inventari'
        LEFT JOIN ccProveedores prov ON mp.proveedor = prov.id
        where mp.activo=1 and isnull(mp.codigo, '')<>''
        ${codiHIT ? `AND mp.Codigo = '${codiHIT}'` : 'ORDER BY mp.Codigo'}
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
        const inventoryPostingGroupId = await this.getInventoryPostingGroupId('MERCADERÍA', companyID, client_id, client_secret, tenant, entorno);
        const itemTrackingCode = await this.getItemTrackingCode(companyID, client_id, client_secret, tenant, entorno);
        //Datos para crear el artículo
        console.log(`🔄 Procesando artículo MP: ${item.codi} - ${item.nom}`);
        const itemData1 = {
          number: `${item.codi}`,
          displayName: `${item.nom.substring(0, 100)}`,
          type: item.Inventari == 'on' ? 'Inventory' : 'Non_x002D_Inventory',
          ...(item.Inventari == 'on' ? { inventoryPostingGroupId: `${inventoryPostingGroupId}` } : {}),
          baseUnitOfMeasureCode: `${baseUnitOfMeasure}`,
          unitPrice: item.Precio,
          generalProductPostingGroupCode: item.Cuenta.substring(0, 3) == '705' ? 'SERVICIOS' : 'MERCADERÍA',
          VATProductPostingGroup: 'IVA' + (item.Iva ?? 0),
          ...(item.Inventari == 'on' ? { itemTrackingCode: `${itemTrackingCode}` } : {}),
        };
        //Hay parámetros que no se pueden poner cuando creas el artículo y hay que actualizarlos despues de crearlo
        let vendorNo = '';
        if (item.NIFProveedor) {
          try {
            const vendorData = await this.vendors.getVendorNOFromAPI(companyID, database, item.NIFProveedor, client_id, client_secret, tenant, entorno);
            if (vendorData && typeof vendorData !== 'boolean') {
              vendorNo = vendorData;
            }
          } catch (error) {
            this.logError(`⚠️ No se pudo crear/obtener el proveedor con NIF ${item.NIFProveedor}`, error);
          }
        }
        const itemData2 = {
          priceIncludesTax: true,
          vendorNo: vendorNo,
          vendorItemNo: item.Refinterna || '',
          ...(item.Inventari == 'on' ? { itemTrackingCode: 'CS00001' } : {}),
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
          const existingType = existingItem.type;

          if (existingType !== itemData1.type) {
            try {
              // BC no permite cambiar el tipo directamente, intentamos borrar y recrear
              await axios.delete(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/items(${existingItem.id})`, {
                headers: {
                  Authorization: 'Bearer ' + token,
                  'If-Match': existingItem['@odata.etag'],
                },
              });

              const createItem = await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/items`, itemData1, {
                headers: {
                  Authorization: 'Bearer ' + token,
                  'Content-Type': 'application/json',
                },
              });
              itemId = createItem.data.id;
              if (createItem.data.VATProductPostingGroup) {
                await axios.patch(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/items(${itemId})`, itemData2, {
                  headers: {
                    Authorization: 'Bearer ' + token,
                    'Content-Type': 'application/json',
                    'If-Match': createItem.data['@odata.etag'],
                  },
                });
              }
            } catch (deleteError) {
              // Si falla el borrado porque está siendo usado en una factura, interceptamos el error
              const isOutstandingInvoiceError = deleteError.response?.data?.error?.code === 'Application_DialogException' ||
                deleteError.response?.data?.error?.message?.includes('outstanding');

              if (isOutstandingInvoiceError) {
                this.logError(`⚠️ No se pudo cambiar el tipo de ${item.codi} de '${existingType}' a '${itemData1.type}' porque está asociado a documentos pendientes en BC. Se actualiza el resto de campos conservando el tipo original.`, deleteError);

                // Hacemos el PATCH alternativo sin intentar alterar el 'type'
                let etag = existingItem['@odata.etag'];
                const { type, ...itemDataWithoutType } = itemData1;
                const updateItem = await axios.patch(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/items(${existingItem.id})`, itemDataWithoutType, {
                  headers: {
                    Authorization: 'Bearer ' + token,
                    'Content-Type': 'application/json',
                    'If-Match': etag,
                  },
                });
                etag = updateItem.data['@odata.etag'];
                if (updateItem.data.VATProductPostingGroup) {
                  await axios.patch(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/items(${existingItem.id})`, itemData2, {
                    headers: {
                      Authorization: 'Bearer ' + token,
                      'Content-Type': 'application/json',
                      'If-Match': etag,
                    },
                  });
                }
                itemId = existingItem.id;
              } else {
                // Si es un error distinto al de documentos pendientes, lo relanzamos
                throw deleteError;
              }
            }
          } else {
            let etag = existingItem['@odata.etag'];
            const { type, ...itemDataWithoutType } = itemData1;
            const updateItem = await axios.patch(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/items(${existingItem.id})`, itemDataWithoutType, {
              headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json',
                'If-Match': etag,
              },
            });
            etag = updateItem.data['@odata.etag'];
            if (updateItem.data.VATProductPostingGroup) {
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

  private async getItemTrackingCode(companyID: string, client_id: string, client_secret: string, tenant: string, entorno: string): Promise<string> {
    try {
      const token = await this.tokenService.getToken2(client_id, client_secret, tenant);
      const code = 'CS00001';
      const res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/itemTrackingCode?$filter=code eq '${code}'`, {
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      });
      if (res.data.value.length === 0) {
        await axios.post(
          `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/itemTrackingCode`,
          {
            code: code,
            description: code,
            SNSpecificTracking: true,
            CreateSNInfoonPosting: true,
            SNInfoInboundMustExist: true,
            SNPurchaseInboundTracking: true,
            SNSalesInboundTracking: true,
            SNPosAdjmtInbTracking: true,
            SNNegAdjmtInbTracking: true,
            SNManufInboundTracking: true,
            SNAssemblyInboundTracking: true,
            SNWarehouseTracking: true,
            SNTransferTracking: true,
            SNInfoOutboundMustExist: true,
            SNPurchaseOutboundTracking: true,
            SNSalesOutboundTracking: true,
            SNPosAdjmtOutbTracking: true,
            SNNegAdjmtOutbTracking: true,
            SNManufOutboundTracking: true,
            SNAssemblyOutboundTracking: true,
          },
          {
            headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          },
        );
        return res.data.value.length === 0 ? '' : res.data.value[0].code;
      }
      return code;
    } catch (error) {
      this.logError('❌ Error obteniendo itemTrackingCode CS00001', error);
    }
  }

  private async getIdFromAPI(endpoint: string, filter: string, companyID: string, client_id: string, client_secret: string, tenant: string, entorno: string): Promise<string> {
    try {
      const token = await this.tokenService.getToken2(client_id, client_secret, tenant);
      const url = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/${endpoint}?$filter=${filter}`;
      const res = await axios.get(url, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      });
      return res.data.value.length === 0 ? '' : res.data.value[0].id;
    } catch (error) {
      this.logError(`❌ Error obteniendo ID desde API para endpoint ${endpoint}`, error);
      throw error;
    }
  }

  private getBaseUnitOfMeasure(esSumable: number | boolean): string {
    const value = typeof esSumable === 'boolean' ? Number(esSumable) : esSumable;
    return value === 0 ? 'KG' : 'UDS';
  }

  async getInventoryPostingGroupId(pInventoryGroupCode: string, companyID: string, client_id: string, client_secret: string, tenant: string, entorno: string) {
    const id = await this.getIdFromAPI('inventoryPostingGroups', `code eq '${pInventoryGroupCode}'`, companyID, client_id, client_secret, tenant, entorno);
    return id;
  }

  async getItemFromAPI(companyID: string, database: string, codiHIT: string, client_id: string, client_secret: string, tenant: string, entorno: string): Promise<string | false> {
    let token = await this.tokenService.getToken2(client_id, client_secret, tenant);
    let res;
    try {
      res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/items?$filter=number eq 'MP_${codiHIT}'`, {
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
      console.warn(`⚠️ No se pudo crear el artículo con codiHIT MP_${codiHIT}`);
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