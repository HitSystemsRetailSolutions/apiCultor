import { Injectable } from '@nestjs/common';
import { runSqlService } from 'src/connection/sqlConection.service';
import * as mqtt from 'mqtt';

@Injectable()
export class peticionesMqttService {
  private client = mqtt.connect({
    host: process.env.MQTT_HOST,
    username: process.env.MQTT_USER,
    password: process.env.MQTT_PASSWORD,
  });
  constructor(
    private sql: runSqlService,
  ) { }

  async syncIntercompanyByDate(companyID: string, entorno: string, day: string, month: string) {
    const query = `select IdFactura from [facturacio_2025-${month}_iva] where clientnif ='B66567470' and empnif = 'B64990906' and day(DataEmissio)=${day}`
    const idFacturas = await this.sql.runSql(query, 'fac_tena');
    console.log(`Facturas encontradas: ${idFacturas.recordset.length}`);
    if (idFacturas.recordset.length === 0) {
      console.log(`No se encontraron facturas para el día ${day} del mes ${month}.`);
      return false;
    }
    const message = {
      msg: "silemaIntercompany",
      idFactura: [
        ...idFacturas.recordset.map((item) => item.IdFactura),
      ],
      tabla: `2025-${month}`,
      database: "fac_tena",
      tenant: process.env.blockedTenant,
      companyID: companyID,
      entorno: entorno,
      client_id: "",
      client_secret: ""
    }
    console.log(`Enviando mensaje MQTT: ${JSON.stringify(message)}`);
    this.client.publish('/Hit/Serveis/Apicultor', JSON.stringify(message), { qos: 1 });
    return true;

  }
  async syncSilemaDate(diaInicio: string, diaFin: string, mes: string, turno: number, companyID: string, entorno: string, empresa: string, tiendas: string = "") {

    let tiendasArray: number[] = [];
    if (empresa == 'imeMil') {
      const query = `select codi from clients where codi in (select codi from ParamsHw) and nif = 'B61957189'`
      const listaTiendas = await this.sql.runSql(query, 'fac_tena');
      tiendasArray = listaTiendas.recordset.map((item) => item.codi);
    } else {
      tiendasArray = Array.isArray(tiendas)
        ? tiendas.map(Number)
        : tiendas.split(',').map(Number);
    }

    console.log(tiendasArray);

    const message = {
      msg: "silemaDateTurno",
      turno: Number(turno),
      botiga: tiendasArray,
      dayStart: diaInicio,
      dayEnd: diaFin,
      month: mes,
      year: `2025`,
      database: "fac_tena",
      tenant: process.env.blockedTenant,
      companyID: companyID,
      entorno: entorno,
      client_id: "",
      client_secret: ""
    }
    console.log(`Enviando mensaje MQTT cierre: ${JSON.stringify(message)}`);
    this.client.publish('/Hit/Serveis/Apicultor', JSON.stringify(message), { qos: 1 });
    return true;

  }
}
