import { Injectable } from '@nestjs/common';
import { getTokenService } from '../connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConection.service';
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
export class signingsService {
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) {}

  async syncSignings(companyNAME: string, database: string, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let token = await this.token.getToken2(client_id, client_secret, tenant);

    let signings;
    try {
      signings = await this.sql.runSql(
        `select convert(nvarchar, tmst, 121) tmstStr, idr, tmst, accio, usuari, (select nom from dependentes where codi = usuari) as nombre, isnull((SELECT valor FROM dependentesExtes WHERE id = usuari AND nom = 'DNI'), '') as dni, isnull(editor, '') editor, isnull(left(historial, 100), '') historial, isnull(lloc, '') lloc, isnull(left(comentari, 50), '') comentari, id from cdpDadesFichador where tmst>=(select timestamp from records where concepte='BC_CdpDadesFichador') and comentari not like '%365EquipoDeTrabajo%' and year(tmst)<=year(getdate()) and tmst<= GETDATE() order by tmst`,
        database,
      );
    } catch (error) {
      //Comprovacion de errores y envios a mqtt
      client.publish('/Hit/Serveis/Apicultor/Log', 'No existe la database');
      console.log('No existe la database');
      return false;
    }
    if (signings.recordset.length == 0) {
      //Comprovacion de errores y envios a mqtt
      client.publish('/Hit/Serveis/Apicultor/Log', 'No hay registros');
      console.log('No hay registros');
      return false;
    }

    for (let i = 0; i < signings.recordset.length; i++) {
      let x = signings.recordset[i];

      let res = await axios
        .get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/ODataV4/Company('${companyNAME}')/cdpDadesFichador2?$filter=idr eq '${x.idr}'`, {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        })
        .catch((error) => {
          throw new Error('Failed to obtain access token');
        });

      if (!res.data) throw new Error('Failed to obtain access token');
      if (res.data.value.length === 0) {
        let newSignings = await axios
          .post(
            `${process.env.baseURL}/v2.0/${tenant}/${entorno}/ODataV4/Company('${companyNAME}')/cdpDadesFichador2`,
            {
              idr: x.idr,
              tmst: x.tmst,
              accio: x.accio,
              usuari: x.usuari,
              nombre: x.nombre,
              dni: x.dni,
              editor: x.editor,
              historial: x.historial,
              lloc: x.lloc,
              comentari: x.comentari,
              id: x.id,
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

        if (!newSignings.data) return new Error('Failed to obtain access token');
        console.log(`Synchronizing signings... -> ${i}/${signings.recordset.length} --- ${((i / signings.recordset.length) * 100).toFixed(2)}% `);

        await this.sql.runSql(`update records set timestamp='${x.tmstStr}' where Concepte='BC_CdpDadesFichador'`, database);
      }
    }
    return true;
  }
}
