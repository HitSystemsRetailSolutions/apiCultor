import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as bodyParser from 'body-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(bodyParser.json({ limit: '50mb' }));
  app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
  await app.listen(3333);
}
bootstrap();

const axios = require('axios');
// horas = *(60*60*1000)
// minutos = *(60*1000)
// segundos = *(1000)
const employeesTime = 5 * (60 * 60 * 1000); // hours
const signingsTime = 5 * (60 * 1000); // minutes
const customersTime = 5 * (60 * 60 * 1000); // hours

var test = false; //test: call functions
var debug = true; //debug: mqtt publish
const mqtt = require('mqtt');
const { config } = require('process');

const mqttOptions = {
  host: process.env.MQTT_HOST,
  username: process.env.MQTT_USER,
  password: process.env.MQTT_PASSWORD,
};

// Crear un cliente MQTT
const client = mqtt.connect(mqttOptions);

// Manejar evento de conexión
client.on('connect', function () {
  console.log('Conectado al broker MQTT');

  // Suscribirse a un tema
  let tema = '/Hit/Serveis/Apicultor';
  client.subscribe(tema, function (err) {
    if (err) {
      console.error('Error al suscribirse al tema', err);
    } else {
      console.log('Suscripción exitosa al tema', tema);
    }
  });
  
  client.subscribe(tema + '/Log', function (err) {
    if (err) {
      console.error('Error al suscribirse al tema', err);
    } else {
      console.log('Suscripción exitosa al tema', tema + '/Log');
    }
  });
});

// Manejar mensajes recibidos
client.on('message', async function (topic, message) {
  if (debug) {
    console.log(
      'Mensaje recibido en el tema:',
      topic,
      '- Contenido:',
      message.toString(),
    );
  }
  try {
    const msgJson = JSON.parse(message);
    console.log('Mensaje en modo JSON:', msgJson);
    if (msgJson.hasOwnProperty('debug')) {
      if (msgJson.debug == 'true') {
        console.log('Debug: activado');
        debug = true;
      } else {
        console.log('Debug: desactivado');
        debug = false;
      }
    } else {
      console.log('Debug: desactivado'); //No enviar mensajes a /Hit/Serveis/Apicultor/Log
      debug = false;
    }
    if (msgJson.hasOwnProperty('test')) {
      if (msgJson.test == 'true') {
        console.log('Test: activado');
        test = true;
      } else {
        console.log('Test: desactivado');
        test = false;
      }
    } else {
      console.log('Test: desactivado');
        test = false;
    }
    if (msgJson.hasOwnProperty('companyID')) {
      console.log('El JSON recibido tiene el campo "companyID"');
      if(msgJson.companyID == '2f38b331-55e9-ed11-884e-6045bd')
        msgJson.companyID = '2f38b331-55e9-ed11-884e-6045bdc8c698';
      if (!isValidCompanyID(msgJson.companyID)) {
        mqttPublish('Error: "companyID" no valido');
      }
    } else if (msgJson.hasOwnProperty('companyNAME')) {
      console.log('El JSON recibido tiene el campo "companyNAME"');
    } else {
      mqttPublish('El JSON recibido no tiene el campo "companyID" o "companyNAME" ');
    }
    if (
      msgJson.hasOwnProperty('database') ||
      msgJson.hasOwnProperty('dataBase')
    ) {
      console.log('El JSON recibido tiene el campo "database"');
    } else {
      mqttPublish('El JSON recibido no tiene el campo "database"');
    }
    
    if (!test) {
      switch (msgJson.msg) {
        case 'SyncEmployes':
        case 'SyncDependentes':
        case 'employes':
          if (
            msgJson.hasOwnProperty('database') &&
            msgJson.hasOwnProperty('companyID')
          )
            await employes(msgJson.companyID, msgJson.database);
          else if (
            msgJson.hasOwnProperty('dataBase') &&
            msgJson.hasOwnProperty('companyID')
          )
            await employes(msgJson.companyID, msgJson.dataBase);
          break;
        case 'SyncSignings':
        case 'signings':
          if (
            msgJson.hasOwnProperty('database') &&
            msgJson.hasOwnProperty('companyNAME')
          )
            await signings(msgJson.companyNAME, msgJson.database);
          else if (
            msgJson.hasOwnProperty('dataBase') &&
            msgJson.hasOwnProperty('companyNAME')
          )
            await signings(msgJson.companyNAME, msgJson.dataBase);
          break;
        case 'SyncCustomers':
        case 'customers':
          if (
            msgJson.hasOwnProperty('database') &&
            msgJson.hasOwnProperty('companyID')
          )
            await customers(msgJson.companyID, msgJson.database);
          else if (
            msgJson.hasOwnProperty('dataBase') &&
            msgJson.hasOwnProperty('companyID')
          )
            await customers(msgJson.companyID, msgJson.dataBase);
          break;
        case 'SyncItems':
        case 'items':
          if (
            msgJson.hasOwnProperty('database') &&
            msgJson.hasOwnProperty('companyID')
          )
            await items(msgJson.companyID, msgJson.database);
          else if (
            msgJson.hasOwnProperty('dataBase') &&
            msgJson.hasOwnProperty('companyID')
          )
            await items(msgJson.companyID, msgJson.dataBase);
          break;
        case 'SyncItemscategories':
        case 'itemCategories':
          if (
            msgJson.hasOwnProperty('database') &&
            msgJson.hasOwnProperty('companyID')
          )
            await itemCategories(msgJson.companyID, msgJson.database);
          else if (
            msgJson.hasOwnProperty('dataBase') &&
            msgJson.hasOwnProperty('companyID')
          )
            await itemCategories(msgJson.companyID, msgJson.dataBase);
          break;
        case 'SyncTickets':
        case 'tickets':
          if (
            msgJson.hasOwnProperty('database') &&
            msgJson.hasOwnProperty('companyID')
          )
            await tickets(msgJson.companyID, msgJson.database, msgJson.botiga);
          else if (
            msgJson.hasOwnProperty('dataBase') &&
            msgJson.hasOwnProperty('companyID')
          )
            await tickets(msgJson.companyID, msgJson.dataBase, msgJson.botiga);
          break;
        case 'factura':
          if (
            msgJson.hasOwnProperty('database') &&
            msgJson.hasOwnProperty('companyID')
          )
            await facturas(
              msgJson.companyID,
              msgJson.database,
              msgJson.idFactura,
              msgJson.tabla,
            );
          else if (
            msgJson.hasOwnProperty('dataBase') &&
            msgJson.hasOwnProperty('companyID')
          )
            await facturas(
              msgJson.companyID,
              msgJson.dataBase,
              msgJson.idFactura,
              msgJson.tabla,
            );
          break;

        case 'Companies' :
          await setCompanies( );
          break;
        case 'xml':
          if (
            msgJson.hasOwnProperty('companyID')
          )
            await xml(
              msgJson.companyID,
              msgJson.idFactura,
            );
          else if (
            msgJson.hasOwnProperty('companyID')
          )
          await xml(
            msgJson.companyID,
            msgJson.idFactura,
          );
          break;
        case 'incidencias':
          if (
            msgJson.hasOwnProperty('database') &&
            msgJson.hasOwnProperty('companyNAME')
          )
            await incidencias(msgJson.companyNAME, msgJson.database);
          else if (
            msgJson.hasOwnProperty('dataBase') &&
            msgJson.hasOwnProperty('companyNAME')
          )
            await incidencias(msgJson.companyNAME, msgJson.dataBase);
          break;
          case 'mail':
            if (
              msgJson.hasOwnProperty('database') &&
              msgJson.hasOwnProperty('mailTo') &&
              msgJson.hasOwnProperty('idFactura')
            )
              await mail(msgJson.database, msgJson.mailTo, msgJson.idFactura);
            else if (
              msgJson.hasOwnProperty('dataBase') &&
              msgJson.hasOwnProperty('mailTo') &&
              msgJson.hasOwnProperty('idFactura')
            )
              await mail(msgJson.dataBase, msgJson.mailTo, msgJson.idFactura);
            
            break;
        case 'bucle':
          if (
            msgJson.hasOwnProperty('database') &&
            msgJson.hasOwnProperty('companyID')
          )
            await bucle(
              msgJson.companyID,
              msgJson.companyNAME,
              msgJson.dataBase,
            );
          else if (
            msgJson.hasOwnProperty('dataBase') &&
            msgJson.hasOwnProperty('companyID')
          )
            await bucle(
              msgJson.companyID,
              msgJson.companyNAME,
              msgJson.dataBase,
            );
          break;
        default:
          mqttPublish(
            'Mensaje recibido no coincide con ninguna acción esperada',
          );
          break;
      }
    } else {
      console.log('Testing: ', test);
    }
  } catch (error) {
    if (debug) {
      console.log('Mensaje recibido como una cadena');
    }
  }
});

// Manejar errores
client.on('error', function (error) {
  console.error('Error en el cliente MQTT:', error);
});

function isValidCompanyID(companyID) {
  // Expresión regular para validar el formato del companyID
  const regex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return regex.test(companyID);
}

async function employes(companyID, database) {
  try {
    await axios.get('http://localhost:3333/syncEmployees', {
      params: {
        companyID: companyID,
        database: database,
      },
      timeout: 30000,
    });
    console.log('Employee sync sent...');
  } catch (error) {
    console.error('Error al sincronizar empleados:', error);
  }
}

async function signings(companyNAME, database) {
  try {
    await axios.get('http://localhost:3333/syncSignings', {
      params: {
        companyNAME: companyNAME,
        database: database,
      },
      timeout: 30000,
    });
    console.log('Signings sync sent...');
  } catch (error) {
    console.error('Error al sincronizar firmas:', error);
  }
}

async function incidencias(companyNAME, database) {
  let res;
  try {
    res = await axios.get('http://localhost:3333/syncIncidencias', {
      params: {
        companyNAME: companyNAME,
        database: database,
      },
      timeout: getTimeout(),
    });
    console.log('Incidencias sync sent...');
  } catch (error) {
    console.error('Error al sincronizar incidencias:', error);
  }
}

async function customers(companyID, database) {
  try {
    await axios.get('http://localhost:3333/syncCustomers', {
      params: {
        companyID: companyID,
        database: database,
      },
      timeout: 30000,
    });
    console.log('Customers sync sent...');
  } catch (error) {
    console.error('Error al sincronizar clientes:', error);
  }
}

async function items(companyID, database) {
  try {
    await axios.get('http://localhost:3333/syncItems', {
      params: {
        companyID: companyID,
        database: database,
      },
      timeout: 30000,
    });
    console.log('Items sync sent...');
  } catch (error) {
    console.error('Error al sincronizar ítems:', error);
  }
}

async function itemCategories(companyID, database) {
  try {
    await axios.get('http://localhost:3333/syncItemCategories', {
      params: {
        companyID: companyID,
        database: database,
      },
      timeout: 30000,
    });
    console.log('ItemCategories sync sent...');
  } catch (error) {
    console.error('Error al sincronizar categorías de ítems:', error);
  }
}

async function tickets(companyID, database, botiga) {
  try {
    await axios.get('http://localhost:3333/syncSalesTickets', {
      params: {
        companyID: companyID,
        database: database,
        botiga: botiga,
      },
      timeout: 30000,
    });
    console.log('Tickets sync sent...');
  } catch (error) {
    console.error('Error al sincronizar tickets de ventas:', error);
  }
}
 
async function facturas(companyID, database, idFactura, tabla) {
  try {
    await axios.get('http://localhost:3333/syncSalesFacturas', {
      params: {
        companyID: companyID,
        database: database,
        idFactura: idFactura,
        tabla: tabla,
      },
      timeout: 30000,
    });
    console.log('Facturas sync sent...');
  } catch (error) {
    console.error('Error al sincronizar facturas de ventas:', error);
  }
}


async function setCompanies() {
  try {
    await axios.get('http://localhost:3333/getCompaniesId', {
      params: {
      },
      timeout: 30000,
    });
    console.log('Companies sync sent...');
  } catch (error) {
    console.error('Error al sincronizar companies:', error);
  }
}
async function xml(companyID, idFactura) {
  try {
    await axios.get('http://localhost:3333/generateXML', {
      params: {
        companyID: companyID,
        idFactura: idFactura,
      },
      timeout: 30000,
    });
    console.log('XML create...');
  } catch (error) {
    console.error('Error al crear el XML:', error);
  }
}

async function mail(database, mailTo, idFactura) {
  let res;
  try {
    res = await axios.get('http://localhost:3333/sendMail', {
      params: {
        database: database,
        mailTo: mailTo,
        idFactura: idFactura
      },
      timeout: 30000,
    });
    console.log('Sending mail to ' + mailTo);
  } catch (error) {
    console.error('Error al enviar mail:', error);
  }
}

async function bucle(companyID, companyNAME, database) {
  await setInterval(() => {
    employes(companyID, database);
  }, employeesTime);

  await setInterval(() => {
    signings(companyNAME, database);
  }, signingsTime);

  await setInterval(() => {
    customers(companyID, database);
  }, customersTime);
}

function mqttPublish(msg) {
  if (debug) client.publish('/Hit/Serveis/Apicultor/Log', msg);
  console.log(msg);
}

function obtenerCantidadDeValores(): number {
  // Implementa la lógica para obtener la cantidad de valores
  // Por ejemplo, supongamos que aquí obtienes la cantidad de valores de algún lugar
  // Si no puedes obtener la cantidad en este momento, puedes devolver un valor por defecto
  return 0; // Retorna 0 por defecto en caso de que no puedas obtener la cantidad
}

function getTimeout(): number {
  const cantidadDeValores = obtenerCantidadDeValores(); // Llama a la función para obtener la cantidad de valores
  const timeout = cantidadDeValores * 1000; // Calcula el timeout en función de la cantidad de valores (1 segundo por cada valor)
  if(timeout<30000)
    return 30000;
  return timeout;
}

// bucle()
//employes()
//customers()
//itemCategories()
//items()
//tickets()
//signings()
