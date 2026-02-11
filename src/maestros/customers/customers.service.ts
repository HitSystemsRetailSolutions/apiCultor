import { Injectable } from '@nestjs/common';
import { getTokenService } from 'src/connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConnection.service';
import { helpersService } from 'src/helpers/helpers.service';
import axios from 'axios';
import * as mqtt from 'mqtt';

@Injectable()
export class customersService {
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
    return this.getIdFromAPI('paymentMethods', `code eq '${pMethodCode}'`, companyID, client_id, client_secret, tenant, entorno);
  }

  async getTaxAreaId(taxCode: string, companyID: string, client_id: string, client_secret: string, tenant: string, entorno: string) {
    return this.getIdFromAPI('taxAreas', `code eq '${taxCode}'`, companyID, client_id, client_secret, tenant, entorno);
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

  async getBankAccountCode(IBAN: string, client: string, companyID: string, client_id: string, client_secret: string, tenant: string, entorno: string): Promise<string> {
    const IBANsinGuiones = this.sanitizeIBAN(IBAN);
    let code = '';
    const token = await this.tokenService.getToken2(client_id, client_secret, tenant);
    const url = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/CustomerBankAccount?$filter=IBAN eq '${IBANsinGuiones}' and number eq '${client}'`;
    let res;
    try {
      res = await axios.get(url, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      });
    } catch (error) {
      this.logError(`❌ Error al obtener el código de la cuenta bancaria para el IBAN ${IBAN} y el cliente ${client}`, error);
      throw error;
    }
    if (res.data.value.length === 0) {
      let bankAccount;
      try {
        const lastNumber = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/CustomerBankAccount?$filter=number eq '${client}'&$orderby=code desc&$top=1`, {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        });

        const newCode = lastNumber.data.value.length === 0 ? 1 : parseInt(lastNumber.data.value[0].code, 10) + 1;
        const bankAccountData = {
          number: `${client}`,
          code: `${newCode}`,
          IBAN: `${IBANsinGuiones}`,
          RegionCode: 'ES',
        };
        bankAccount = await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/CustomerBankAccount`, bankAccountData, {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        });
      } catch (error) {
        this.logError(`❌ Error creando la cuenta bancaria para el IBAN ${IBAN} y el cliente ${client}`, error);
        throw error;
      }
      code = bankAccount.data.code;
    } else {
      code = res.data.value[0].code;
    }
    return code;
  }

  async getPaymentDays(day: string, client: string, companyID: string, client_id: string, client_secret: string, tenant: string, entorno: string) {
    const token = await this.tokenService.getToken2(client_id, client_secret, tenant);
    let res;
    try {
      res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/customers?$filter=number eq '${client}'&$expand=paymentDays($filter=day eq ${day})`, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      });
    } catch (error) {
      this.logError(`❌ Error al obtener los días de pago para el día ${day} y el cliente ${client}`, error);
      throw error;
    }
    if (res.data.value[0].paymentDays.length === 0) {
      try {
        const paymentDaysData = {
          code: `${client}`,
          day: `${day}`,
          table: 'Customer',
        };
        await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/paymentDays`, paymentDaysData, {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        });
      } catch (error) {
        this.logError(`❌ Error creando los días de pago para el día ${day} y el cliente ${client}`, error);
        throw error;
      }
    }
  }

  async syncCustomers(companyID: string, database: string, client_id: string, client_secret: string, tenant: string, entorno: string, codiHIT?: string) {
    if (tenant === process.env.tenaTenant) return;
    let customers;
    try {
      const sqlQuery = `
        ;WITH ClienteMare AS (
          SELECT c1.codi AS CODIGO, 
                CASE WHEN c2_agrup.valor = 'agruparFacturas' AND c2_empMareFac.variable = 'empMareFac' THEN c2_empMareFac.valor ELSE c1.codi END AS CODIGO_MARE
          FROM Clients c1
          LEFT JOIN ConstantsClient c2_agrup ON c2_agrup.codi = c1.codi AND c2_agrup.variable = 'agruparFacturas'
          LEFT JOIN ConstantsClient c2_empMareFac ON c2_empMareFac.codi = c1.codi AND c2_empMareFac.variable = 'empMareFac'
        ),
        ClientesFiltrados AS (
          SELECT c1.codi, c1.[Nom Llarg], c1.[Nom], c1.Nif, c1.Adresa, c1.Ciutat, c1.Cp, c2_email.valor AS EMAIL, c2_tel.valor AS TELEFONO, c2_IBAN.valor AS IBAN,
                CASE cc4.valor WHEN '1' THEN 'DOM.' WHEN '2' THEN 'CHEQUE' WHEN '3' THEN 'EFECTIVO' WHEN '4' THEN 'TRANSF.' ELSE 'UNDEFINED' END AS FORMAPAGO, 
                c2_diaPago.Valor AS DIAPAGO,
                CASE c2_venciment.valor WHEN '' THEN 'CON' ELSE c2_venciment.valor + ' DÍAS' END AS TERMINOPAGO, 
                CASE WHEN COALESCE(NULLIF(ph.Valor1, ''), NULL) IS NULL THEN 'NO' ELSE 'SI' END AS esTienda,
                CASE c1.[Tipus Iva] WHEN '2' THEN 'si' ELSE 'no' END AS recargo, c2_idioma.valor as idioma,
                c2_OG.Valor AS OG, c2_UT.Valor AS UT, c2_OC.Valor AS OC,
                c2_comercial.valor AS COMERCIAL,
                ROW_NUMBER() OVER (PARTITION BY c1.Nif ORDER BY c1.nom) AS rn
          FROM ClienteMare cm
          JOIN Clients c1 ON c1.codi = cm.CODIGO_MARE
          LEFT JOIN ConstantsClient c2_email ON c2_email.codi = c1.codi AND c2_email.variable = 'eMail'
          LEFT JOIN ConstantsClient c2_tel ON c2_tel.codi = c1.codi AND c2_tel.variable = 'tel'
          LEFT JOIN ConstantsClient cc4 ON cc4.codi = c1.codi AND cc4.variable = 'FormaPagoLlista'
          LEFT JOIN ConstantsClient c2_IBAN ON c2_IBAN.codi = c1.codi AND c2_IBAN.variable = 'CompteCorrent'
          LEFT JOIN ConstantsClient c2_diaPago ON c2_diaPago.codi = c1.codi AND c2_diaPago.variable = 'DiaPagament'
          LEFT JOIN ConstantsClient c2_venciment ON c2_venciment.codi = c1.codi AND c2_venciment.variable = 'Venciment'
          LEFT JOIN ConstantsClient c2_idioma ON c2_idioma.codi = c1.codi AND c2_idioma.variable = 'IDIOMA'
          LEFT JOIN ConstantsClient c2_OG ON c2_OG.codi = c1.codi AND c2_OG.variable = 'OrganGestor'
          LEFT JOIN ConstantsClient c2_UT ON c2_UT.codi = c1.codi AND c2_UT.variable = 'UnitatTramitadora'
          LEFT JOIN ConstantsClient c2_OC ON c2_OC.codi = c1.codi AND c2_OC.variable = 'OficinaComptable'
          LEFT JOIN ParamsHw ph ON ph.codi = c1.codi
          LEFT JOIN ConstantsClient c2_desactiva ON c2_desactiva.codi = c1.codi AND c2_desactiva.variable = 'DesactivaFacturacio'
          LEFT JOIN ConstantsClient c2_comercial ON c2_comercial.codi = c1.codi AND c2_comercial.variable = 'comercial'
          WHERE c1.Nif IS NOT NULL AND c1.Nif <> '' AND LEN(c1.Nif) >= 9 ${codiHIT ? `AND c1.Nif = '${codiHIT}'` : ''} AND (c2_desactiva.valor IS NULL OR c2_desactiva.valor <> 'DesactivaFacturacio')
        )
        SELECT codi AS CODIGO, [Nom Llarg] AS NOMBREFISCAL, [Nom] AS NOMBRE, NIF, Adresa AS DIRECCION, Ciutat AS CIUDAD, Cp AS CP, EMAIL, TELEFONO, IBAN, FORMAPAGO, DIAPAGO, TERMINOPAGO, esTienda, recargo, idioma, OG, UT, OC, COMERCIAL
        FROM ClientesFiltrados
        WHERE rn = 1
        ORDER BY codi;
      `;
      customers = await this.sqlService.runSql(sqlQuery, database);
    } catch (error) {
      this.logError(`❌ Error al ejecutar la consulta SQL en la base de datos '${database}'`, error);
      throw error;
    }

    if (customers.recordset.length === 0) {
      this.client.publish('/Hit/Serveis/Apicultor/Log', 'No hay registros');
      console.error('⚠️ Advertencia: No se encontraron registros de clientes');
      return false;
    }

    const token = await this.tokenService.getToken2(client_id, client_secret, tenant);

    let customerId = '';
    let customerNumber = '';
    let customerComercial = '';
    let i = 1;
    for (const customer of customers.recordset) {
      try {
        const taxArea = customer.recargo === 'si' ? 'NACRE' : 'NAC';
        const payMethodId = await this.getPaymentMethodId(customer.FORMAPAGO, companyID, client_id, client_secret, tenant, entorno);
        const taxId = await this.getTaxAreaId(taxArea, companyID, client_id, client_secret, tenant, entorno);
        const payTermId = await this.getPaymentTermId(customer.TERMINOPAGO, companyID, client_id, client_secret, tenant, entorno);
        customerNumber = `${this.helpers.normalizeNIF(customer.NIF)}`;
        customerComercial = customer.COMERCIAL || '';
        const customerData1 = {
          number: customerNumber,
          displayName: `${customer.NOMBREFISCAL}` || `${customer.NOMBRE}`,
          type: 'Company',
          addressLine1: `${customer.DIRECCION}`,
          city: `${customer.CIUDAD}`,
          country: 'ES',
          postalCode: `${customer.CP}`,
          phoneNumber: this.sanitizePhone(customer.TELEFONO),
          email: `${customer.EMAIL}`,
          taxAreaId: `${taxId}`,
          taxRegistrationNumber: customerNumber,
          currencyCode: 'EUR',
          paymentMethodId: `${payMethodId}`,
          paymentTermsId: `${payTermId}`,
          formatRegion: 'es-ES_tradnl',
          languageCode: customer.idioma === 'CA' ? 'CAT' : 'ESP',
          customerPostingGroup: 'NAC',
          GenBusPostingGroup: 'NAC',
          pricesIncludingVAT: 'false',
          equivalenceCharge: customer.recargo === 'si' ? 'true' : 'false',
          OG: customer.OG || '',
          UT: customer.UT || '',
          OC: customer.OC || '',
        };
        let res;
        try {
          res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/customers?$filter=number eq '${customerNumber}'`, {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          });
        } catch (error) {
          this.logError(`❌ Error consultando el cliente en BC con código ${customer.CODIGO}`, error);
          continue;
        }
        if (res.data.value.length === 0) {
          const createCustomer = await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/customers`, customerData1, {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          });

          customerId = createCustomer.data.id;
          const customeretag = createCustomer.data['@odata.etag'];
          if (customer.DIAPAGO) {
            await this.getPaymentDays(customer.DIAPAGO, customerNumber, companyID, client_id, client_secret, tenant, entorno);
          }
          // bankAccountCode depende del cliente y si no esta creado da error, por eso se crea primero el cliente y luego se actualiza
          let bankAccountCode = '';
          if (customer.IBAN) {
            bankAccountCode = await this.getBankAccountCode(customer.IBAN, customerNumber, companyID, client_id, client_secret, tenant, entorno);
          }
          const customerData2 = {
            bankAccountCode: `${bankAccountCode}`,
          };

          await axios.patch(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/customers(${customerId})`, customerData2, {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
              'If-Match': customeretag,
            },
          });
        } else {
          let bankAccountCode = '';
          if (customer.IBAN) {
            bankAccountCode = await this.getBankAccountCode(customer.IBAN, customerNumber, companyID, client_id, client_secret, tenant, entorno);
          }
          const customerData = {
            ...customerData1,
            bankAccountCode: `${bankAccountCode}`,
          };
          const etag = res.data.value[0]['@odata.etag'];
          await axios.patch(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/customers(${res.data.value[0].id})`, customerData, {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
              'If-Match': etag,
            },
          });
          customerId = res.data.value[0].id;
        }
      } catch (error) {
        this.logError(`❌ Error al procesar el cliente ${customer.CODIGO}:`, error);
        if (codiHIT) {
          throw error;
        }
        continue;
      }
      console.log(`⏳ Sincronizando cliente ${customer.NOMBREFISCAL} ... -> ${i}/${customers.recordset.length} --- ${((i / customers.recordset.length) * 100).toFixed(2)}% `);
      i++;
    }
    if (codiHIT) {
      return { customerNumber, customerId, customerComercial };
    }
    return true;
  }

  async getCustomerFromAPI(companyID, database, codiHIT, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let customerData;
    const token = await this.tokenService.getToken2(client_id, client_secret, tenant);
    let res;
    try {
      res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/customers?$filter=number eq '${this.helpers.normalizeNIF(codiHIT)}'`, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      });
    } catch (error) {
      this.logError(`❌ Error consultando cliente con código ${codiHIT}`, error);
      throw error;
    }

    if (res.data.value.length > 0) {

      // Si el cliente ya existe, forzar sincronización para actualizar datos
      customerData = await this.syncCustomers(companyID, database, client_id, client_secret, tenant, entorno, codiHIT);
      console.log('📘 Cliente existente en la API con ID:', customerData.customerId);
      return customerData;
    }

    const newCustomer = await this.syncCustomers(companyID, database, client_id, client_secret, tenant, entorno, codiHIT);
    if (newCustomer && typeof newCustomer !== 'boolean') {
      console.log('📘 Nuevo cliente sincronizado con ID:', newCustomer.customerId);
      customerData = newCustomer;
      return customerData;
    } else {
      console.log('⚠️ No se pudo sincronizar el nuevo cliente.');
      return false;
    }
  }

  private logError(message: string, error: any) {
    this.client.publish('/Hit/Serveis/Apicultor/Log', JSON.stringify({ message, error: error.response?.data || error.message }));
    console.error(message, error.response?.data || error.message);
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
