/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable prefer-const */
import { Injectable } from '@nestjs/common';
import { getTokenService } from '../conection/getToken.service';
import { runSqlService } from 'src/conection/sqlConection.service';
import axios from 'axios';
import { response } from 'express';
const path = require('path');
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
  async crearEmpresa(name: string, displayName: string, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    let id = 'e640b57a-f31c-ef11-9f88-002248a1f043';
    let packageName = "ConfigurationBase";
    let packageCode = "ES.ESP.STANDARD";
    let packageId = "";
    let packageProgress = 'No';
    //let document = 'src/PackageES.ESP.STANDARD.rapidstart'

    //Create company
    const url = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/microsoft/automation/v2.0/companies(${id})/automationCompanies`;
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

      //console.log('Empresa creada exitosamente:', response.data);
      id = response.data.id;
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

    //Create configuration
    let url1 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/microsoft/automation/v2.0/companies(${id})/configurationPackages`;
    try {
      const response = await axios.post(
        url1,
        {
          code: packageCode,
          packageName: packageName,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );
      //console.log('Archivo de configuracion creado:', response.data);
      packageId = response.data.id;
    } catch (error) {
      throw new Error(`Ha habido un error al crear el archivo de configuracion`);
    }

    //Upload RapidStart File
    const filePath = path.resolve(__dirname, '..', '..', 'src', 'empresas', 'PackageES.ESP.STANDARD.rapidstart');
    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath);
      //console.log(`FileContent: ${fileContent}`);
      const url2 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/microsoft/automation/v2.0/companies(${id})/configurationPackages(${packageId})/file('${packageCode}')/content`;
      //console.log(`URL: ${url2}`);

      try {
        const response = await axios.patch(url2, fileContent, {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/octet-stream",
            'If-Match': '*',
          }
        });
        //console.log('Archivo de configuracion subido ', response.data);
      } catch (error) {
        if (error.response) {
          console.error(`Error al subir el archivo: ${error.response.status} - ${error.response.statusText}`);
          console.error('Detalles:', error.response.data);
        } else if (error.request) {
          console.error('No se recibió respuesta del servidor:', error.request);
        } else {
          console.error('Error al configurar la solicitud:', error.message);
        }
      }
    } else {
      console.error('El archivo de configuracion no existe:', filePath);
    }


    //Import configuration
    const url5 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/microsoft/automation/v2.0/companies(${id})/configurationPackages(${packageId})`;
    console.log("url get company: "+ url5);
    try {
      const response = await axios.get(
        url5,
        {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        }
      );
      packageProgress = response.data.importStatus;
      //console.log("Progress: ", packageProgress);
    } catch (error) {
      console.error(`Ha habido un error al ver el estado de la importacion: ${error.message}`);
      throw new Error(`Ha habido un error al ver el estado de la importacion`);
    }
    if (packageProgress == "No") {
      const url3 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/microsoft/automation/v2.0/companies(${id})/configurationPackages(${packageId})/Microsoft.NAV.import`;
      try {
        const response = await axios.post(
          url3,
          {},
          {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          }
        );

        //console.log('Archivo de configuracion importado exitosamente ' + response.data);
      } catch (error) {
        console.error(`Ha habido un error al importar el archivo de configuracion: ${error.message}`);
        throw new Error(`Ha habido un error al importar el archivo de configuracion`);
      }
    }else if(packageProgress == "InProgress" || packageProgress == "Scheduled"){
      console.log("Importe en progreso o programado");
    }


    //Check status import
    while (packageProgress == "No" || packageProgress == "InProgress" || packageProgress == "Scheduled") {
      const url5 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/microsoft/automation/v2.0/companies(${id})/configurationPackages(${packageId})`;
      //console.log(url5)
      try {
        const response = await axios.get(
          url5,
          {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          }
        );
        packageProgress = response.data.importStatus;
        //console.log("Progress: ", packageProgress);
      } catch (error) {
        console.error(`Ha habido un error al ver el estado de la importacion: ${error.message}`);
        throw new Error(`Ha habido un error al ver el estado de la importacion`);
      }
    }
    console.log('Archivo de configuracion importe completado');

    //Apply configuration
    const url4 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/microsoft/automation/v2.0/companies(${id})/configurationPackages(${packageId})/Microsoft.NAV.apply`;
    try {
      const response = await axios.post(
        url4,
        {},
        {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        }
      );

      console.log('Archivo de configuracion aplicado exitosamente ' + response.data);
    } catch (error) {
      console.error(`Ha habido un error al aplicar el archivo de configuracion: ${error.message}`);
      throw new Error(`Ha habido un error al aplicar el archivo de configuracion`);
    }

    console.log(`Se ha creado la empresa ${name} correctamente`);
    return true
  }
}