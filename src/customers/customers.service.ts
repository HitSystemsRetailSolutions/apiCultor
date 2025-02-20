import { Injectable } from '@nestjs/common';
import { getTokenService } from '../conection/getToken.service';
import { runSqlService } from 'src/conection/sqlConection.service';
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
  ) {}

  private async getIdFromAPI(endpoint: string, filter: string, companyID: string, client_id: string, client_secret: string, tenant: string, entorno: string): Promise<string> {
    const token = await this.tokenService.getToken2(client_id, client_secret, tenant);
    const url = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/${endpoint}?$filter=${filter}`;
    const res = await axios.get(url, {
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
    });

    if (!res.data) throw new Error(`Failed to get data from ${endpoint}`);
    return res.data.value.length === 0 ? '' : res.data.value[0].id;
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
    let res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/paymentTerms?$filter=code eq '${pTermCode}'`, {
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
    });
    if (!res.data) throw new Error(`Failed to get data from paymentTerms`);
    if (res.data.value.length === 0) {
      const dueDateCalculation = pTermCode.substring(0, pTermCode.length - 5);

      const paymentTermData = {
        code: `${pTermCode}`,
        displayName: `Neto ${pTermCode}`,
        dueDateCalculation: `${dueDateCalculation}D`,
        discountDateCalculation: '',
        discountPercent: 0,
        calculateDiscountOnCreditMemos: true,
      };

      let paymentTerm = await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/paymentTerms`, paymentTermData, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      });

      if (!paymentTerm.data) return new Error('Failed Post Payment Term ' + `${pTermCode}`);
      id = paymentTerm.data.id;
    } else {
      id = res.data.value[0].id;
    }
    return id;
  }

  async getBankAccountCode(IBAN: string, client: string, companyID: string, client_id: string, client_secret: string, tenant: string, entorno: string): Promise<string> {
    try {
      const IBANsinGuiones = IBAN.replace(/-/g, ' ');
      let code = '';
      const token = await this.tokenService.getToken2(client_id, client_secret, tenant);
      const url = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/CustomerBankAccount?$filter=IBAN eq '${IBAN}' and number eq '${client}'`;
      const res = await axios.get(url, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      });
      if (!res.data) throw new Error(`Failed to get data from CustomerBankAccount`);
      if (res.data.value.length === 0) {
        const lastNumber = await axios.get(
          `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/CustomerBankAccount?$filter=IBAN eq '${IBAN}' and number eq '${client}'&$orderby=code desc&$top=1`,
          {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          },
        );

        const newCode = lastNumber.data.value.length === 0 ? 1 : lastNumber.data.value[0].code + 1;
        const bankAccountData = {
          number: `${client}`,
          code: `${newCode}`,
          IBAN: `${IBANsinGuiones}`,
          RegionCode: 'ES',
        };
        let bankAccount = await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/CustomerBankAccount`, bankAccountData, {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        });

        if (!bankAccount.data) return 'ERROR';
        code = bankAccount.data.code;
      } else {
        code = res.data.value[0].code;
      }
      return code;
    } catch (error) {
      this.logError(`Error en getBankAccountCode:`, error);
      return 'ERROR';
    }
  }

  async getPaymentDays(day: string, client: string, companyID: string, client_id: string, client_secret: string, tenant: string, entorno: string) {
    const token = await this.tokenService.getToken2(client_id, client_secret, tenant);
    let res = await axios.get(
      `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/customers?$filter=number eq '${client}'&$expand=paymentDays($filter=day eq ${day})`,
      {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      },
    );
    if (!res.data.value[0].paymentDays) throw new Error(`Failed to get data from PaymentDays`);
    if (res.data.value[0].paymentDays.length === 0) {
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
    }
  }

  async syncCustomers(companyID: string, database: string, client_id: string, client_secret: string, tenant: string, entorno: string, codiHIT?: string) {
    console.log('Sincronizando clientes...');
    let customers;
    try {
      if (codiHIT) {
        customers = await this.sqlService.runSql(
          `;WITH ClienteMare AS (
            SELECT c1.codi AS CODIGO, 
                   CASE WHEN c2_agrup.valor = 'agruparFacturas' AND c2_empMareFac.variable = 'empMareFac' THEN c2_empMareFac.valor ELSE c1.codi END AS CODIGO_MARE
            FROM Clients c1
            LEFT JOIN ConstantsClient c2_agrup ON c2_agrup.codi = c1.codi AND c2_agrup.variable = 'agruparFacturas'
            LEFT JOIN ConstantsClient c2_empMareFac ON c2_empMareFac.codi = c1.codi AND c2_empMareFac.variable = 'empMareFac'
          )
          SELECT c1.codi AS CODIGO, c1.[Nom Llarg] AS NOMBREFISCAL, c1.[Nom] AS NOMBRE, c1.Nif AS NIF, c1.Adresa AS DIRECCION, c1.Ciutat AS CIUDAD, c1.Cp AS CP, c2_email.valor AS EMAIL, c2_tel.valor AS TELEFONO, c2_IBAN.valor AS IBAN,
                 CASE cc4.valor WHEN '1' THEN 'DOM.' WHEN '2' THEN 'CHEQUE' WHEN '3' THEN 'EFECTIVO' WHEN '4' THEN 'TRANSF.' ELSE 'UNDEFINED' END AS FORMAPAGO, c2_diaPago.Valor AS DIAPAGO,
                 CASE c2_venciment.valor WHEN '' THEN 'CON' ELSE c2_venciment.valor + ' DÍAS' END as TERMINOPAGO, CASE WHEN COALESCE(NULLIF(ph.Valor1, ''), NULL) IS NULL THEN 'NO' ELSE 'SI' END AS esTienda,
                 CASE c1.[Tipus Iva] WHEN '2' THEN 'si' ELSE 'no' END as recargo
          FROM ClienteMare cm
          JOIN Clients c1 ON c1.codi = cm.CODIGO_MARE
          LEFT JOIN ConstantsClient c2_email ON c2_email.codi = c1.codi AND c2_email.variable = 'eMail'
          LEFT JOIN ConstantsClient c2_tel ON c2_tel.codi = c1.codi AND c2_tel.variable = 'tel'
          LEFT JOIN ConstantsClient cc4 ON cc4.codi = c1.codi AND cc4.variable = 'FormaPagoLlista'
          LEFT JOIN ConstantsClient c2_IBAN ON c2_IBAN.codi = c1.codi AND c2_IBAN.variable = 'CompteCorrent'
          LEFT JOIN ConstantsClient c2_diaPago ON c2_diaPago.codi = c1.codi AND c2_diaPago.variable = 'DiaPagament'
          LEFT JOIN ConstantsClient c2_venciment ON c2_venciment.codi = c1.codi AND c2_venciment.variable = 'Venciment'
          LEFT JOIN ParamsHw ph ON ph.codi = c1.codi
          WHERE c1.Nif IS NOT NULL AND c1.Nif <> '' and c1.codi = '${codiHIT}'
          GROUP BY c1.codi, c1.[Nom Llarg], c1.Nif, c1.Adresa, c1.Ciutat, c1.Cp, c2_email.valor, c2_tel.valor, c2_IBAN.valor, cc4.valor, c1.nom,c2_diaPago.Valor,c2_venciment.valor,ph.Valor1,c1.[Tipus Iva]
          ORDER BY c1.codi;`,
          database,
        );
      } else {
        customers = await this.sqlService.runSql(
          `;WITH ClienteMare AS (
          SELECT c1.codi AS CODIGO, 
                 CASE WHEN c2_agrup.valor = 'agruparFacturas' AND c2_empMareFac.variable = 'empMareFac' THEN c2_empMareFac.valor ELSE c1.codi END AS CODIGO_MARE
          FROM Clients c1
          LEFT JOIN ConstantsClient c2_agrup ON c2_agrup.codi = c1.codi AND c2_agrup.variable = 'agruparFacturas'
          LEFT JOIN ConstantsClient c2_empMareFac ON c2_empMareFac.codi = c1.codi AND c2_empMareFac.variable = 'empMareFac'
        )
        SELECT c1.codi AS CODIGO, c1.[Nom Llarg] AS NOMBREFISCAL, c1.[Nom] AS NOMBRE, c1.Nif AS NIF, c1.Adresa AS DIRECCION, c1.Ciutat AS CIUDAD, c1.Cp AS CP, c2_email.valor AS EMAIL, c2_tel.valor AS TELEFONO, c2_IBAN.valor AS IBAN,
               CASE cc4.valor WHEN '1' THEN 'DOM.' WHEN '2' THEN 'CHEQUE' WHEN '3' THEN 'EFECTIVO' WHEN '4' THEN 'TRANSF.' ELSE 'UNDEFINED' END AS FORMAPAGO, c2_diaPago.Valor AS DIAPAGO,
			         CASE c2_venciment.valor WHEN '' THEN 'CON' ELSE c2_venciment.valor + ' DÍAS' END as TERMINOPAGO, CASE WHEN COALESCE(NULLIF(ph.Valor1, ''), NULL) IS NULL THEN 'NO' ELSE 'SI' END AS esTienda,
               CASE c1.[Tipus Iva] WHEN '2' THEN 'si' ELSE 'no' END as recargo
        FROM ClienteMare cm
        JOIN Clients c1 ON c1.codi = cm.CODIGO_MARE
        LEFT JOIN ConstantsClient c2_email ON c2_email.codi = c1.codi AND c2_email.variable = 'eMail'
        LEFT JOIN ConstantsClient c2_tel ON c2_tel.codi = c1.codi AND c2_tel.variable = 'tel'
        LEFT JOIN ConstantsClient cc4 ON cc4.codi = c1.codi AND cc4.variable = 'FormaPagoLlista'
        LEFT JOIN ConstantsClient c2_IBAN ON c2_IBAN.codi = c1.codi AND c2_IBAN.variable = 'CompteCorrent'
		    LEFT JOIN ConstantsClient c2_diaPago ON c2_diaPago.codi = c1.codi AND c2_diaPago.variable = 'DiaPagament'
        LEFT JOIN ConstantsClient c2_venciment ON c2_venciment.codi = c1.codi AND c2_venciment.variable = 'Venciment'
        LEFT JOIN ParamsHw ph ON ph.codi = c1.codi
        WHERE c1.Nif IS NOT NULL AND c1.Nif <> ''
        GROUP BY c1.codi, c1.[Nom Llarg], c1.Nif, c1.Adresa, c1.Ciutat, c1.Cp, c2_email.valor, c2_tel.valor, c2_IBAN.valor, cc4.valor, c1.nom,c2_diaPago.Valor,c2_venciment.valor,ph.Valor1,c1.[Tipus Iva]
        ORDER BY c1.codi;`,
          database,
        );
      }
    } catch (error) {
      this.logError(`No existe la database`, error);
      return false;
    }

    if (customers.recordset.length === 0) {
      this.client.publish('/Hit/Serveis/Apicultor/Log', 'No hay registros');
      console.error('No hay registros');
      return false;
    }

    const token = await this.tokenService.getToken2(client_id, client_secret, tenant);

    let customerId = '';
    let i = 1;
    for (const customer of customers.recordset) {
      try {
        const payMethodId = await this.getPaymentMethodId(customer.FORMAPAGO, companyID, client_id, client_secret, tenant, entorno);
        const taxId = await this.getTaxAreaId('NAC', companyID, client_id, client_secret, tenant, entorno);
        const payTermId = await this.getPaymentTermId(customer.TERMINOPAGO, companyID, client_id, client_secret, tenant, entorno);

        const customerData1 = {
          number: `${customer.CODIGO}`,
          displayName: `${customer.NOMBREFISCAL}` || `${customer.NOMBRE}`,
          type: 'Company',
          addressLine1: `${customer.DIRECCION}`,
          city: `${customer.CIUDAD}`,
          country: 'ES',
          postalCode: `${customer.CP}`,
          phoneNumber: `${customer.TELEFONO}`,
          email: `${customer.EMAIL}`,
          taxAreaId: `${taxId}`,
          taxRegistrationNumber: `${customer.NIF}`,
          currencyCode: 'EUR',
          paymentMethodId: `${payMethodId}`,
          paymentTermsId: `${payTermId}`,
          formatRegion: 'es-ES_tradnl',
          languageCode: 'ESP',
          customerPostingGroup: 'NAC',
          pricesIncludingVAT: 'false',
          equivalenceCharge: customer.recargo === 'si' ? 'true' : 'false',
        };
        let res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/customers?$filter=number eq '${customer.CODIGO}'`, {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        });
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
            await this.getPaymentDays(customer.DIAPAGO, customer.CODIGO, companyID, client_id, client_secret, tenant, entorno);
          }
          // bankAccountCode depende del cliente y si no esta creado da error, por eso se crea primero el cliente y luego se actualiza
          let bankAccountCode = '';
          if (customer.IBAN) {
            bankAccountCode = await this.getBankAccountCode(customer.IBAN, customer.CODIGO, companyID, client_id, client_secret, tenant, entorno);
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
            bankAccountCode = await this.getBankAccountCode(customer.IBAN, customer.CODIGO, companyID, client_id, client_secret, tenant, entorno);
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
        this.logError(`Failed to sync customer ${customer.CODIGO}:`, error);
      }
      console.log(`Synchronizing customer ${customer.NOMBREFISCAL} ... -> ${i}/${customers.recordset.length} --- ${((i / customers.recordset.length) * 100).toFixed(2)}% `);
      i++;
    }
    if (codiHIT) {
      return customerId;
    }
    return true;
  }

  async getCustomerFromAPI(companyID, database, codiHIT, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let customerId = '';
    const token = await this.tokenService.getToken2(client_id, client_secret, tenant);
    let res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/customers?$filter=number eq '${codiHIT}'`, {
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
    });
    if (!res.data) throw new Error('Failed to obtain customer');

    if (res.data.value.length > 0) {
      customerId = res.data.value[0].id;
      console.log('customerAPI existente', customerId);
      return customerId;
    }

    const newCustomer = await this.syncCustomers(companyID, database, client_id, client_secret, tenant, entorno, codiHIT);
    console.log('customerAPI nuevo', newCustomer);
    customerId = String(newCustomer);
    return customerId;
  }

  private logError(message: string, error: any) {
    this.client.publish('/Hit/Serveis/Apicultor/Log', message);
    console.error(message, error);
  }
}
