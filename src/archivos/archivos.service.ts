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
  ) {}

  async syncArchivos(companyNAME: string, database: string) {
    let token = await this.token.getToken();

    let archivos;
    try {
      archivos = await this.sql.runSql(
        `select id, archivo, extension, convert(nvarchar, fecha, 121) fecha from archivo where fecha>=(select timestamp from records where concepte='BC_Archivos') and year(fecha)<=year(getdate()) and fecha<= GETDATE() order by fecha`,
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

    for (let i = 0; i < archivos.recordset.length; i++) {
      let x = archivos.recordset[i];

      let res = await axios
        .get(
          `${process.env.baseURL}/v2.0/${process.env.tenant}/Production/ODataV4/Company('${companyNAME}')/cdpDadesFichador2?$filter=idr eq '${x.idr}'`,
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
        let newarchivos = await axios
          .post(
            `${process.env.baseURL}/v2.0/${process.env.tenant}/Production/ODataV4/Company('${companyNAME}')/archivo`,
            {
              idTrabajador: x.id,
              archivo: x.archivo,
              tipoArchivo: x.tipoArchivo,
              fecha: x.fecha,
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
