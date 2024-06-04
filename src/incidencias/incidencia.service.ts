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
export class IncidenciaService {
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) {}

  async syncIncidencias(companyNAME: string, database: string) {
    let token = await this.token.getToken();
    //Miro si existe en records el 'BC_incidencias' y si no existe lo inserta con el TimeStamp mas antiguo de incidencias
    try {
      let records = await this.sql.runSql(
        `select * from records where concepte='BC_incidencias'`,
        database,
      );
      if (records.recordset.length == 0) {
        let recordsInsert = await this.sql.runSql(
          `INSERT INTO records (timestamp, concepte) SELECT MIN(TimeStamp), 'BC_incidencias' FROM incidencias;`,
          database,
        );
      }
    } catch (error) {
      //Comprovacion de errores y envios a mqtt
      client.publish('/Hit/Serveis/Apicultor/Log', 'No existe la database');
      console.log('No existe la database');
      return false;
    }
  
    let incidencias;
    console.log('Empezando a syncronizar incidencias')
    //Selecciono todos los datos de incidencias que sean mas grandes o iguales al TimeStamp guardado en records
    try {
      incidencias = await this.sql.runSql(
        `select * from incidencias where TimeStamp>=(select timestamp from records where concepte='BC_incidencias') and year(TimeStamp)<=year(getdate()) order by TimeStamp`,
        database,
      );
    } catch (error) {
      //Comprovacion de errores y envios a mqtt
      client.publish('/Hit/Serveis/Apicultor/Log', 'No existe la database');
      console.log('No existe la database');
      return false;
    }
    if (incidencias.recordset.length == 0) {
      //Comprovacion de errores y envios a mqtt
      client.publish('/Hit/Serveis/Apicultor/Log', 'No hay registros');
      console.log('No hay registros');
      return false;
    }
    //console.log('Lenght: ' + incidencias.recordset.length);
    for (let i = 0; i < incidencias.recordset.length; i++) {
      let x = incidencias.recordset[i];
      let urlGet = `${process.env.baseURL}/v2.0/${process.env.tenant}/${process.env.entorno}/ODataV4/Company('${companyNAME}')/incidencias?$filter=id eq ${x.Id}`;
      let urlPost = `${process.env.baseURL}/v2.0/${process.env.tenant}/${process.env.entorno}/ODataV4/Company('${companyNAME}')/incidencias`;
      //console.log(x)
      //console.log(urlGet);
      //Hace un get de BC para ver si existe ya el dato
      let res = await axios
        .get(
          urlGet,
          {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          },
        )
        .catch((error) => {
          console.log(x)
          console.log(urlGet);
          throw new Error('Failed to obtain access token');
        });
      //Mira si lo que a devuelto algo el get, si no devuelve nada inserte el dato 
      if (!res.data) throw new Error('Failed to obtain access token');
      if (res.data.value.length === 0) {
        let newIncidencias;
        newIncidencias = await axios.post(
            urlPost,
            {
                id: x.Id,
                tmst: x.TimeStamp,
                tipo: x.Tipo,
                usuari: x.Usuario,
                cliente: x.Cliente,
                recuerso: x.Recurso,
                incidencia: x.Incidencia,
                estado: x.Estado,
                observaciones: x.Observaciones,
                fechfIniReparaciona: x.FIniReparacion,
                fFinReparacion: x.FFinReparacion,
                prioridad: x.Prioridad,
                tecnico: x.Tecnico,
                contacto: x.contacto,
                programada: x.FProgramada,
                llamada: x.llamada,
                enviado: x.enviado,
                lastUpdate: x.lastUpdate,
            },
            {
              headers: {
                  Authorization: 'Bearer ' + token,
                  'Content-Type': 'application/json',
              },
            }
          );

        if (!newIncidencias.data)
          return new Error('Failed to obtain access token');
        console.log(
          'Synchronizing incidencias... -> ' + i + '/' + incidencias.recordset.length,
          ' --- ',
          ((i / incidencias.recordset.length) * 100).toFixed(2) + '%',
          ' | Time left: ' +
            ((incidencias.recordset.length - i) * (0.5 / 60)).toFixed(2) +
            ' minutes',
        );
        
        const formattedTimeStamp = new Date(x.TimeStamp).toISOString().slice(0, 19).replace('T', ' ');
        //console.log("----------------------------------- " + formattedTimeStamp +"------------------------------------------")
        // Construir la consulta SQL
        let sql = `UPDATE records SET timestamp='${formattedTimeStamp}' WHERE Concepte='BC_incidencias';`;
        //console.log(sql)
        await this.sql.runSql(
          sql,
          database,
        );
      }
    }
    client.publish('/Hit/Serveis/Apicultor/Log', 'Se han sincronizado las incidencias correctamente');
    console.log('Se han sincronizado las incidencias correctamente');
    return true;
  }

  async syncInc_Adjuntos(companyNAME: string, database: string) {
    let token = await this.token.getToken();
    //Miro si existe en records el 'BC_inc_adjuntos' y si no existe lo inserta con el TimeStamp mas antiguo de Inc_Adjuntos
    try {
      let records = await this.sql.runSql(
        `select * from records where concepte='BC_inc_adjuntos'`,
        database,
      );
      if (records.recordset.length == 0) {
        let recordsInsert = await this.sql.runSql(records
          `INSERT INTO records (timestamp, concepte) SELECT MIN(TimeStamp), 'BC_inc_adjuntos' FROM Inc_Adjuntos;`,
          database,
        );
      }
    } catch (error) {
      //Comprovacion de errores y envios a mqtt
      client.publish('/Hit/Serveis/Apicultor/Log', 'No existe la database');
      console.log('No existe la database');
      return false;
    }
  
    let incidencias;
    console.log('Empezando a syncronizar inc_Adjuntos')
    //Selecciono todos los datos de Inc_Adjuntos que sean mas grandes o iguales al TimeStamp guardado en records
    try {
      incidencias = await this.sql.runSql(
        `select * from Inc_Adjuntos where TimeStamp>=(select timestamp from records where concepte='BC_inc_adjuntos') and year(TimeStamp)<=year(getdate()) order by TimeStamp`,
        database,
      );
    } catch (error) {
      //Comprovacion de errores y envios a mqtt
      client.publish('/Hit/Serveis/Apicultor/Log', 'No existe la database');
      console.log('No existe la database');
      return false;
    }
    if (incidencias.recordset.length == 0) {
      //Comprovacion de errores y envios a mqtt
      client.publish('/Hit/Serveis/Apicultor/Log', 'No hay registros');
      console.log('No hay registros');
      return false;
    }
    //console.log('Lenght: ' + incidencias.recordset.length);
    for (let i = 0; i < incidencias.recordset.length; i++) {
      let x = incidencias.recordset[i];
      let urlGet = `${process.env.baseURL}/v2.0/${process.env.tenant}/${process.env.entorno}/ODataV4/Company('${companyNAME}')/inc_Adjuntos?$filter=id eq ${x.Id}`;
      let urlPost = `${process.env.baseURL}/v2.0/${process.env.tenant}/${process.env.entorno}/ODataV4/Company('${companyNAME}')/inc_Adjuntos`;
      
      //console.log(x)
      //console.log(urlGet);
      //Hace un get de BC para ver si existe ya el dato
      let res = await axios
        .get(
          urlGet,
          {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          },
        )
        .catch((error) => {
          console.log(x)
          console.log(urlGet);
          throw new Error('Failed to obtain access token');
        });
      //Mira si lo que a devuelto algo el get, si no devuelve nada inserte el dato 
      if (!res.data) throw new Error('Failed to obtain access token');
      if (res.data.value.length === 0) {
        let newInc_Adjuntos;
        newInc_Adjuntos = await axios.post(
            urlPost,
            {
                id: x.Id,
                tmst: x.TimeStamp,
                usuari: x.Usuario,
                nombreFichero: x.NombreFichero,
                fichero: x.Fichero,
            },
            {
              headers: {
                  Authorization: 'Bearer ' + token,
                  'Content-Type': 'application/json',
              },
            }
          );

        if (!newInc_Adjuntos.data)
          return new Error('Failed to obtain access token');
        console.log(
          'Synchronizing inc_Adjuntos... -> ' + i + '/' + incidencias.recordset.length,
          ' --- ',
          ((i / incidencias.recordset.length) * 100).toFixed(2) + '%',
          ' | Time left: ' +
            ((incidencias.recordset.length - i) * (0.5 / 60)).toFixed(2) +
            ' minutes',
        );
        
        const formattedTimeStamp = new Date(x.TimeStamp).toISOString().slice(0, 19).replace('T', ' ');
        //console.log("----------------------------------- " + formattedTimeStamp +"------------------------------------------")
        let sql = `UPDATE records SET timestamp='${formattedTimeStamp}' WHERE Concepte='BC_inc_adjuntos';`;
        //console.log(sql)
        await this.sql.runSql(
          sql,
          database,
        );
      }
    }
    client.publish('/Hit/Serveis/Apicultor/Log', 'Se han sincronizado las inc_Adjuntos correctamente');
    console.log('Se han sincronizado las inc_Adjuntos correctamente');
    return true;
  }

  async syncInc_Categorias(companyNAME: string, database: string) {
    let token = await this.token.getToken();
    let incidencias;
    console.log('Empezando a syncronizar inc_Categorias')
    //Selecciono todos los datos de Inc_Categorias
    try {
      incidencias = await this.sql.runSql(
        `select * from Inc_Categorias order by id`,
        database,
      );
    } catch (error) {
      //Comprovacion de errores y envios a mqtt
      client.publish('/Hit/Serveis/Apicultor/Log', 'No existe la database');
      console.log('No existe la database');
      return false;
    }
    if (incidencias.recordset.length == 0) {
      //Comprovacion de errores y envios a mqtt
      client.publish('/Hit/Serveis/Apicultor/Log', 'No hay registros');
      console.log('No hay registros');
      return false;
    }
    //console.log('Lenght: ' + incidencias.recordset.length);
    for (let i = 0; i < incidencias.recordset.length; i++) {
      let x = incidencias.recordset[i];
      let urlGet = `${process.env.baseURL}/v2.0/${process.env.tenant}/${process.env.entorno}/ODataV4/Company('${companyNAME}')/inc_Categorias?$filter=id eq ${x.id}`;
      let urlPost = `${process.env.baseURL}/v2.0/${process.env.tenant}/${process.env.entorno}/ODataV4/Company('${companyNAME}')/inc_Categorias`;
      //console.log(x)
      //console.log(urlGet);
      //Hace un get de BC para ver si existe ya el dato
      let res = await axios
        .get(
          urlGet,
          {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          },
        )
        .catch((error) => {
          console.log(x)
          console.log(urlGet);
          throw new Error('Failed to obtain access token');
        });
      //Mira si lo que a devuelto algo el get, si no devuelve nada inserte el dato 
      if (!res.data) throw new Error('Failed to obtain access token');
      if (res.data.value.length === 0) {
        let newInc_Categorias;
        newInc_Categorias = await axios.post(
            urlPost,
            {
                id: x.id,
                nombre: x.Nom,
            },
            {
              headers: {
                  Authorization: 'Bearer ' + token,
                  'Content-Type': 'application/json',
              },
            }
          );

        if (!newInc_Categorias.data)
          return new Error('Failed to obtain access token');
        console.log(
          'Synchronizing inc_Categorias... -> ' + i + '/' + incidencias.recordset.length,
          ' --- ',
          ((i / incidencias.recordset.length) * 100).toFixed(2) + '%',
          ' | Time left: ' +
            ((incidencias.recordset.length - i) * (0.5 / 60)).toFixed(2) +
            ' minutes',
        );
        
      }
    }
    client.publish('/Hit/Serveis/Apicultor/Log', 'Se han sincronizado las inc_Adjuntos correctamente');
    console.log('Se han sincronizado las inc_Adjuntos correctamente');
    return true;
  }

  async syncInc_Clientes(companyNAME: string, database: string) {
    let token = await this.token.getToken();
    let incidencias;
    console.log('Empezando a syncronizar inc_Clientes')
    //Selecciono todos los datos de Inc_Clientes
    try {
      incidencias = await this.sql.runSql(
        `select * from Inc_Clientes order by id`,
        database,
      );
    } catch (error) {
      //Comprovacion de errores y envios a mqtt
      client.publish('/Hit/Serveis/Apicultor/Log', 'No existe la database');
      console.log('No existe la database');
      return false;
    }
    if (incidencias.recordset.length == 0) {
      //Comprovacion de errores y envios a mqtt
      client.publish('/Hit/Serveis/Apicultor/Log', 'No hay registros');
      console.log('No hay registros');
      return false;
    }
    //console.log('Lenght: ' + incidencias.recordset.length);
    for (let i = 0; i < incidencias.recordset.length; i++) {
      let x = incidencias.recordset[i];
      let id = this.formatearUUID(x.id);
      let urlGet = `${process.env.baseURL}/v2.0/${process.env.tenant}/${process.env.entorno}/ODataV4/Company('${companyNAME}')/inc_Clientes?$filter=id eq ${id}`;
      let urlPost = `${process.env.baseURL}/v2.0/${process.env.tenant}/${process.env.entorno}/ODataV4/Company('${companyNAME}')/inc_Clientes`;
      
      //console.log(x)
      //console.log(urlGet);
      //Hace un get de BC para ver si existe ya el dato
      let res = await axios
        .get(
          urlGet,
          {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          },
        )
        .catch((error) => {
          console.log(x)
          console.log(urlGet);
          throw new Error('Failed to obtain access token');
        });
      
      
      //Mira si lo que a devuelto algo el get, si no devuelve nada inserte el dato 
      if (!res.data) throw new Error('Failed to obtain access token');
      if (res.data.value.length === 0) {
        let newInc_Clientes;
        newInc_Clientes = await axios.post(
            urlPost,
            {
                id: id,
                nom: x.Nom,
                empresa: x.Empresa,
                cliEmpresa: x.CliEmpresa,
            },
            {
              headers: {
                  Authorization: 'Bearer ' + token,
                  'Content-Type': 'application/json',
              },
            }
          );

        if (!newInc_Clientes.data)
          return new Error('Failed to obtain access token');
        console.log(
          'Synchronizing inc_Clientes... -> ' + i + '/' + incidencias.recordset.length,
          ' --- ',
          ((i / incidencias.recordset.length) * 100).toFixed(2) + '%',
          ' | Time left: ' +
            ((incidencias.recordset.length - i) * (0.5 / 60)).toFixed(2) +
            ' minutes',
        );
        
      }
    }
    client.publish('/Hit/Serveis/Apicultor/Log', 'Se han sincronizado las inc_Adjuntos correctamente');
    console.log('Se han sincronizado las inc_Adjuntos correctamente');
    return true;
  }

  async syncInc_Historico(companyNAME: string, database: string) {
    let token = await this.token.getToken();
    //Miro si existe en records el 'BC_inc_historico' y si no existe lo inserta con el TimeStamp mas antiguo de Inc_Historico
    try {
      let records = await this.sql.runSql(
        `select * from records where concepte='BC_inc_historico'`,
        database,
      );
      if (records.recordset.length == 0) {
        let recordsInsert = await this.sql.runSql(
          `INSERT INTO records (timestamp, concepte) SELECT MIN(TimeStamp), 'BC_inc_historico' FROM Inc_Historico;`,
          database,
        );
      }
    } catch (error) {
      //Comprovacion de errores y envios a mqtt
      client.publish('/Hit/Serveis/Apicultor/Log', 'No existe la database');
      console.log('No existe la database');
      return false;
    }
  
    let incidencias;
    console.log('Empezando a syncronizar inc_Historico')
    //Selecciono todos los datos de Inc_Historico que sean mas grandes o iguales al TimeStamp guardado en records
    try {
      incidencias = await this.sql.runSql(
        `select * from Inc_Historico where TimeStamp>=(select timestamp from records where concepte='BC_inc_historico') and year(TimeStamp)<=year(getdate()) order by TimeStamp`,
        database,
      );
    } catch (error) {
      //Comprovacion de errores y envios a mqtt
      client.publish('/Hit/Serveis/Apicultor/Log', 'No existe la database');
      console.log('No existe la database');
      return false;
    }
    if (incidencias.recordset.length == 0) {
      //Comprovacion de errores y envios a mqtt
      client.publish('/Hit/Serveis/Apicultor/Log', 'No hay registros');
      console.log('No hay registros');
      return false;
    }
    //console.log('Lenght: ' + incidencias.recordset.length);
    for (let i = 0; i < incidencias.recordset.length; i++) {
      let x = incidencias.recordset[i];
      let urlGet = `${process.env.baseURL}/v2.0/${process.env.tenant}/${process.env.entorno}/ODataV4/Company('${companyNAME}')/inc_Historico?$filter=id eq ${x.Id}`;
      let urlPost = `${process.env.baseURL}/v2.0/${process.env.tenant}/${process.env.entorno}/ODataV4/Company('${companyNAME}')/inc_Historico`;
      
      //console.log(x)
      //console.log(urlGet);
      //Hace un get de BC para ver si existe ya el dato
      let res = await axios
        .get(
          urlGet,
          {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          },
        )
        .catch((error) => {
          console.log(x)
          console.log(urlGet);
          throw new Error('Failed to obtain access token');
        });
      //Mira si lo que a devuelto algo el get, si no devuelve nada inserte el dato 
      if (!res.data) throw new Error('Failed to obtain access token');
      if (res.data.value.length === 0) {
        let newInc_Historico;
        newInc_Historico = await axios.post(
            urlPost,
            {
                id: x.Id,
                tmst: x.TimeStamp,
                usuario: x.Usuario,
                incidencia: x.Incidencia,
                tipo: x.Tipo,
            },
            {
              headers: {
                  Authorization: 'Bearer ' + token,
                  'Content-Type': 'application/json',
              },
            }
          );

        if (!newInc_Historico.data)
          return new Error('Failed to obtain access token');
        console.log(
          'Synchronizing inc_Historico... -> ' + i + '/' + incidencias.recordset.length,
          ' --- ',
          ((i / incidencias.recordset.length) * 100).toFixed(2) + '%',
          ' | Time left: ' +
            ((incidencias.recordset.length - i) * (0.5 / 60)).toFixed(2) +
            ' minutes',
        );
        
        const formattedTimeStamp = new Date(x.TimeStamp).toISOString().slice(0, 19).replace('T', ' ');
        //console.log("----------------------------------- " + formattedTimeStamp +"------------------------------------------")
        let sql = `UPDATE records SET timestamp='${formattedTimeStamp}' WHERE Concepte='BC_inc_historico';`;
        //console.log(sql)
        await this.sql.runSql(
          sql,
          database,
        );
      }
    }
    client.publish('/Hit/Serveis/Apicultor/Log', 'Se han sincronizado las inc_Adjuntos correctamente');
    console.log('Se han sincronizado las inc_Adjuntos correctamente');
    return true;
  }

  async syncInc_Link_Otros(companyNAME: string, database: string) {
    let token = await this.token.getToken();
    let incidencias;
    console.log('Empezando a syncronizar inc_Link_Otros')
    //Selecciono todos los datos de Inc_Link_Otros
    try {
      incidencias = await this.sql.runSql(
        `select * from Inc_Link_Otros order by id`,
        database,
      );
    } catch (error) {
      //Comprovacion de errores y envios a mqtt
      client.publish('/Hit/Serveis/Apicultor/Log', 'No existe la database');
      console.log('No existe la database');
      return false;
    }
    if (incidencias.recordset.length == 0) {
      //Comprovacion de errores y envios a mqtt
      client.publish('/Hit/Serveis/Apicultor/Log', 'No hay registros');
      console.log('No hay registros');
      return false;
    }
    //console.log('Lenght: ' + incidencias.recordset.length);
    for (let i = 0; i < incidencias.recordset.length; i++) {
      let x = incidencias.recordset[i];
      let urlGet = `${process.env.baseURL}/v2.0/${process.env.tenant}/${process.env.entorno}/ODataV4/Company('${companyNAME}')/inc_Link_Otros?$filter=id eq ${x.Id}`;
      let urlPost = `${process.env.baseURL}/v2.0/${process.env.tenant}/${process.env.entorno}/ODataV4/Company('${companyNAME}')/inc_Link_Otros`;
      
      //console.log(x)
      //console.log(urlGet);
      //Hace un get de BC para ver si existe ya el dato
      let res = await axios
        .get(
          urlGet,
          {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          },
        )
        .catch((error) => {
          console.log(x)
          console.log(urlGet);
          throw new Error('Failed to obtain access token');
        });
      //Mira si lo que a devuelto algo el get, si no devuelve nada inserte el dato 
      if (!res.data) throw new Error('Failed to obtain access token');
      if (res.data.value.length === 0) {
        let newInc_Link_Otros;
        newInc_Link_Otros = await axios.post(
            urlPost,
            {
                id: x.Id,
                idOtro: x.IdOtro,
                empresa: x.Empresa,
            },
            {
              headers: {
                  Authorization: 'Bearer ' + token,
                  'Content-Type': 'application/json',
              },
            }
          );

        if (!newInc_Link_Otros.data)
          return new Error('Failed to obtain access token');
        console.log(
          'Synchronizing inc_Link_Otros... -> ' + i + '/' + incidencias.recordset.length,
          ' --- ',
          ((i / incidencias.recordset.length) * 100).toFixed(2) + '%',
          ' | Time left: ' +
            ((incidencias.recordset.length - i) * (0.5 / 60)).toFixed(2) +
            ' minutes',
        );
        
      }
    }
    client.publish('/Hit/Serveis/Apicultor/Log', 'Se han sincronizado las inc_Adjuntos correctamente');
    console.log('Se han sincronizado las inc_Adjuntos correctamente');
    return true;
  }

  public tryNotNull(params:string) {
    if(params==null) return  '';
    else return params
  }

  public formatearUUID(id) {
    // Verificar si el ID ya está entre llaves
    if (id.startsWith('{') && id.endsWith('}')) {
        return id; // Devolver el ID sin cambios
    } else {
        // Agregar llaves al principio y al final del ID
        return '{' + id + '}';
    }
}

}


