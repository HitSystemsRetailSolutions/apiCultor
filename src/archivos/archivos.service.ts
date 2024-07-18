import { Injectable } from '@nestjs/common';
import { getTokenService } from '../conection/getToken.service';
import { runSqlService } from 'src/conection/sqlConection.service';
import axios from 'axios';
import { response } from 'express';

//MQTT connect
const mqtt = require('mqtt');
const mqttOptions = {
  host: process.env.MQTT_HOST,
  username: process.env.MQTT_USER,
  password: process.env.MQTT_PASSWORD,
};

// Crear un cliente MQTT
const client = mqtt.connect(mqttOptions);

@Injectable()
export class archivosService {
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) { }

  async syncArchivos(companyNAME: string, database: string, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    let year = "2023"

    let archivos;
    try {
      archivos = await this.sql.runSql(
        `select * from archivo where nombre like '%pdf nomina%' and datepart(year,fecha)>=${year} and fecha>=(select timestamp from records where concepte='BC_Archivos') and fecha<= GETDATE() order by fecha`,
        database,
      );
    } catch (error) {
      //Comprovacion de errores y envios a mqtt
      client.publish('/Hit/Serveis/Apicultor/Log', 'No existe la database');
      console.log('No existe la database');
      return false;
    }
    if (archivos.recordset.length == 0) {
      //Comprovacion de errores y envios a mqtt
      client.publish('/Hit/Serveis/Apicultor/Log', 'No hay registros');
      console.log('No hay registros');
      return false;
    }
    console.log(`Cantidad a sincronizar: ${archivos.recordset.length}`);
    let newarchivos = await axios
      .get(
        `${process.env.baseURL}/v2.0/${tenant}/${entorno}/ODataV4/Company('${companyNAME}')/archivo`,
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

    let idTrabajador = newarchivos.data.value.length
    for (let i = 0; i < archivos.recordset.length; i++) {
      let x = archivos.recordset[i];
      let url = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/ODataV4/Company('${companyNAME}')/archivo?$filter=fecha eq ${x.fecha.toISOString()} and propietario eq '${x.propietario}'`;
      console.log(url);
      let res = await axios.get(
        url,
        {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        },
      )
        .catch((error) => {
          console.log("!!!Error!!! ", error);
          throw new Error('Failed to obtain access token');
        });

      if (!res.data) throw new Error('Failed to obtain access token');
      if (res.data.value.length === 0) {
        let newarchivos = await axios
          .post(
            `${process.env.baseURL}/v2.0/${tenant}/${entorno}/ODataV4/Company('${companyNAME}')/archivo`,
            {
              archivo: x.nombre,
              tipoArchivo: x.extension,
              fecha: x.fecha.toISOString(),
              propietario: x.propietario,
              idTrabajador: idTrabajador
            },
            {
              headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json',
              },
            },
          )
          .catch((error) => {
            throw new Error('Failed to upload archivo');
          });
        let newarchivos2 = await axios
          .put(
            `${process.env.baseURL}/v2.0/${tenant}/${entorno}/ODataV4/Company('${companyNAME}')/archivo(${idTrabajador})/pdf`,
            {
              pdf: x.archivo
            },
            {
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/octet-stream",
                'If-Match': '*',
              }
            },
          )
          .catch((error) => {
            throw new Error('Failed to upload the pdf');
          });
        if (!newarchivos.data)
          return new Error('Failed to obtain access token');
        console.log(
          'Synchronizing archivos... -> ' + i + '/' + archivos.recordset.length,
          ' --- ',
          ((i / archivos.recordset.length) * 100).toFixed(2) + '%',
          ' | Time left: ' +
          ((archivos.recordset.length - i) * (0.5 / 60)).toFixed(2) +
          ' minutes',
        );

        await this.sql.runSql(
          `update records set timestamp='${x.tmstStr}' where Concepte='BC_Archivos'`,
          database,
        );
      }
    }
    return true;
  }
}
