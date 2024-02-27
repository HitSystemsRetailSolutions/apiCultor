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

var test = true; //test: call functions
var debug = true; //debug: mqtt publish
const mqtt = require('mqtt');
const { config } = require('process');

// Definir la URL del broker MQTT
const mqttBrokerUrl = 'mqtt://santaana2.nubehit.com'; // Cambia a la URL de tu broker MQTT

// Crear un cliente MQTT
const client = mqtt.connect(mqttBrokerUrl);

// Manejar evento de conexión
client.on('connect', function () {
  console.log('Conectado al broker MQTT');

  // Suscribirse a un tema
  const tema = '/Hit/Serveis/Apicultor';
  client.subscribe(tema, function (err) {
    if (err) {
      console.error('Error al suscribirse al tema', err);
    } else {
      console.log('Suscripción exitosa al tema', tema);
    }
  });
});

client.on('connect', function () {
  console.log('Conectado al broker MQTT');

  // Suscribirse a un tema
  const tema = '/Hit/Serveis/Apicultor/Log';
  client.subscribe(tema, function (err) {
    if (err) {
      console.error('Error al suscribirse al tema', err);
    } else {
      console.log('Suscripción exitosa al tema', tema);
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
    if (msgJson.hasOwnProperty('companyID')) {
      console.log('El JSON recibido tiene el campo "companyID"');
      if (!isValidCompanyID(msgJson.companyID)) {
        mqttPublish('Error: "companyID" no valido');
      }
    } else {
      mqttPublish('El JSON recibido no tiene el campo "companyID"');
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

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

async function downloadPdf(pdfName: string): Promise<{ success: boolean, filePath?: string, error?: string }> {
  try {
    const response = await axios.get(`http://localhost:3333/pdf/${pdfName}`, {
      responseType: 'arraybuffer', // Cambiar el tipo de respuesta a arraybuffer
      timeout: 30000,
    });
    console.log("hola");
    if (response.status === 200) {
      const tempDir = os.tmpdir(); // Directorio temporal del sistema
      const filePath = path.join(tempDir, `${pdfName}.pdf`); // Ruta donde se guardará el archivo temporal
      fs.writeFileSync(filePath, Buffer.from(response.data, 'binary')); // Escribir el archivo en disco
      console.log(filePath);
      return { success: true, filePath };
    } else {
      throw new Error('Error al descargar el PDF');
    }
  } catch (error) {
    console.error('Error al descargar el PDF:', error);
    return { success: false, error: 'Error al descargar el PDF' };
  }
}
function mqttPublish(msg) {
  if (debug) client.publish('/Hit/Serveis/Apicultor/Log', msg);
  console.log(msg);
}

// bucle()
//employes()
//customers()
//itemCategories()
//items()
//tickets()
//signings()
