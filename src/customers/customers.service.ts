import { Injectable } from '@nestjs/common';
import { getTokenService } from '../conection/getToken.service';
import { runSqlService } from 'src/conection/sqlConection.service';
import axios from 'axios';
import { response } from 'express';

const mqtt = require('mqtt');
const mqttBrokerUrl = 'mqtt://santaana2.nubehit.com';

// Crear un cliente MQTT
const client = mqtt.connect(mqttBrokerUrl);

@Injectable()

export class customersService {
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) {}

  //Obtener Id de Company
  async getCompaniesId() {
    let token = await this.token.getToken();
    let pTermCode = "0D";
    let res = await axios.get(
      `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies`,
      {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      },
    );

    if (!res.data) throw new Error('Failed to obtain access token');
    let companies = res.data.value;
    if (companies.length === 0) 
    {
        console.log('NO HAY COMPANIES');
    }
    else
    {
      for (let i=0;i<companies.length;i++)
      {
        console.log(companies[i]);
      }
    }

/*NOM: CRONUS ES ID:8586dd27-55e9-ed11-884e-6045bdc8c698
NOM: FILA PEÑA, S.L. ID:c1fbfea4-f0aa-ee11-a568-000d3a660c9b
NOM: HITSYSTEM_TEST ID:0d96d05c-2a10-ee11-8f6e-6045bd978b14
NOM: My Company ID:2f38b331-55e9-ed11-884e-6045bdc8c698*/

  }

  //Obtener Id del modo de pago
  async getPaymentTermId(pTermCode, companyID) {
    let token = await this.token.getToken();

    // Get PaymentTerms from API
    let res = await axios.get(
      `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${companyID})/paymentTerms?$filter=dueDateCalculation eq '` +
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
  async getTaxAreaId(taxCode, companyID) {
    let token = await this.token.getToken();

    // Get Tax from API
    let res = await axios.get(
      `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${companyID})/taxAreas?$filter=code eq '` +
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

  async syncCustomers(companyID: string, database: string) {
    console.log(companyID);
    console.log(database);
    let token = await this.token.getToken();
    let customerId = '';

    //console.log("--------------TOKEN------------ " + token);
    //this.getCompaniesId();    

    let payTermId = await this.getPaymentTermId('0D', companyID);
    let taxId = await this.getTaxAreaId('UE', companyID);

    //console.log("-------------PAY TERM ID-----------------" + payTermId);
    let customers;
    try{
      customers = await this.sql.runSql(
        `SELECT cast(c.Codi as nvarchar) Codi, upper(c.Nom) Nom, c.Adresa, c.Ciutat, c.CP, cc1.valor Tel, cc2.valor eMail from clients c left join constantsClient cc1 on c.codi= cc1.codi and cc1.variable='Tel' join constantsClient cc2 on c.codi= cc2.codi and cc2.variable='eMail' where c.codi in (1314) order by c.codi`,
        database,
      );
    } catch (error){
      client.publish('/Hit/Serveis/Apicultor/Log', 'No existe la database');
      console.log('No existe la database')
      return false;
    }

    
    if(customers.recordset.length == 0){
      client.publish('/Hit/Serveis/Apicultor/Log', 'No hay registros');
      console.log('No hay registros')
      return false;
    }
    for (let i = 0; i < customers.recordset.length; i++) {
      let x = customers.recordset[i];
      console.log("--------------------------" + x.Nom + "-----------------------");
      let res = await axios
        .get(
          `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${companyID})/customers?$filter=number eq '${x.Codi}'`,
          {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          },
        )
        .catch((error) => {
          throw new Error('Failed Get Customer' + x.Codi);
        });

      if (!res.data) throw new Error('Failed Get Customer' + x.Codi);

      if (res.data.value.length === 0) { //NO ESTÁ EL CLIENTE EN BC, LO TENEMOS QUE TRASPASAR
        let newCustomers = await axios
          .post(
            `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${companyID})/customers`,
            {
              number: x.Codi,
              displayName: x.Nom,
              type: 'Company',
              taxAreaId: taxId,
              currencyCode: 'EUR',
              addressLine1: x.Adresa,
              city: x.Ciutat,              
              postalCode: x.CP,
              phoneNumber: x.Tel,
              email: x.eMail,              
              //paymentTermsId: payTermId,
              //paymentMethodId: 'ebb54901-3110-ee11-8f6e-6045bd978b14', //CAJA
              //addressLine2: '',
              //state: '',
              //country: '',
              //website: '',
              //salespersonCode: '',
              //balanceDue: 0,
              //creditLimit: 0,
              //taxLiable: false,
              //taxRegistrationNumber: '', (NIF)
              //currencyId: '00000000-0000-0000-0000-000000000000',
              //shipmentMethodId: '00000000-0000-0000-0000-000000000000',
              //blocked: '_x0020_',
              //businessGroup: 'UE',
            },
            {
              headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json',
              },
            },
          )
          .catch((error) => {
            throw new Error('Failed Post Customer ' + x.Codi);
          });

        if (!newCustomers.data)
          return new Error('Failed Post Customer ' + x.Codi);

        //console.log(
        //  'Synchronizing customers... -> ' +
//            i +
//            '/' +
//            customers.recordset.length,
//          ' --- ',
//          ((i / customers.recordset.length) * 100).toFixed(2) + '%',
//          ' | Time left: ' +
//            ((customers.recordset.length - i) * (0.5 / 60)).toFixed(2) +
//            ' minutes',
//        );

        customerId = newCustomers.data.id;

      } else { //YA EXISTE EL CLIENTE EN BC, LO TENEMOS QUE ACTUALIZAR
        let z = res.data.value[0]['@odata.etag'];
        customerId = res.data.value[0].id;

        let newCustomers = await axios
          .patch(
            `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${companyID})/customers(${res.data.value[0].id})`,
            {
              displayName: x.Nom,
              type: 'Company',
              taxAreaId: taxId,
              currencyCode: 'EUR',
              addressLine1: x.Adresa,
              city: x.Ciutat,
              postalCode: x.CP,
              phoneNumber: x.Tel,
              email: x.eMail,              
              //businessGroup: 'UE',
              //paymentTermsId: payTermId,
              //paymentMethodId: 'ebb54901-3110-ee11-8f6e-6045bd978b14', //CAJA
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
            throw new Error('Failed update customer');
          });
        if (!newCustomers.data)
          return new Error('Failed update customer');
//        console.log(
//          'Synchronizing customers... -> ' +
//            i +
//            '/' +
//            customers.recordset.length,
//          ' --- ',
//          ((i / customers.recordset.length) * 100).toFixed(2) + '%',
//         ' | Time left: ' +
//            ((customers.recordset.length - i) * (0.5 / 60)).toFixed(2) +
//            ' minutes',
//        );
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
