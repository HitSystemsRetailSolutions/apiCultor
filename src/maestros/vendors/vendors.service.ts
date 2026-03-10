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
    const id = await this.getIdFromAPI('paymentMethods', `code eq '${pMethodCode}'`, companyID, client_id, client_secret, tenant, entorno);
    return id;
  }

  async getPaymentTermId(pTermCode: string, companyID: string, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let id = '';
    const token = await this.tokenService.getToken2(client_id, client_secret, tenant);
    let res;
    try {
      res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/paymentTerms?$filter=code eq '${pTermCode}'`, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      });
    } catch (error) {
      this.logError(`❌ Error al obtener el ID del término de pago ${pTermCode}`, error);
      throw error;
    }
    if (res.data.value.length === 0) {
      let paymentTerm;
      try {
        let dueDateCalculation = '';
        // Extraer la parte antes de ' DÍAS'
        const formulaPart = pTermCode.replace(' DÍAS', '').trim();
        // Si es 'CON', la fórmula de fecha en BC debe ser '0D'
        if (formulaPart === 'CON') {
          dueDateCalculation = '0D';
        } else if (/^[0-9]+$/.test(formulaPart)) {
          // Si es solo un número, le añadimos 'D'.
          dueDateCalculation = `${formulaPart}D`;
        } else {
          // Si ya tiene una unidad de tiempo (D, W, M, Q, Y), lo dejamos tal cual.
          dueDateCalculation = formulaPart;
        }

        const paymentTermData = {
          code: `${pTermCode}`,
          displayName: `Neto ${pTermCode}`,
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
        this.logError(`❌ Error creando el término de pago ${pTermCode}`, error);
        throw error;
      }
      id = paymentTerm.data.id;
    } else {
      id = res.data.value[0].id;
    }
    return id;
  }

  async syncVendors(companyID: string, database: string, client_id: string, client_secret: string, tenant: string, entorno: string, codiHIT?: string) {
    if (tenant === process.env.tenaTenant) return;
    let vendors;
    try {
      const sqlQuery = `
        SELECT p.codi AS CODIGO, p.NomFiscal AS NOMBREFISCAL, p.Nom AS NOMBRE, p.Nif AS NIF, p.Adresa AS DIRECCION, p.Ciutat AS CIUDAD, p.Cp AS CP, p.email AS EMAIL, p.tel AS TELEFONO, p.IBAN AS IBAN,
              CASE p.FormaPago WHEN '1' THEN 'DOM.' WHEN '2' THEN 'CHEQUE' WHEN '3' THEN 'EFECTIVO' WHEN '4' THEN 'TRANSF.' ELSE 'UNDEFINED' END AS FORMAPAGO,
              CASE p.Venciment WHEN '' THEN 'CON' ELSE p.Venciment + ' DÍAS' END AS TERMINOPAGO
        FROM Proveidor p
        WHERE p.Nif IS NOT NULL AND p.Nif <> '' AND LEN(p.Nif) >= 9 ${codiHIT ? `AND p.Nif = '${codiHIT}'` : ''}
        ORDER BY p.codi;
      `;
      vendors = await this.sqlService.runSql(sqlQuery, database);
    } catch (error) {
      this.logError(`❌ Error al ejecutar la consulta SQL en la base de datos '${database}'`, error);
      throw error;
    }

    if (vendors.recordset.length === 0 && codiHIT) {
      this.client.publish('/Hit/Serveis/Apicultor/Log', 'No hay registros');
      console.error('⚠️ Advertencia: No se encontraron registros de proveedores para el código HIT proporcionado');
      throw new Error('No se encontraron registros de proveedores para el código HIT proporcionado');
    }

    if (vendors.recordset.length === 0) {
      this.client.publish('/Hit/Serveis/Apicultor/Log', 'No hay registros');
      console.error('⚠️ Advertencia: No se encontraron registros de proveedores');
      return false;
    }

    const token = await this.tokenService.getToken2(client_id, client_secret, tenant);

    let vendorId = '';
    let vendorNumber = '';
    let i = 1;
    for (const vendor of vendors.recordset) {
      try {
        const payMethodId = await this.getPaymentMethodId(vendor.FORMAPAGO, companyID, client_id, client_secret, tenant, entorno);
        const payTermId = await this.getPaymentTermId(vendor.TERMINOPAGO, companyID, client_id, client_secret, tenant, entorno);
        vendorNumber = `${this.helpers.normalizeNIF(vendor.NIF)}`;
        const vendorData = {
          number: vendorNumber,
          displayName: `${vendor.NOMBREFISCAL}` || `${vendor.NOMBRE}`,
          addressLine1: `${vendor.DIRECCION}`,
          city: `${vendor.CIUDAD}`,
          country: 'ES',
          postalCode: `${vendor.CP}`,
          phoneNumber: this.sanitizePhone(vendor.TELEFONO),
          email: `${vendor.EMAIL}`,
          taxRegistrationNumber: vendorNumber,
          currencyCode: 'EUR',
          paymentMethodId: `${payMethodId}`,
          paymentTermsId: `${payTermId}`,
          vendorPostingGroup: 'NAC',
          GenBusPostingGroup: 'NAC',
          iban: this.sanitizeIBAN(vendor.IBAN),
        };
        let res;
        try {
          res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/vendors?$filter=number eq '${vendorNumber}'`, {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          });
        } catch (error) {
          this.logError(`❌ Error consultando el proveedor en BC con código ${vendor.CODIGO}`, error);
          continue;
        }
        if (res.data.value.length === 0) {
          const createVendor = await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/vendors`, vendorData, {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          });
          vendorId = createVendor.data.id;
        } else {
          const etag = res.data.value[0]['@odata.etag'];
          await axios.patch(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/vendors(${res.data.value[0].id})`, vendorData, {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
              'If-Match': etag,
            },
          });
          vendorId = res.data.value[0].id;
        }
      } catch (error) {
        this.logError(`❌ Error al procesar el proveedor ${vendor.CODIGO}:`, error);
        if (codiHIT) {
          throw error;
        }
        continue;
      }
      console.log(`⏳ Sincronizando proveedor ${vendor.NOMBREFISCAL} ... -> ${i}/${vendors.recordset.length} --- ${((i / vendors.recordset.length) * 100).toFixed(2)}% `);
      i++;
    }
    if (codiHIT) {
      return { vendorNumber, vendorId };
    }
    return true;
  }

  async getVendorFromAPI(companyID, database, codiHIT, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let vendorData;
    const token = await this.tokenService.getToken2(client_id, client_secret, tenant);
    let res;
    try {
      res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/vendors?$filter=number eq '${this.helpers.normalizeNIF(codiHIT)}'`, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      });
    } catch (error) {
      this.logError(`❌ Error consultando proveedor con código ${codiHIT}`, error);
      throw error;
    }

    if (res.data.value.length > 0) {
      // Si el proveedor ya existe, forzar sincronización para actualizar datos
      vendorData = await this.syncVendors(companyID, database, client_id, client_secret, tenant, entorno, codiHIT);
      console.log('📘 Proveedor existente en la API con ID:', vendorData.vendorId);
      return vendorData;
    }

    const newVendor = await this.syncVendors(companyID, database, client_id, client_secret, tenant, entorno, codiHIT);
    if (newVendor && typeof newVendor !== 'boolean') {
      console.log('📘 Nuevo proveedor sincronizado con ID:', newVendor.vendorId);
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

  sanitizePhone(phone: string): string {
    if (!phone) return '';
    const cleaned = phone.replace(/[^0-9+\-()\s]/g, '');
    return cleaned.trim();
  }

  sanitizeIBAN(iban: string): string {
    if (!iban) return '';
    const cleaned = iban.replace(/[^A-Z0-9]/gi, '');
    return cleaned.toUpperCase();
  }
}
