import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { getTokenService } from 'src/connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConnection.service';
import { vendorsService } from 'src/maestros/vendors/vendors.service';
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
  private itemTrackingCodePromises = new Map<string, Promise<string>>();

  constructor(
    private tokenService: getTokenService,
    private sqlService: runSqlService,
    private vendors: vendorsService,
  ) { }

  /**
   * Sincronización unificada de artículos (ventas + compras) hacia Business Central.
   * Combina datos de Articles y ccMateriasPrimas usando articlespropietats como vínculo.
   * Todos los artículos se crean con prefijo ART_ (o ART_MP_ para materias primas sin artículo de venta).
   */
  async syncItems(companyID: string, database: string, client_id: string, client_secret: string, tenant: string, entorno: string, codiHIT?: string, source?: 'sale' | 'purchase') {
    if (tenant === process.env.tenaTenant) return;

    let items;
    try {
      // Consulta 1: Artículos de venta (con posible vinculación a materia prima)
      const sqlQueryArticles = `
        SELECT 
          'ART_' + CAST(a.Codi AS VARCHAR) AS CodiBC,
          a.Codi,
          a.Nom, 
          a.Preu/(1+(t.Iva/100)) PreuSinIva, 
          a.Preu, 
          LEFT(a.Familia, 20) Familia, 
          a.EsSumable, 
          t.Iva,
          isnull(fe3.valor, isnull(fe2.valor, isnull(fe1.valor, '700000000'))) Cuenta,
          -- Datos de la materia prima vinculada (si existe)
          isnull(prov.NIF, '') as NIFProveedor, 
          cc2.valor Refinterna, 
          isnull(cc3.valor, '') Inventari,
          'article' as Origen
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
        LEFT JOIN articlespropietats ap ON a.Codi = ap.CodiArticle AND ap.Variable = 'MatPri'
        LEFT JOIN ccMateriasPrimas mp ON ap.Valor = mp.id
        LEFT JOIN ccNombreValor cc2 ON mp.id = cc2.id AND cc2.nombre='Refinterna'
        LEFT JOIN ccNombreValor cc3 ON mp.id = cc3.id AND cc3.nombre='Inventari'
        LEFT JOIN ccProveedores prov ON mp.proveedor = prov.id
        ${codiHIT && source !== 'purchase' ? `WHERE a.codi = ${codiHIT}` : ''}
      `;

      // Consulta 2: Materias primas SIN artículo de venta vinculado
      const sqlQueryMPOnly = `
        SELECT 
          'ART_MP_' + CASE WHEN isnull(mp.Codigo, '')='' THEN LEFT(mp.Nombre, 5) ELSE mp.Codigo END AS CodiBC,
          NULL as Codi,
          mp.Nombre AS Nom, 
          mp.Precio/(1+(t.Iva/100)) PreuSinIva, 
          mp.Precio Preu, 
          '' Familia, 
          '1' EsSumable, 
          t.Iva,
          CASE
            WHEN CHARINDEX('|', cc.valor) > 0
            THEN SUBSTRING(cc.valor, CHARINDEX('|', cc.valor) + 1, LEN(cc.valor))
            ELSE isnull(cc.valor, '')
          END AS Cuenta,
          isnull(prov.NIF, '') as NIFProveedor, 
          cc2.valor Refinterna, 
          isnull(cc3.valor, '') Inventari,
          'mp' as Origen
        FROM ccMateriasPrimas mp
        LEFT JOIN tipusIva2012 t ON mp.iva=t.Tipus
        LEFT JOIN ccNombreValor cc on mp.id = cc.id and cc.nombre='Contrapartida'
        LEFT JOIN ccNombreValor cc2 on mp.id = cc2.id and cc2.nombre='Refinterna'
        LEFT JOIN ccNombreValor cc3 on mp.id = cc3.id and cc3.nombre='Inventari'
        LEFT JOIN ccProveedores prov ON mp.proveedor = prov.id
        WHERE mp.activo=1
          ${!codiHIT ? `AND isnull(mp.codigo, '')<>''` : ''}
          AND mp.id NOT IN (SELECT Valor FROM articlespropietats WHERE Variable='MatPri')
          ${codiHIT && source === 'purchase' ? `AND mp.Codigo = '${codiHIT}'` : ''}
      `;

      // Si viene de una venta, solo necesitamos artículos de venta
      // Si viene de una compra, solo materias primas sin vínculo
      // Si es sync completo (sin source), ejecutamos ambas
      if (codiHIT && source === 'sale') {
        items = await this.sqlService.runSql(sqlQueryArticles, database);
      } else if (codiHIT && source === 'purchase') {
        // Primero intentar buscar si la MP está vinculada a un artículo de venta
        const linkedQuery = `
          SELECT 
            'ART_' + CAST(a.Codi AS VARCHAR) AS CodiBC,
            a.Codi,
            a.Nom, 
            a.Preu/(1+(t.Iva/100)) PreuSinIva, 
            a.Preu, 
            LEFT(a.Familia, 20) Familia, 
            a.EsSumable, 
            t.Iva,
            isnull(fe3.valor, isnull(fe2.valor, isnull(fe1.valor, '700000000'))) Cuenta,
            isnull(prov.NIF, '') as NIFProveedor, 
            cc2.valor Refinterna, 
            isnull(cc3.valor, '') Inventari,
            'article' as Origen
          FROM ccMateriasPrimas mp
          INNER JOIN articlespropietats ap ON ap.Valor = mp.id AND ap.Variable = 'MatPri'
          INNER JOIN Articles a ON a.Codi = ap.CodiArticle
          LEFT JOIN tipusIva2012 t ON a.Tipoiva=t.Tipus
          LEFT JOIN families f3 on a.familia=f3.Nom 
          LEFT JOIN families f2 on f3.pare=f2.Nom 
          LEFT JOIN families f1 on f2.pare=f1.Nom 
          LEFT JOIN familiesextes fe3 on f3.nom=fe3.familia and fe3.variable='CUENTA_CONTABLE'
          LEFT JOIN familiesextes fe2 on f2.nom=fe2.familia and fe2.variable='CUENTA_CONTABLE'
          LEFT JOIN familiesextes fe1 on f1.nom=fe1.familia and fe1.variable='CUENTA_CONTABLE'
          LEFT JOIN ccNombreValor cc2 ON mp.id = cc2.id AND cc2.nombre='Refinterna'
          LEFT JOIN ccNombreValor cc3 ON mp.id = cc3.id AND cc3.nombre='Inventari'
          LEFT JOIN ccProveedores prov ON mp.proveedor = prov.id
          WHERE mp.Codigo = '${codiHIT}'
        `;
        items = await this.sqlService.runSql(linkedQuery, database);
        // Si no está vinculado, buscar como MP independiente
        if (items.recordset.length === 0) {
          items = await this.sqlService.runSql(sqlQueryMPOnly, database);
        }
      } else {
        // Sync completo: artículos de venta + materias primas independientes
        const articlesResult = await this.sqlService.runSql(sqlQueryArticles + ' ORDER BY a.codi', database);
        const mpOnlyResult = await this.sqlService.runSql(sqlQueryMPOnly + ' ORDER BY mp.Codigo', database);
        items = {
          recordset: [...articlesResult.recordset, ...mpOnlyResult.recordset],
        };
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

    let token = await this.tokenService.getToken2(client_id, client_secret, tenant);
    let itemId = '';
    let i = 1;
    for (const item of items.recordset) {
      try {
        const baseUnitOfMeasure = this.getBaseUnitOfMeasure(item.EsSumable);
        const isInventory = item.Inventari == 'on';
        const itemName = String(item.Nom ?? item.nom ?? item.Nombre ?? item.CodiBC);
        const cuenta = String(item.Cuenta ?? '700000000');

        // Obtener datos adicionales solo si es inventariable.
        let inventoryPostingGroupId = '';
        let itemTrackingCode = '';
        if (isInventory) {
          inventoryPostingGroupId = await this.getInventoryPostingGroupId('MERCADERÍA', companyID, client_id, client_secret, tenant, entorno);
          itemTrackingCode = await this.getItemTrackingCode(companyID, client_id, client_secret, tenant, entorno);
        }

        console.log(`🔄 Procesando artículo: ${item.CodiBC} - ${itemName} (origen: ${item.Origen})`);

        //Datos para crear el artículo (campos unificados de ventas + compras)
        const itemData1: any = {
          number: `${item.CodiBC}`,
          displayName: `${itemName.substring(0, 100)}`,
          type: isInventory ? 'Inventory' : 'Non_x002D_Inventory',
          ...(isInventory ? { inventoryPostingGroupId: `${inventoryPostingGroupId}` } : {}),
          baseUnitOfMeasureCode: `${baseUnitOfMeasure}`,
          unitPrice: item.Preu,
          generalProductPostingGroupCode: cuenta.substring(0, 3) == '705' ? 'SERVICIOS' : 'MERCADERÍA',
          VATProductPostingGroup: 'IVA' + (item.Iva ?? 0),
          ...(isInventory && itemTrackingCode ? { itemTrackingCode: itemTrackingCode } : {}),
        };

        //Hay parámetros que no se pueden poner cuando creas el artículo y hay que actualizarlos despues de crearlo
        // Obtener datos del proveedor.
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

        const itemData2: any = {
          priceIncludesTax: true,
          ...(vendorNo ? { vendorNo: vendorNo } : {}),
          ...(item.Refinterna ? { vendorItemNo: item.Refinterna } : {}),
          ...(isInventory && itemTrackingCode ? { itemTrackingCode: itemTrackingCode } : {}),
        };

        let res;
        try {
          res = await this.requestWithRetry(() =>
            axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/items?$filter=number eq '${item.CodiBC}'`, {
              headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json',
              },
            }),
            `consultar articulo ${item.CodiBC}`,
          );
        } catch (error) {
          if (error.response?.status === 401) {
            console.log('Token expirado. Renovando token...');
            token = await this.tokenService.getToken2(client_id, client_secret, tenant);
            if (!token) {
              console.log('No se pudo renovar el token');
              return false;
            }
            res = await this.requestWithRetry(() =>
              axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/items?$filter=number eq '${item.CodiBC}'`, {
                headers: {
                  Authorization: 'Bearer ' + token,
                  'Content-Type': 'application/json',
                },
              }),
              `consultar articulo ${item.CodiBC}`,
            );
          }
          this.logError(`❌ Error consultando articulo en BC con código ${item.CodiBC}`, error);
          continue;
        }

        if (res.data.value.length === 0) {
          // Crear artículo nuevo
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
          // Artículo ya existe — actualizar
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
                this.logError(`⚠️ No se pudo cambiar el tipo de ${item.CodiBC} de '${existingType}' a '${itemData1.type}' porque está asociado a documentos pendientes en BC. Se actualiza el resto de campos conservando el tipo original.`, deleteError);

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
            // Mismo tipo — actualizar campos
            let etag = existingItem['@odata.etag'];
            const { type, ...itemDataWithoutType } = itemData1;

            // Comprobar si hay cambios en cualquiera de los campos
            const hasChanged1 =
              existingItem.displayName !== itemDataWithoutType.displayName ||
              existingItem.baseUnitOfMeasureCode !== itemDataWithoutType.baseUnitOfMeasureCode ||
              Number(existingItem.unitPrice) !== Number(itemDataWithoutType.unitPrice) ||
              existingItem.generalProductPostingGroupCode !== itemDataWithoutType.generalProductPostingGroupCode ||
              existingItem.VATProductPostingGroup !== itemDataWithoutType.VATProductPostingGroup;

            const hasChanged2 =
              existingItem.priceIncludesTax !== itemData2.priceIncludesTax ||
              (itemData2.vendorNo && existingItem.vendorNo !== itemData2.vendorNo) ||
              (itemData2.vendorItemNo && existingItem.vendorItemNo !== itemData2.vendorItemNo) ||
              (itemData2.itemTrackingCode && existingItem.itemTrackingCode !== itemData2.itemTrackingCode);

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
        this.logError(`❌ Error al procesar el artículo ${item.Nom ?? item.CodiBC}, ${item.CodiBC}`, error);
        if (codiHIT) {
          throw error;
        }
        continue;
      }
      console.log(`⏳ Sincronizando producto ${item.Nom ?? item.CodiBC} ... -> ${i}/${items.recordset.length} --- ${((i / items.recordset.length) * 100).toFixed(2)}% `);
      i++;
    }
    if (codiHIT) {
      return itemId;
    }
    return true;
  }

  /**
   * Resuelve el código BC unificado para un artículo dado su código local y el origen.
   * - sale (PLU): ART_<PLU>
   * - purchase (Codigo MP): Si vinculado a artículo de venta → ART_<CodiArticle>. Si no → ART_MP_<Codigo>
   */
  async resolveItemCodeBC(database: string, codiHIT: string, source: 'sale' | 'purchase'): Promise<string> {
    if (source === 'sale') {
      return `ART_${codiHIT}`;
    }

    // source === 'purchase': buscar si la MP está vinculada a un artículo de venta
    try {
      const linkedQuery = `
        SELECT ap.CodiArticle 
        FROM ccMateriasPrimas mp
        INNER JOIN articlespropietats ap ON ap.Valor = mp.id AND ap.Variable = 'MatPri'
        WHERE mp.Codigo = '${codiHIT}'
      `;
      const result = await this.sqlService.runSql(linkedQuery, database);
      if (result.recordset.length > 0) {
        return `ART_${result.recordset[0].CodiArticle}`;
      }
    } catch (error) {
      this.logError(`⚠️ Error buscando vinculación de materia prima ${codiHIT}`, error);
    }

    // No está vinculada → código independiente
    return `ART_MP_${codiHIT}`;
  }

  /**
   * Obtiene o crea un artículo en BC a partir de su código local.
   * Devuelve un objeto con el id del artículo en BC y el número (código BC).
   */
  async getItemFromAPI(companyID: string, database: string, codiHIT: string, client_id: string, client_secret: string, tenant: string, entorno: string, source: 'sale' | 'purchase' = 'sale'): Promise<string | false> {
    const codiBC = await this.resolveItemCodeBC(database, codiHIT, source);

    let token = await this.tokenService.getToken2(client_id, client_secret, tenant);
    let res;
    try {
      res = await this.requestWithRetry(() =>
        axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/items?$filter=number eq '${codiBC}'`, {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        }),
        `consultar item ${codiBC}`,
      );
    } catch (error) {
      this.logError(`❌ Error consultando item con código ${codiBC}`, error);
      throw error;
    }

    if (res.data.value.length > 0) {
      const item = res.data.value[0];
      const itemId = item.id;

      const updatedItemId = await this.syncItems(companyID, database, client_id, client_secret, tenant, entorno, codiHIT, source);
      return updatedItemId ? String(updatedItemId) : itemId;
    }

    const newItemId = await this.syncItems(companyID, database, client_id, client_secret, tenant, entorno, codiHIT, source);
    if (!newItemId) {
      console.warn(`⚠️ No se pudo crear el artículo con código ${codiBC}`);
      return false;
    }
    return String(newItemId);
  }

  /**
   * Obtiene el código BC de un artículo dado su código local y origen.
   * Útil para los consumidores que necesitan el número del artículo en BC (ej: tracking specifications).
   */
  async getItemNumberBC(database: string, codiHIT: string, source: 'sale' | 'purchase' = 'sale'): Promise<string> {
    return this.resolveItemCodeBC(database, codiHIT, source);
  }

  async getItemNumberFromAPI(companyID: string, itemId: string, client_id: string, client_secret: string, tenant: string, entorno: string): Promise<string> {
    const token = await this.tokenService.getToken2(client_id, client_secret, tenant);
    const res = await this.requestWithRetry(() =>
      axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/items(${itemId})`, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      }),
      `consultar numero de item ${itemId}`,
    );

    return res.data.number || '';
  }

  private getBaseUnitOfMeasure(esSumable: number | boolean): string {
    const value = typeof esSumable === 'boolean' ? Number(esSumable) : esSumable;
    return value === 0 ? 'KG' : 'UDS';
  }

  // --- Helpers de compras/inventario ---

  private async getItemTrackingCode(companyID: string, client_id: string, client_secret: string, tenant: string, entorno: string): Promise<string> {
    const cacheKey = `${tenant}|${entorno}|${companyID}|CS00001`;
    if (!this.itemTrackingCodePromises.has(cacheKey)) {
      const promise = this.ensureItemTrackingCode(companyID, client_id, client_secret, tenant, entorno)
        .catch((error) => {
          this.itemTrackingCodePromises.delete(cacheKey);
          throw error;
        });
      this.itemTrackingCodePromises.set(cacheKey, promise);
    }
    return this.itemTrackingCodePromises.get(cacheKey);
  }

  private async ensureItemTrackingCode(companyID: string, client_id: string, client_secret: string, tenant: string, entorno: string): Promise<string> {
    try {
      const token = await this.tokenService.getToken2(client_id, client_secret, tenant);
      const code = 'CS00001';
      const baseUrl = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/itemTrackingCode`;
      const res = await this.requestWithRetry(() =>
        axios.get(`${baseUrl}?$filter=code eq '${code}'`, {
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        }),
        `consultar itemTrackingCode ${code}`,
      );
      if (res.data.value.length === 0) {
        try {
          await this.requestWithRetry(() =>
            axios.post(baseUrl, { code: code, description: code }, {
              headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
            }),
            `crear itemTrackingCode ${code}`,
          );
        } catch (createError) {
          const alreadyExists = createError.response?.data?.error?.code === 'Internal_EntityWithSameKeyExists';
          if (!alreadyExists) {
            throw createError;
          }
        }
      }

      const trackingCode = await this.getItemTrackingCodeRecord(baseUrl, code, token);
      await this.ensureItemTrackingCodeForSerials(baseUrl, trackingCode, code, token);
      return code;
    } catch (error) {
      this.logError('❌ Error obteniendo itemTrackingCode CS00001', error);
      throw error;
    }
  }

  private async getItemTrackingCodeRecord(baseUrl: string, code: string, token: string) {
    const res = await this.requestWithRetry(() =>
      axios.get(`${baseUrl}?$filter=code eq '${code}'`, {
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      }),
      `consultar itemTrackingCode ${code}`,
    );
    const trackingCode = res.data.value[0];
    if (!trackingCode?.id) {
      throw new Error(`No se pudo obtener itemTrackingCode ${code}`);
    }
    return trackingCode;
  }

  private getItemTrackingCodeData(code: string) {
    return {
      code: code,
      description: code,
      SNSpecificTracking: false,
      CreateSNInfoonPosting: true,
      SNInfoInboundMustExist: false,
      SNPurchaseInboundTracking: true,
      SNSalesInboundTracking: false,
      SNPosAdjmtInbTracking: false,
      SNNegAdjmtInbTracking: false,
      SNManufInboundTracking: false,
      SNAssemblyInboundTracking: false,
      SNWarehouseTracking: false,
      SNTransferTracking: false,
      SNInfoOutboundMustExist: false,
      SNPurchaseOutboundTracking: false,
      SNSalesOutboundTracking: false,
      SNPosAdjmtOutbTracking: false,
      SNNegAdjmtOutbTracking: false,
      SNManufOutboundTracking: false,
      SNAssemblyOutboundTracking: false,
    };
  }

  private async ensureItemTrackingCodeForSerials(baseUrl: string, trackingCode: any, code: string, token: string) {
    const patch = async (data: any, etag?: string) => {
      const res = await this.requestWithRetry(() =>
        axios.patch(`${baseUrl}(${trackingCode.id})`, data, {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
            'If-Match': '*',
          },
        }),
        `actualizar itemTrackingCode ${code}`,
      );
      return res.data?.['@odata.etag'] || etag || trackingCode['@odata.etag'];
    };

    const { code: _code, description: _description, ...trackingData } = this.getItemTrackingCodeData(code);
    await patch(trackingData, trackingCode['@odata.etag']);
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

  async getInventoryPostingGroupId(pInventoryGroupCode: string, companyID: string, client_id: string, client_secret: string, tenant: string, entorno: string) {
    const id = await this.getIdFromAPI('inventoryPostingGroups', `code eq '${pInventoryGroupCode}'`, companyID, client_id, client_secret, tenant, entorno);
    return id;
  }

  private async requestWithRetry<T>(request: () => Promise<T>, context: string, maxRetries = 4): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await request();
      } catch (error) {
        const status = error?.response?.status;
        const code = error?.response?.data?.error?.code;
        if (status !== 429 && code !== 'TooManyRequests') {
          throw error;
        }
        if (attempt === maxRetries) {
          throw error;
        }

        const retryAfter = Number(error?.response?.headers?.['retry-after']);
        const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 1000 * Math.pow(2, attempt);
        console.warn(`⚠️ TooManyRequests al ${context}. Reintentando en ${delayMs} ms...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  private logError(message: string, error: any) {
    const errorDetail = error?.response?.data || error?.message || 'Error desconocido';
    this.client.publish('/Hit/Serveis/Apicultor/Log', JSON.stringify({ message, error: errorDetail }));
    console.error(message, errorDetail);
  }
}
