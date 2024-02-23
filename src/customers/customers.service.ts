import { Injectable } from '@nestjs/common';
import { getTokenService } from '../conection/getToken.service';
import { runSqlService } from 'src/conection/sqlConection.service';
import axios from 'axios';
import { response } from 'express';

//MQTT connect
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
        `SELECT cast(c.Codi as nvarchar) Codi, upper(c.Nom) Nom, c.Adresa, c.Ciutat, c.CP, cc1.valor Tel, cc2.valor eMail from clients c left join constantsClient cc1 on c.codi= cc1.codi and cc1.variable='Tel' join constantsClient cc2 on c.codi= cc2.codi and cc2.variable='eMail' order by c.codi`,
        database,
      );
    } catch (error){ //Comprovacion de errores y envios a mqtt
      client.publish('/Hit/Serveis/Apicultor/Log', 'No existe la database');
      console.log('No existe la database')
      return false;
    }

   
    if(customers.recordset.length == 0){ //Comprovacion de errores y envios a mqtt
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
      }
    }
    return true;
  }

  async getCustomerFromAPI(companyID, database, codiHIT) {
    let customerId = '';

    // Get the authentication token
    let token = await this.token.getToken();

    // Get Customer from API
    let res = await axios
      .get(
        `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies(${companyID})/customers?$filter=number eq '${codiHIT}'`,
        {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        },
      )
      .catch((error) => {
        throw new Error('Failed to obtain customer');
      });

    if (!res.data) throw new Error('Failed to obtain customer');

    if (res.data.value.length === 0) { //NO ESTÁ EL CLIENTE EN BC, LO TENEMOS QUE TRASPASAR

      console.log("CLIENTE NUEVO ---------------------");
      let customers;
      let taxId = await this.getTaxAreaId('UE', companyID);
         
      try{
        customers = await this.sql.runSql(
          `SELECT cast(c.Codi as nvarchar) Codi, upper(c.Nom) Nom, c.Adresa, c.Ciutat, c.CP, cc1.valor Tel, cc2.valor eMail from clients c left join constantsClient cc1 on c.codi= cc1.codi and cc1.variable='Tel' join constantsClient cc2 on c.codi= cc2.codi and cc2.variable='eMail' where c.codi=${codiHIT} order by c.codi`,
          database,
        );
      } catch (error){ //Comprovacion de errores y envios a mqtt
        client.publish('/Hit/Serveis/Apicultor/Log', 'Customers. No existe la database');
        console.log('Customers. No existe la database')
        return false;
      }
     
      if(customers.recordset.length == 0){ //Comprovacion de errores y envios a mqtt
        client.publish('/Hit/Serveis/Apicultor/Log', 'Customers. No hay registros');
        console.log('Customers. No hay registros')
        return false;
      }

      let x = customers.recordset[0];
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
      customerId = newCustomers.data.id;
    } else {
      customerId = res.data.value[0].id;
    }
    return customerId;
  }
}