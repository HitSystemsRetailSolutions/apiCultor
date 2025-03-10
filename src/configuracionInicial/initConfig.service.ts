import { Injectable } from '@nestjs/common';
import { getTokenService } from '../connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConection.service';
import axios from 'axios';
import * as mqtt from 'mqtt';

@Injectable()
export class initConfigService {
  private client = mqtt.connect({
    host: process.env.MQTT_HOST,
    username: process.env.MQTT_USER,
    password: process.env.MQTT_PASSWORD,
  });

  constructor(
    private tokenService: getTokenService,
    private sqlService: runSqlService,
  ) {}

  async initConfig(companyID: string, database: string, client_id: string, client_secret: string, tenant: string, entorno: string) {
    console.log('🚀 Iniciando configuración');
    try {
      await this.paymentMethods(companyID, database, client_id, client_secret, tenant, entorno);
      await this.syncTaxGroups(companyID, database, client_id, client_secret, tenant, entorno);
      await this.syncVATPostingSetup(companyID, database, client_id, client_secret, tenant, entorno);
      await this.createClientesContado(companyID, database, client_id, client_secret, tenant, entorno);
      await this.createCatalanLanguage(companyID, client_id, client_secret, tenant, entorno);
      console.log('✅ Configuración inicial completada');
      return true;
    } catch (error) {
      this.logError('❌ Error durante la configuración inicial', error);
      return false;
    }
  }

  async paymentMethods(companyID: string, database: string, client_id: string, client_secret: string, tenant: string, entorno: string) {
    //El code no puede superar los 10 caracteres
    const paymentMethods = ['UNDEFINED', 'EFECTIVO', 'TRANSF.', 'DOM.', 'CHEQUE'];
    const token = await this.tokenService.getToken2(client_id, client_secret, tenant);
    let i = 1;
    for (const paymentMethod of paymentMethods) {
      try {
        const paymentMethodData = {
          code: `${paymentMethod}`,
          displayName: `Pago por ${paymentMethod.toLowerCase()}`,
        };
        const res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/paymentMethods?$filter=code eq '${paymentMethod}'`, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });
        if (res.data.value.length === 0) {
          await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/paymentMethods`, paymentMethodData, {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          });
        } else {
          const etag = res.data.value[0]['@odata.etag'];
          await axios.patch(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/paymentMethods(${res.data.value[0].id})`, paymentMethodData, {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
              'If-Match': etag,
            },
          });
        }
      } catch (error) {
        this.logError(`❌ Error al crear el metodo de pago ${paymentMethod}`, error);
      }
      console.log(`⏳ Sincronizando método de pago ${paymentMethod} ... -> ${i}/${paymentMethods.length} --- ${((i / paymentMethods.length) * 100).toFixed(2)}% `);
      i++;
    }
  }

  async syncTaxGroups(companyID: string, database: string, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let ivas;
    try {
      ivas = await this.sqlService.runSql(`SELECT Iva FROM TipusIva ORDER BY Iva`, database);
    } catch (error) {
      this.logError(`❌ Error al ejecutar la consulta SQL en la base de datos '${database}'`, error);
      return false;
    }

    if (ivas.recordset.length == 0) {
      this.client.publish('/Hit/Serveis/Apicultor/Log', 'No hay registros');
      console.warn('⚠️ Advertencia: No se encontraron registros de ivas en la base de datos');
      return false;
    }

    const token = await this.tokenService.getToken2(client_id, client_secret, tenant);
    let i = 1;
    for (const iva of ivas.recordset) {
      for (const suffix of ['', 'RE']) {
        try {
          const ivaCode = `IVA${iva.Iva}${suffix}`;
          const ivaData = {
            code: ivaCode,
            displayName: `IVA ${iva.Iva}%${suffix ? ' + RE' : ''}`,
          };
          const res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/taxGroups?$filter=code eq '${ivaCode}'`, {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          });
          if (res.data.value.length === 0) {
            await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/taxGroups`, ivaData, {
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
            });
          } else {
            const etag = res.data.value[0]['@odata.etag'];
            await axios.patch(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/taxGroups(${res.data.value[0].id})`, ivaData, {
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                'If-Match': etag,
              },
            });
          }
        } catch (error) {
          this.logError(`❌ Error al crear el IVA ${iva.Iva}${suffix ? ' + RE' : ''}`, error);
        }
      }
      console.log(`⏳ Sincronizando IVA ${iva.Iva} ... -> ${i}/${ivas.recordset.length} --- ${((i / ivas.recordset.length) * 100).toFixed(2)}% `);
      i++;
    }
  }

  async syncVATPostingSetup(companyID: string, database: string, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let ivas;
    try {
      ivas = await this.sqlService.runSql(`select Iva, Irpf as RE from TipusIva order by Iva`, database);
    } catch (error) {
      this.logError(`❌ Error al ejecutar la consulta SQL en la base de datos '${database}'`, error);
      return false;
    }

    if (ivas.recordset.length == 0) {
      this.client.publish('/Hit/Serveis/Apicultor/Log', 'No hay registros');
      console.log('⚠️ Advertencia: No se encontraron registros de ivas en la base de datos');
      return false;
    }

    const token = await this.tokenService.getToken2(client_id, client_secret, tenant);
    let i = 1;
    for (const iva of ivas.recordset) {
      for (const suffix of ['', 'RE']) {
        try {
          const ivaCode = `IVA${iva.Iva}${suffix}`;
          const ivaData = {
            vatBusPostingGroup: 'NAC',
            vatProdPostingGroup: ivaCode,
            vatCalculationType: 'Normal_x0020_VAT',
            adjustForPaymentDiscount: false,
            salesVATAccount: '4770001',
            purchaseVATAccount: '4720001',
            vatIdentifier: ivaCode,
            taxCategory: 'S',
            description: `NAC / ${ivaCode}`,
            RE: suffix ? iva.RE : 0,
            vat: iva.Iva,
          };
          const resIva = await axios.get(
            `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/VATPostingSetup?$filter=vatIdentifier eq '${ivaCode}' and vatBusPostingGroup eq 'NAC' and vatProdPostingGroup eq '${ivaCode}'`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
            },
          );

          if (resIva.data.value.length === 0) {
            await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/VATPostingSetup`, ivaData, {
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
            });
          } else {
            const etag = resIva.data.value[0]['@odata.etag'];
            //Si ya se han hecho movimientos con el IVA no se puede modificar y esta petición dará error
            await axios.patch(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/VATPostingSetup(${resIva.data.value[0].id})`, ivaData, {
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                'If-Match': etag,
              },
            });
          }
        } catch (error) {
          this.logError(`❌ Error al crear el IVA ${iva.Iva}${suffix ? ' + RE' : ''}`, error);
        }
      }
      console.log(`⏳ Sincronizando IVA ${iva.Iva} en VAT Posting Setup ... -> ${i}/${ivas.recordset.length} --- ${((i / ivas.recordset.length) * 100).toFixed(2)}% `);
      i++;
    }
  }

  async createCatalanLanguage(companyID: string, client_id: string, client_secret: string, tenant: string, entorno: string) {
    const token = await this.tokenService.getToken2(client_id, client_secret, tenant);
    try {
      const languageData = {
        code: 'CAT',
        name: 'Català',
        windowsLanguageId: 1027,
      };

      let res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/language?$filter=code eq 'CAT'`, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      });

      if (res.data.value.length == 0) {
        await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/language`, languageData, {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        });
      } else {
        const etag = res.data.value[0]['@odata.etag'];
        await axios.patch(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/language(${res.data.value[0].id})`, languageData, {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
            'If-Match': etag,
          },
        });
      }
    } catch (error) {
      this.logError(`❌ Error al crear el lenguaje catalán`, error);
      throw error;
    }
    console.log('✅ Lenguaje catalán creado');
  }

  async createClientesContado(companyID: string, database: string, client_id: string, client_secret: string, tenant: string, entorno: string) {
    const token = await this.tokenService.getToken2(client_id, client_secret, tenant);
    const customerData = {
      number: `22222222T`,
      displayName: `CLIENTES CONTADO TIENDAS`,
      type: 'Company',
      addressLine1: `.`,
      city: `.`,
      country: 'ES',
      taxRegistrationNumber: `22222222T`,
      currencyCode: 'EUR',
      formatRegion: 'es-ES_tradnl',
      languageCode: 'CAT',
      customerPostingGroup: 'NAC',
      pricesIncludingVAT: 'true',
    };

    let res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/customers?$filter=number eq '22222222T'`, {
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
    });

    if (res.data.value.length == 0) {
      await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/customers`, customerData, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      });
    } else {
      const etag = res.data.value[0]['@odata.etag'];
      await axios.patch(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/customers(${res.data.value[0].id})`, customerData, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
          'If-Match': etag,
        },
      });
    }
    console.log('✅ Cliente contado creado');
  }

  private logError(message: string, error: any) {
    this.client.publish('/Hit/Serveis/Apicultor/Log', JSON.stringify({ message, error: error.response?.data || error.message }));
    console.error(message, error.response?.data || error.message);
  }
}
