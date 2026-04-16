import { Injectable } from '@nestjs/common';
import { getTokenService } from 'src/connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConnection.service';
import { helpersService } from 'src/helpers/helpers.service';
import axios from 'axios';
import * as mqtt from 'mqtt';

@Injectable()
export class vendorsService {
  private client = mqtt.connect({
    host: process.env.MQTT_HOST,
    username: process.env.MQTT_USER,
    password: process.env.MQTT_PASSWORD,
  });

  constructor(
    private tokenService: getTokenService,
    private sqlService: runSqlService,
    private helpers: helpersService,
  ) { }

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

  async getPaymentMethodId(pMethodCode: string, companyID: string, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let code = pMethodCode;
    if (pMethodCode === '1') code = 'DOM.';
    if (pMethodCode === '2') code = 'CHEQUE';
    if (pMethodCode === '3') code = 'EFECTIVO';
    if (pMethodCode === '4') code = 'TRANSF.';

    return this.getIdFromAPI('paymentMethods', `code eq '${code}'`, companyID, client_id, client_secret, tenant, entorno);
  }
  async getCurrencyId(currencyCode: string, companyID: string, client_id: string, client_secret: string, tenant: string, entorno: string) {
    const id = await this.getIdFromAPI('currencies', `code eq '${currencyCode}'`, companyID, client_id, client_secret, tenant, entorno);
    return id;
  }

  async getPaymentTermId(pTermCode: string, companyID: string, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let id = '';
    const token = await this.tokenService.getToken2(client_id, client_secret, tenant);
    let res;

    const normalizedCode = pTermCode || 'CON';

    try {
      res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/paymentTerms?$filter=code eq '${normalizedCode}'`, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      });
    } catch (error) {
      this.logError(`❌ Error al obtener el ID del término de pago ${normalizedCode}`, error);
      throw error;
    }

    if (res.data.value.length === 0) {
      let paymentTerm;
      try {
        let dueDateCalculation = '';
        const formulaPart = normalizedCode.replace(' DÍAS', '').trim();

        if (formulaPart === 'CON') {
          dueDateCalculation = '0D';
        } else if (/^[0-9]+$/.test(formulaPart)) {
          dueDateCalculation = `${formulaPart}D`;
        } else {
          dueDateCalculation = formulaPart;
        }

        const paymentTermData = {
          code: `${normalizedCode}`,
          displayName: `Neto ${normalizedCode}`,
          dueDateCalculation: dueDateCalculation,
          discountDateCalculation: '',
          discountPercent: 0,
          calculateDiscountOnCreditMemos: true,
        };

        paymentTerm = await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/paymentTerms`, paymentTermData, {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        });
      } catch (error) {
        this.logError(`❌ Error creando el término de pago ${normalizedCode}`, error);
        throw error;
      }
      id = paymentTerm.data.id;
    } else {
      id = res.data.value[0].id;
    }
    return id;
  }

  async getBankAccountCode(IBAN: string, vendorNumber: string, companyID: string, client_id: string, client_secret: string, tenant: string, entorno: string): Promise<string> {
    const IBANsinGuiones = this.sanitizeIBAN(IBAN);
    let code = '';
    const token = await this.tokenService.getToken2(client_id, client_secret, tenant);
    // Note: Vendors use vendorBankAccounts endpoint
    const url = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/VendorBankAccount?$filter=IBAN eq '${IBANsinGuiones}' and number eq '${vendorNumber}'`;
    let res;
    try {
      res = await axios.get(url, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      });
    } catch (error) {
      this.logError(`❌ Error al obtener el código de la cuenta bancaria para el IBAN ${IBAN} y el proveedor ${vendorNumber}`, error);
      throw error;
    }
    console.log(`Respuesta de la API para cuentas bancarias con IBAN ${IBAN} y proveedor ${vendorNumber}:`, res.data);
    if (res.data.value.length === 0) {
      let bankAccount;
      try {
        // Get last code for this vendor's bank accounts
        const lastAccounts = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/VendorBankAccount?$filter=number eq '${vendorNumber}'&$orderby=code desc&$top=1`, {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        });

        const newCode = lastAccounts.data.value.length === 0 ? "1" : (parseInt(lastAccounts.data.value[0].code, 10) + 1).toString();
        const bankAccountData = {
          number: `${vendorNumber}`,
          code: `${newCode}`,
          IBAN: `${IBANsinGuiones}`,
        };

        bankAccount = await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/VendorBankAccount`, bankAccountData, {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        });
        code = bankAccount.data.code;
      } catch (error) {
        this.logError(`❌ Error creando la cuenta bancaria para el IBAN ${IBAN} y el proveedor ${vendorNumber}`, error);
        throw error;
      }
    } else {
      code = res.data.value[0].code;
    }
    return code;
  }

  async syncVendors(companyID: string, database: string, client_id: string, client_secret: string, tenant: string, entorno: string, codiHIT?: string) {
    if (tenant === process.env.tenaTenant) return;
    let vendors;
    try {
      const sqlQuery = `
        SELECT 
            p.nombre as NOMBRE,
            p.nif as NIF,
            p.direccion as DIRECCION,
            p.ciudad as CIUDAD,
            p.cp as CP,
            p.pais as PAIS,
            p.tlf1 as TELEFONO,
            p.eMail as EMAIL,
            p.tipoCobro as FORMAPAGO,
            p.facturaPeriodo as TERMINOPAGO,
            (SELECT TOP 1 valor FROM ccProveedoresExtes WHERE id = p.id AND nom = 'NumeroCuenta') as IBAN
        FROM ccProveedores p
        WHERE p.activo = 1 ${codiHIT ? `AND p.nif = '${codiHIT}'` : ''}
        ORDER BY p.nombre;
      `;
      vendors = await this.sqlService.runSql(sqlQuery, database);
    } catch (error) {
      this.logError(`❌ Error al ejecutar la consulta SQL de proveedores en '${database}'`, error);
      throw error;
    }

    if (vendors.recordset.length === 0 && codiHIT) {
      this.client.publish('/Hit/Serveis/Apicultor/Log', 'No hay registros');
      console.error('⚠️ Advertencia: No se encontraron registros de proveedores para el código HIT proporcionado');
      throw new Error('No se encontraron registros de proveedores para el código HIT proporcionado');
    }

    if (vendors.recordset.length === 0) {
      this.client.publish('/Hit/Serveis/Apicultor/Log', 'No hay registros');
      console.warn('⚠️ Advertencia: No se encontraron registros de proveedores');
      return false;
    }

    const token = await this.tokenService.getToken2(client_id, client_secret, tenant);

    let vendorBCId = '';
    let vendorNumber = '';
    let i = 1;
    for (const vendor of vendors.recordset) {
      try {
        const nif = `${this.helpers.normalizeNIF(vendor.NIF)}`;
        const payMethodId = await this.getPaymentMethodId(vendor.FORMAPAGO, companyID, client_id, client_secret, tenant, entorno);
        const payTermId = await this.getPaymentTermId(vendor.TERMINOPAGO, companyID, client_id, client_secret, tenant, entorno);
        const currencyId = await this.getCurrencyId('EUR', companyID, client_id, client_secret, tenant, entorno);

        const vendorData = {
          displayName: vendor.NOMBRE,
          addressLine1: vendor.DIRECCION,
          city: vendor.CIUDAD,
          postalCode: vendor.CP,
          country: vendor.PAIS || 'ES',
          phoneNumber: this.sanitizePhone(vendor.TELEFONO),
          email: vendor.EMAIL,
          taxRegistrationNumber: nif,
          currencyId: currencyId || undefined,
          paymentMethodId: payMethodId || undefined,
          paymentTermsId: payTermId || undefined,
          vendorPostingGroup: 'NAC',
          genBusPostingGroup: 'NAC',
        };

        let res;
        try {
          const allVendors = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/vendors`, {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          });
          const matched = allVendors.data.value.filter((v: any) => v.taxRegistrationNumber === nif);
          res = { data: { value: matched } };
        } catch (error) {
          this.logError(`❌ Error consultando el proveedor en BC con NIF ${nif}`, error);
          continue;
        }

        if (res.data.value.length === 0) {
          const createRes = await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/vendors`, vendorData, {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          });
          vendorBCId = createRes.data.id;
          vendorNumber = createRes.data.number;
          const etag = createRes.data['@odata.etag'];
          let bankAccountCode = '';
          if (vendor.IBAN) {
            bankAccountCode = await this.getBankAccountCode(vendor.IBAN, vendorNumber, companyID, client_id, client_secret, tenant, entorno);
          }
          const vendorData2 = {
            bankAccountCode: `${bankAccountCode}`,
          };
          await axios.patch(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/vendors(${vendorBCId})`, vendorData2, {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
              'If-Match': etag,
            },
          });
        } else {
          vendorBCId = res.data.value[0].id;
          vendorNumber = res.data.value[0].number;
          const etag = res.data.value[0]['@odata.etag'];
          let bankAccountCode = '';
          if (vendor.IBAN) {
            bankAccountCode = await this.getBankAccountCode(vendor.IBAN, vendorNumber, companyID, client_id, client_secret, tenant, entorno);
          }
          const vendorData1 = {
            ...vendorData,
            bankAccountCode: `${bankAccountCode}`,
          };
          await axios.patch(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/vendors(${vendorBCId})`, vendorData1, {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
              'If-Match': etag,
            },
          });
        }

      } catch (error) {
        this.logError(`❌ Error al procesar el proveedor ${vendor.NOMBRE}:`, error);
        if (codiHIT) {
          throw error;
        }
        continue;
      }
      console.log(`⏳ Sincronizando proveedor ${vendor.NOMBRE} ... -> ${i}/${vendors.recordset.length} --- ${((i / vendors.recordset.length) * 100).toFixed(2)}% `);
      i++;
    }
    if (codiHIT) {
      return { vendorNumber, vendorBCId };
    }
    return true;
  }

  async getVendorFromAPI(companyID, database, codiHIT, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let vendorData;
    const token = await this.tokenService.getToken2(client_id, client_secret, tenant);
    let res;
    try {
      const allVendors = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/vendors`, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      });
      const nif = this.helpers.normalizeNIF(codiHIT);
      const matched = allVendors.data.value.filter((v: any) => v.taxRegistrationNumber === nif);
      res = { data: { value: matched } };
    } catch (error) {
      this.logError(`❌ Error consultando proveedor con código ${codiHIT}`, error);
      throw error;
    }

    if (res.data.value.length > 0) {
      // Si el proveedor ya existe, forzar sincronización para actualizar datos
      vendorData = await this.syncVendors(companyID, database, client_id, client_secret, tenant, entorno, codiHIT);
      console.log('📘 Proveedor existente en la API con ID:', vendorData.vendorBCId);
      return vendorData;
    }

    const newVendor = await this.syncVendors(companyID, database, client_id, client_secret, tenant, entorno, codiHIT);
    if (newVendor && typeof newVendor !== 'boolean') {
      console.log('📘 Nuevo proveedor sincronizado con ID:', newVendor.vendorBCId);
      vendorData = newVendor;
      return vendorData;
    } else {
      console.log('⚠️ No se pudo sincronizar el nuevo proveedor.');
      return false;
    }
  }

  private logError(message: string, error: any) {
    const errorDetail = error?.response?.data || error?.message || 'Error desconocido';
    this.client.publish('/Hit/Serveis/Apicultor/Log', JSON.stringify({ message, error: errorDetail }));
    console.error(message, errorDetail);
  }

  private sanitizePhone(phone: string): string {
    if (!phone) return '';
    const cleaned = phone.replace(/[^0-9+\-()\s]/g, '');
    return cleaned.trim();
  }

  private sanitizeIBAN(iban: string): string {
    if (!iban) return '';
    const cleaned = iban.replace(/[^A-Z0-9]/gi, '');
    return cleaned.toUpperCase();
  }
}