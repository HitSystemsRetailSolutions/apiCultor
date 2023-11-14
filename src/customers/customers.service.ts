import { Injectable } from '@nestjs/common';
import { getTokenService } from '../conection/getToken.service';
import { runSqlService } from 'src/conection/sqlConection.service';
import axios from 'axios';
import { response } from 'express';
@Injectable()
export class customersService {
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) {}

  //Obtener Id del modo de pago
  async getPaymentTermId(pTermCode) {
    let token = await this.token.getToken();

    // Get PaymentTerms from API
    let res = await axios.get(
      `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${process.env.companyID})/paymentTerms?$filter=dueDateCalculation eq '` +
        pTermCode +
        `'`,
      {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      },
    );

    if (!res.data) throw new Error('Failed to obtain access token');
    let payTermId = res.data.value.length === 0 ? '' : res.data.value[0].id;
    return payTermId;
  }

  //Obtener Id de TaxArea
  async getTaxAreaId(taxCode) {
    let token = await this.token.getToken();

    // Get Tax from API
    let res = await axios.get(
      `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${process.env.companyID})/taxAreas?$filter=code eq '` +
        taxCode +
        `'`,
      {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      },
    );

    if (!res.data) throw new Error('Failed to obtain access token');
    let taxId = res.data.value.length === 0 ? '' : res.data.value[0].id;
    return taxId;
  }

  async syncCustomers() {
    let token = await this.token.getToken();
    let customerId = '';
    let payTermId = await this.getPaymentTermId('0D');
    let taxId = await this.getTaxAreaId('UE');

    let customers = await this.sql.runSql(
      'SELECT cast(c.Codi as nvarchar) Codi, c.Nom, c.Adresa, c.Ciutat, c.CP from clients c',
      'fac_tena',
    );

    for (let i = 0; i < customers.recordset.length; i++) {
      let x = customers.recordset[i];
      let res = await axios
        .get(
          `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${process.env.companyID})/customers?$filter=number eq '${x.Codi}'`,
          {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          },
        )
        .catch((error) => {
          throw new Error('Failed to obtain access token');
        });

      if (!res.data) throw new Error('Failed to obtain access token');
      if (res.data.value.length === 0) {
        let newCustomers = await axios
          .post(
            `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${process.env.companyID})/customers`,
            {
              number: x.Codi,
              displayName: x.Nom,
              type: 'Company',
              taxAreaId: taxId,
              currencyCode: 'EUR',
              paymentTermsId: payTermId,
              paymentMethodId: 'ebb54901-3110-ee11-8f6e-6045bd978b14', //CAJA
              addressLine1: x.Adresa,
              //addressLine2: '',
              city: x.Ciutat,
              //state: '',
              //country: '',
              postalCode: x.CP,
              //phoneNumber: '',
              //email: '',
              //website: '',
              //salespersonCode: '',
              //balanceDue: 0,
              //creditLimit: 0,
              //taxLiable: false,
              //taxRegistrationNumber: '', (NIF)
              //currencyId: '00000000-0000-0000-0000-000000000000',
              //shipmentMethodId: '00000000-0000-0000-0000-000000000000',
              //blocked: '_x0020_',
            },
            {
              headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json',
              },
            },
          )
          .catch((error) => {
            throw new Error('Failed to obtain access token');
          });

        if (!newCustomers.data)
          return new Error('Failed to obtain access token');
        console.log(
          'Synchronizing customers... -> ' +
            i +
            '/' +
            customers.recordset.length,
          ' --- ',
          ((i / customers.recordset.length) * 100).toFixed(2) + '%',
          ' | Time left: ' +
            ((customers.recordset.length - i) * (0.5 / 60)).toFixed(2) +
            ' minutes',
        );
        customerId = newCustomers.data.id;
      } else {
        let z = res.data.value[0]['@odata.etag'];
        customerId = res.data.value[0].id;

        let newCustomers = await axios
          .patch(
            `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${process.env.companyID})/customers(${res.data.value[0].id})`,
            {
              displayName: x.Nom,
              type: 'Company',
              taxAreaId: taxId,
              currencyCode: 'EUR',
              paymentTermsId: payTermId,
              paymentMethodId: 'ebb54901-3110-ee11-8f6e-6045bd978b14', //CAJA
              addressLine1: x.Adresa,
              city: x.Ciutat,
              postalCode: x.CP,
              //businessGroup: 'UE',
            },
            {
              headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json',
                'if-Match': z,
              },
            },
          )
          .catch((error) => {
            throw new Error('Failed to obtain access token');
          });
        if (!newCustomers.data)
          return new Error('Failed to obtain access token');
        console.log(
          'Synchronizing customers... -> ' +
            i +
            '/' +
            customers.recordset.length,
          ' --- ',
          ((i / customers.recordset.length) * 100).toFixed(2) + '%',
          ' | Time left: ' +
            ((customers.recordset.length - i) * (0.5 / 60)).toFixed(2) +
            ' minutes',
        );
      }
    }
    return true;
  }

  async getCustomerFromAPI(codiHIT) {
    let customerId = '';

    // Get the authentication token
    let token = await this.token.getToken();

    // Get Customer from API
    let res = await axios
      .get(
        `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${process.env.companyID})/customers?$filter=number eq '${codiHIT}'`,
        {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        },
      )
      .catch((error) => {
        throw new Error('Failed to obtain access token');
      });

    if (!res.data) throw new Error('Failed to obtain access token');

    if (res.data.value.length === 0) {
    } else {
      customerId = res.data.value[0].id;
    }
    return customerId;
  }
}
