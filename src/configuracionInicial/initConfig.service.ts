import { Injectable } from '@nestjs/common';
import { getTokenService } from '../conection/getToken.service';
import { runSqlService } from 'src/conection/sqlConection.service';
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
    console.log('Init config');
    try {
      await this.paymentMethods(companyID, database, client_id, client_secret, tenant, entorno);
      await this.syncTaxGroups(companyID, database, client_id, client_secret, tenant, entorno);
      await this.syncVATPostingSetup(companyID, database, client_id, client_secret, tenant, entorno);
      return true;
    } catch (error) {
      this.logError('Error configuring:', error);
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
          const createPaymentMethod = await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/paymentMethods`, paymentMethodData, {
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
        this.logError(`Error al crear el metodo de pago ${paymentMethod}`, error);
      }
      console.log(`Synchronizing payment method ${paymentMethod} ... -> ${i}/${paymentMethods.length} --- ${((i / paymentMethods.length) * 100).toFixed(2)}% `);
      i++;
    }
  }

  async syncTaxGroups(companyID: string, database: string, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let ivas;
    try {
      ivas = await this.sqlService.runSql(`SELECT Iva FROM TipusIva ORDER BY Iva`, database);
    } catch (error) {
      this.logError(`Database '${database}' does not exist`, error);
      return false;
    }

    if (ivas.recordset.length == 0) {
      this.client.publish('/Hit/Serveis/Apicultor/Log', 'No hay registros');
      console.log('Ivas. No hay registros');
      return false;
    }

    const token = await this.tokenService.getToken2(client_id, client_secret, tenant);
    let i = 1;
    for (const iva of ivas.recordset) {
      try {
        const ivaData = {
          code: `IVA${iva.Iva}`,
          displayName: `IVA ${iva.Iva}%`,
        };
        const res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/taxGroups?$filter=code eq 'IVA${iva.Iva}'`, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });
        if (res.data.value.length === 0) {
          const createIva = await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/taxGroups`, ivaData, {
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
        this.logError(`Error al crear el IVA ${iva.Iva}`, error);
      }
      console.log(`Synchronizing IVA ${iva.Iva} ... -> ${i}/${ivas.recordset.length} --- ${((i / ivas.recordset.length) * 100).toFixed(2)}% `);
      i++;
    }
  }

  async syncVATPostingSetup(companyID: string, database: string, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let ivas;
    try {
      ivas = await this.sqlService.runSql(`select Iva, Irpf as RE from TipusIva order by Iva`, database);
    } catch (error) {
      this.logError(`Database '${database}' does not exist`, error);
      return false;
    }

    if (ivas.recordset.length == 0) {
      this.client.publish('/Hit/Serveis/Apicultor/Log', 'No hay registros');
      console.log('Ivas. No hay registros');
      return false;
    }

    const token = await this.tokenService.getToken2(client_id, client_secret, tenant);
    let i = 1;
    for (const iva of ivas.recordset) {
      try {
        const ivaData = {
          vatBusPostingGroup: 'NAC',
          vatProdPostingGroup: `IVA${iva.Iva}`,
          vatCalculationType: 'Normal_x0020_VAT',
          adjustForPaymentDiscount: false,
          salesVATAccount: '4770001',
          purchaseVATAccount: '4720001',
          vatIdentifier: `IVA${iva.Iva}`,
          taxCategory: 'S',
          description: `NAC / IVA${iva.Iva}`,
          RE: 0,
          vat: iva.Iva,
        };
        const resIva = await axios.get(
          `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/VATPostingSetup?$filter=vatIdentifier eq 'IVA${iva.Iva}' and vatBusPostingGroup eq 'NAC' and vatProdPostingGroup eq 'IVA${iva.Iva}'`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          },
        );

        if (resIva.data.value.length === 0) {
          const createIva = await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/VATPostingSetup`, ivaData, {
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
        this.logError(`Error al crear el IVA ${iva.Iva}`, error);
      }
      console.log(`Synchronizing iva ${iva.Iva} en VAT Posting Setup  ... -> ${i}/${ivas.recordset.length} --- ${((i / ivas.recordset.length) * 100).toFixed(2)}% `);
      i++;
    }
  }
  async syncVATPostingSetupRE(companyID: string, database: string, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let ivas;
    try {
      ivas = await this.sqlService.runSql(`select Iva, Irpf as RE from TipusIva order by Iva`, database);
    } catch (error) {
      this.logError(`Database '${database}' does not exist`, error);
      return false;
    }

    if (ivas.recordset.length == 0) {
      this.client.publish('/Hit/Serveis/Apicultor/Log', 'No hay registros');
      console.log('Ivas. No hay registros');
      return false;
    }

    const token = await this.tokenService.getToken2(client_id, client_secret, tenant);
    let i = 1;
    for (const iva of ivas.recordset) {
      try {
        const ivaREData = {
          vatBusPostingGroup: 'NAC',
          vatProdPostingGroup: `IVA${iva.Iva}RE`,
          vatCalculationType: 'Normal_x0020_VAT',
          adjustForPaymentDiscount: false,
          salesVATAccount: '4770001',
          purchaseVATAccount: '4720001',
          vatIdentifier: `IVA${iva.Iva}RE`,
          taxCategory: 'S',
          description: `NAC / IVA${iva.Iva}RE`,
          RE: iva.RE,
          vat: iva.Iva,
        };

        const resIvaRE = await axios.get(
          `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/VATPostingSetup?$filter=vatIdentifier eq 'IVA${iva.Iva}RE' and vatBusPostingGroup eq 'NAC' and vatProdPostingGroup eq 'IVA${iva.Iva}RE'`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          },
        );

        if (resIvaRE.data.value.length === 0) {
          const createIva = await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/VATPostingSetup`, ivaREData, {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          });
        } else {
          const etag = resIvaRE.data.value[0]['@odata.etag'];
          await axios.patch(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/VATPostingSetup(${resIvaRE.data.value[0].id})`, ivaREData, {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
              'If-Match': etag,
            },
          });
        }
      } catch (error) {
        this.logError(`Error al crear el IVA con RE ${iva.Iva}`, error);
      }
      console.log(`Synchronizing iva ${iva} en VAT Posting Setup RE ... -> ${i}/${ivas.recordset.length} --- ${((i / ivas.recordset.length) * 100).toFixed(2)}% `);
      i++;
    }
  }

  private logError(message: string, error: any) {
    this.client.publish('/Hit/Serveis/Apicultor/Log', message);
    console.error(message, error);
  }
}
