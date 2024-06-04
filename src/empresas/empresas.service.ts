/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable prefer-const */
import { Injectable } from '@nestjs/common';
import { getTokenService } from '../conection/getToken.service';
import { runSqlService } from 'src/conection/sqlConection.service';
import axios from 'axios';
import { response } from 'express';
const fs = require('fs');
const FormData = require('form-data');

const mqtt = require('mqtt');
const mqttOptions = {
  host: process.env.MQTT_HOST,
  username: process.env.MQTT_USER,
  password: process.env.MQTT_PASSWORD,
};

// Crear un cliente MQTT
const client = mqtt.connect(mqttOptions);

@Injectable()
export class empresasService {
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) { }
  async crearEmpresa(name: string, displayName: string) {
    let token = await this.token.getToken();
    let id = 'e640b57a-f31c-ef11-9f88-002248a1f043';
    let documentName = "ConfigurationBase"
    //let document = 'src/PackageES.ESP.STANDARD.rapidstart'
    const baseURL = process.env.baseURL || 'https://api.businesscentral.dynamics.com';
    const tenant = process.env.tenant || 'ace8eb1f-b96c-4ab5-91ae-4a66ffd58c96';

    if (!baseURL || !tenant) {
      throw new Error('Las variables de entorno baseURL y tenant deben estar definidas');
    }

    // Corrección del ID de la compañía
    const url = `${baseURL}/v2.0/${tenant}/${process.env.entorno}/api/microsoft/automation/v2.0/companies(${id})/automationCompanies`;

    //console.log('URL generada:', url);
    try {
      const response = await axios.post(
        url,
        {
          name: name,
          displayName: displayName,
          businessProfileId: ""
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      console.log('Empresa creada exitosamente:', response.data);
      id = response.data.id
    } catch (error) {
      if (error.response) {
        // La solicitud se realizó y el servidor respondió con un código de estado que no está en el rango de 2xx
        console.error('Error en la respuesta del servidor:', error.response.data);
        throw new Error(`Error en la respuesta del servidor al crear la empresa ${name}: ${JSON.stringify(error.response.data)}`);
      } else if (error.request) {
        // La solicitud se realizó pero no se recibió ninguna respuesta
        console.error('No se recibió respuesta del servidor:', error.request);
        throw new Error(`No se recibió respuesta del servidor al crear la empresa ${name}`);
      } else {
        // Algo sucedió al configurar la solicitud que desencadenó un error
        console.error('Error al configurar la solicitud:', error.message);
        throw new Error(`Error al configurar la solicitud para crear la empresa ${name}: ${error.message}`);
      }
    }
    let postRapidStart = await axios
      .post(
        `${process.env.baseURL}/v2.0/${process.env.tenant}/${process.env.entorno}/api/microsoft/automation/v2.0/companies(${id})/configurationPackages`,
        {
          code: documentName,
          packageName: documentName,
        },
        {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        },
      ).catch((error) => {
        throw new Error(`Ha habido un error al insertar el archivo de configuracion`);
      });

    // Upload RapidStart File
    const fileContent = fs.readFileSync('src/empresas/PackageES.ESP.STANDARD.rapidstart');
    console.log(fileContent);
    const url2 = `${process.env.baseURL}/v2.0/${process.env.tenant}/${process.env.entorno}/api/microsoft/automation/v2.0/companies(${id})/configurationPackages('ConfigurationBase')/file('ConfigurationBase')/content`;
    try {
      const response = await axios.patch(
        url2,
        fileContent,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/octet-stream",
            'If-Match': '*'
          }
        }
      );
      console.log('Archivo subido exitosamente', response.data);
    } catch (error) {
      if (error.response) {
        // El servidor respondió con un código de estado diferente de 2xx
        console.error(`Error al subir el archivo: ${error.response.status} - ${error.response.statusText}`);
        console.error('Detalles:', error.response.data);
      } else if (error.request) {
        // La solicitud fue hecha pero no se recibió respuesta
        console.error('No se recibió respuesta del servidor:', error.request);
      } else {
        // Ocurrió un error al configurar la solicitud
        console.error('Error al configurar la solicitud:', error.message);
      }
    }
    let importRapidStart = await axios
      .post(
        `${process.env.baseURL}/v2.0/${process.env.tenant}/${process.env.entorno}/api/microsoft/automation/v2.0/companies(${id})/configurationPackages('${documentName}')/Microsoft.NAV.import`,
        {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        },
      )
      .catch((error) => {
        throw new Error(`Ha habido un error al importar el archivo de configuracion`);
      });
    /*
        let applyRapidStart = await axios
          .post(
            `${process.env.baseURL}/v2.0/${process.env.tenant}/${process.env.entorno}/api/microsoft/automation/v2.0/companies(${id})/configurationPackages('${documentName}')/Microsoft.NAV.apply`,
            {
              name: name,
              displayName: displayName,
            },
            {
              headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json',
              },
            },
          )
          .catch((error) => {
            throw new Error(`Ha habido un error al aplicar el archivo de configuracion`);
          });
    */
    console.log(`Se ha creado la empresa ${name} correctamente`);
    return true
  }
}