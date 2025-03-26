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
  //console.log(`Mqtt Options: ${mqttOptions.host} - ${mqttOptions.username} - ${mqttOptions.password}`)

  // Suscribirse a un tema
  //let tema = '/Hit/Serveis/Apicultor';
  let tema = '/Testing/Hit/Serveis/Apicultor';
  client.subscribe(tema, function (err) {
    if (err) {
      console.error('Error al suscribirse al tema', err);
    } else {
      console.log('Suscripción exitosa al tema', tema);
    }
  });

  /*
  client.subscribe(tema + '/Log', function (err) {
    if (err) {
      console.error('Error al suscribirse al tema', err);
    } else {
      console.log('Suscripción exitosa al tema', tema + '/Log');
    }
  });
  */
});

// Manejar mensajes recibidos
client.on('message', async function (topic, message) {
  if (debug) {
    console.log('Mensaje recibido en el tema:', topic, '- Contenido:', message.toString());
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

    let companyID = '';
    let companyNAME = '';
    let database = '';
    if (msgJson.hasOwnProperty('companyID')) {
      companyID = msgJson.companyID;
      //console.log('El JSON recibido tiene el campo "companyID"');
      if (!isValidCompanyID(msgJson.companyID)) {
        mqttPublish('Error: "companyID" no valido');
      }
    } else if (msgJson.hasOwnProperty('companyNAME') || msgJson.hasOwnProperty('companyName')) {
      if (msgJson.hasOwnProperty('companyNAME')) companyNAME = msgJson.companyNAME;
      else if (msgJson.hasOwnProperty('companyName')) companyNAME = msgJson.companyName;
      //console.log('El JSON recibido tiene el campo "companyNAME"');
    } else if (msgJson.hasOwnProperty('companyID') && (msgJson.hasOwnProperty('companyNAME') || msgJson.hasOwnProperty('companyName'))) {
      companyID = msgJson.companyID;
      if (msgJson.hasOwnProperty('companyNAME')) companyNAME = msgJson.companyNAME;
      else if (msgJson.hasOwnProperty('companyName')) companyNAME = msgJson.companyName;
      //console.log('El JSON recibido tiene el campo "companyNAME" y "companyNAME"');
    } else {
      mqttPublish('El JSON recibido no tiene el campo "companyID" o "companyNAME" ');
    }

    if (msgJson.hasOwnProperty('database') || msgJson.hasOwnProperty('dataBase')) {
      if (msgJson.hasOwnProperty('database')) database = msgJson.database;
      else if (msgJson.hasOwnProperty('dataBase')) database = msgJson.dataBase;
      //console.log('El JSON recibido tiene el campo "database"');
    } else {
      mqttPublish('El JSON recibido no tiene el campo "database"');
    }

    let client_id = process.env.client_id;
    if (msgJson.hasOwnProperty('client_id')) client_id = msgJson.client_id;

    let client_secret = process.env.client_secret;
    if (msgJson.hasOwnProperty('client_secret')) client_secret = msgJson.client_secret;

    let tenant = process.env.tenant;
    if (msgJson.hasOwnProperty('tenant')) tenant = msgJson.tenant;

    let entorno = process.env.entorno;
    if (msgJson.hasOwnProperty('entorno')) entorno = msgJson.entorno;

    let nif = '';
    if (msgJson.hasOwnProperty('nif')) nif = msgJson.nif;

    let turno = 0;
    if (msgJson.hasOwnProperty('turno')) nif = msgJson.turno;

    if (!test) {
      switch (msgJson.msg) {
        case 'SyncEmployes':
        case 'SyncDependentes':
        case 'employes':
          await employes(companyID, database, client_id, client_secret, tenant, entorno);
          break;
        case 'SyncSignings':
        case 'signings':
          await signings(companyNAME, database, client_id, client_secret, tenant, entorno);
          break;
        case 'SyncCustomers':
        case 'customers':
          await customers(companyID, database, client_id, client_secret, tenant, entorno);
          break;
        case 'SyncItems':
        case 'items':
          await items(companyID, database, client_id, client_secret, tenant, entorno);
          break;
        case 'SyncItemscategories':
        case 'itemCategories':
          await itemCategories(companyID, database, client_id, client_secret, tenant, entorno);
          break;
        case 'SyncTickets':
        case 'tickets':
          await tickets(msgJson.dayStart, msgJson.dayEnd, msgJson.month, msgJson.year, companyID, database, msgJson.botiga, client_id, client_secret, tenant, entorno);
          break;
        case 'factura':
          await facturas(companyID, database, msgJson.idFactura, msgJson.tabla, client_id, client_secret, tenant, entorno);
          break;
        case 'Companies':
          await setCompanies(client_id, client_secret, tenant, entorno);
          break;
        case 'xml':
          await xml(companyID, msgJson.idFactura, client_id, client_secret, tenant, entorno);
          break;
        case 'mail':
          await mail(database, msgJson.mailTo, msgJson.idFactura);
          break;
        case 'empresa':
          await empresa(msgJson.name, msgJson.displayName, client_id, client_secret, tenant, entorno, database, msgJson.empresa_id, nif);
          break;
        case 'initConfig':
          await initConfig(companyID, database, client_id, client_secret, tenant, entorno);
          break;
        case 'silemaRecords':
          await syncSalesSilemaRecords(companyID, database, msgJson.botiga, client_id, client_secret, tenant, entorno);
          break;
        case 'silemaDate':
          await syncSalesSilemaDate(msgJson.dayStart, msgJson.dayEnd, msgJson.month, msgJson.year, companyID, database, msgJson.botiga, client_id, client_secret, tenant, entorno);
          break;
        case 'silemaDateTurno':
          await syncSalesSilemaDateTurno(msgJson.dayStart, msgJson.dayEnd, msgJson.month, msgJson.year, companyID, database, msgJson.botiga, turno, client_id, client_secret, tenant, entorno);
          break;
        case 'silema':
          await syncSalesSilema(msgJson.day, msgJson.month, msgJson.year, companyID, database, msgJson.botiga, turno, client_id, client_secret, tenant, entorno);
          break;
        case 'silemaAbono':
          await syncSalesSilemaAbono(msgJson.day, msgJson.month, msgJson.year, companyID, database, msgJson.botiga, turno, client_id, client_secret, tenant, entorno);
          break;
        case 'silemaCierre':
          await syncSalesSilemaCierre(msgJson.day, msgJson.month, msgJson.year, companyID, database, msgJson.botiga, turno, client_id, client_secret, tenant, entorno);
          break;
        case 'silemaRecap':
          await syncSalesSilemaRecap(msgJson.periodoRecap, msgJson.month, msgJson.year, companyID, database, client_id, client_secret, tenant, entorno);
          break;
        case 'silemaRecapManual':
          await syncSalesSilemaRecapManual(msgJson.tickets, msgJson.client, msgJson.botiga, msgJson.month, msgJson.year, companyID, database, client_id, client_secret, tenant, entorno);
          break;
        case 'silemaItems':
          await syncItemsSilema(companyID, database, client_id, client_secret, tenant, entorno);
          break;
        case 'silemaCustomers':
          await syncCustomersSilema(companyID, database, client_id, client_secret, tenant, entorno);
          break;
        case 'silemaContacts':
          await syncContactsSilema(companyID, database, client_id, client_secret, tenant, entorno);
          break;
        case 'silemaVendors':
          await syncVendorsSilema(companyID, database, client_id, client_secret, tenant, entorno);
          break;
        case 'silemaLocations':
          await syncLocationsSilema(companyID, database, client_id, client_secret, tenant, entorno);
          break;
        case 'maestros':
          await syncContactsSilema(companyID, database, client_id, client_secret, tenant, entorno);
          await syncCustomersSilema(companyID, database, client_id, client_secret, tenant, entorno);
          await syncVendorsSilema(companyID, database, client_id, client_secret, tenant, entorno);
          await syncLocationsSilema(companyID, database, client_id, client_secret, tenant, entorno);
          break;
        case 'maestrosItems':
          await syncItemsSilema(companyID, database, client_id, client_secret, tenant, entorno);
          await syncContactsSilema(companyID, database, client_id, client_secret, tenant, entorno);
          await syncCustomersSilema(companyID, database, client_id, client_secret, tenant, entorno);
          await syncVendorsSilema(companyID, database, client_id, client_secret, tenant, entorno);
          await syncLocationsSilema(companyID, database, client_id, client_secret, tenant, entorno);
          break;
        default:
          mqttPublish('Mensaje recibido no coincide con ninguna acción esperada');
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
  const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return regex.test(companyID);
}

async function employes(companyID, database, client_id, client_secret, tenant, entorno) {
  try {
    await axios.get('http://localhost:3333/syncEmployees', {
      params: {
        companyID: companyID,
        database: database,
        client_id: client_id,
        client_secret: client_secret,
        tenant: tenant,
        entorno: entorno,
      },
      timeout: 30000,
    });
    console.log('Employee sync sent...');
  } catch (error) {
    console.error('Error al sincronizar empleados:', error);
  }
}

async function signings(companyNAME, database, client_id, client_secret, tenant, entorno) {
  try {
    await axios.get('http://localhost:3333/syncSignings', {
      params: {
        companyNAME: companyNAME,
        database: database,
        client_id: client_id,
        client_secret: client_secret,
        tenant: tenant,
        entorno: entorno,
      },
      timeout: 30000,
    });
    console.log('Signings sync sent...');
  } catch (error) {
    console.error('Error al sincronizar firmas:', error);
  }
}

async function syncSalesSilemaRecords(companyID, database, botiga, client_id, client_secret, tenant, entorno) {
  try {
    await axios.get('http://localhost:3333/syncSalesSilemaRecords', {
      params: {
        companyID: companyID,
        database: database,
        botiga: botiga,
        client_id: client_id,
        client_secret: client_secret,
        tenant: tenant,
        entorno: entorno,
      },
    });
    console.log('Sales Silema Records sync sent...');
  } catch (error) {
    console.error('Error al sincronizar Sales Silema Records:', error);
  }
}

async function syncSalesSilemaDate(dayStart, dayEnd, month, year, companyID, database, botiga, client_id, client_secret, tenant, entorno) {
  try {
    await axios.get('http://localhost:3333/syncSalesSilemaDate', {
      params: {
        dayStart: dayStart,
        dayEnd: dayEnd,
        month: month,
        year: year,
        companyID: companyID,
        database: database,
        botiga: botiga,
        client_id: client_id,
        client_secret: client_secret,
        tenant: tenant,
        entorno: entorno,
      },
    });
    console.log('Sales Silema Date sync sent...');
  } catch (error) {
    console.error('Error al sincronizar Sales Silema Date:', error);
  }
}

async function syncSalesSilemaDateTurno(dayStart, dayEnd, month, year, companyID, database, botiga, turno, client_id, client_secret, tenant, entorno) {
  try {
    await axios.get('http://localhost:3333/syncSalesSilemaDate', {
      params: {
        dayStart: dayStart,
        dayEnd: dayEnd,
        month: month,
        year: year,
        companyID: companyID,
        database: database,
        botiga: botiga,
        turno: turno,
        client_id: client_id,
        client_secret: client_secret,
        tenant: tenant,
        entorno: entorno,
      },
    });
    console.log('Sales Silema Date sync sent...');
  } catch (error) {
    console.error('Error al sincronizar Sales Silema Date:', error);
  }
}

async function syncSalesSilema(day, month, year, companyID, database, botiga, turno, client_id, client_secret, tenant, entorno) {
  try {
    await axios.get('http://localhost:3333/syncSalesSilema', {
      params: {
        day: day,
        month: month,
        year: year,
        companyID: companyID,
        database: database,
        botiga: botiga,
        turno: turno,
        client_id: client_id,
        client_secret: client_secret,
        tenant: tenant,
        entorno: entorno,
      },
      timeout: 30000,
    });
    console.log('Sales Silema sync sent...');
  } catch (error) {
    console.error('Error al sincronizar Sales Silema:', error);
  }
}

async function syncSalesSilemaAbono(day, month, year, companyID, database, botiga, turno, client_id, client_secret, tenant, entorno) {
  try {
    await axios.get('http://localhost:3333/syncSalesSilemaAbono', {
      params: {
        day: day,
        month: month,
        year: year,
        companyID: companyID,
        database: database,
        botiga: botiga,
        turno: turno,
        client_id: client_id,
        client_secret: client_secret,
        tenant: tenant,
        entorno: entorno,
      },
      timeout: 30000,
    });
    console.log('Sales Silema Abono sync sent...');
  } catch (error) {
    console.error('Error al sincronizar Sales Silema Abono:', error);
  }
}

async function syncSalesSilemaCierre(day, month, year, companyID, database, botiga, turno, client_id, client_secret, tenant, entorno) {
  try {
    await axios.get('http://localhost:3333/syncSalesSilemaCierre', {
      params: {
        day: day,
        month: month,
        year: year,
        companyID: companyID,
        database: database,
        botiga: botiga,
        turno: turno,
        client_id: client_id,
        client_secret: client_secret,
        tenant: tenant,
        entorno: entorno,
      },
      timeout: 30000,
    });
    console.log('Sales Silema Cierre sync sent...');
  } catch (error) {
    console.error('Error al sincronizar Sales Silema Cierre:', error);
  }
}

async function syncSalesSilemaRecap(periodoRecap, month, year, companyID, database, client_id, client_secret, tenant, entorno) {
  try {
    await axios.get('http://localhost:3333/syncSalesSilemaRecap', {
      params: {
        periodoRecap: periodoRecap,
        month: month,
        year: year,
        companyID: companyID,
        database: database,
        client_id: client_id,
        client_secret: client_secret,
        tenant: tenant,
        entorno: entorno,
      },
    });
    console.log('Sales Silema Recap sync sent...');
  } catch (error) {
    console.error('Error al sincronizar Sales Silema Recap:', error);
  }
}

async function syncSalesSilemaRecapManual(TicketsArray, client, botiga, month, year, companyID, database, client_id, client_secret, tenant, entorno) {
  try {
    await axios.get('http://localhost:3333/syncSalesSilemaRecapManual', {
      params: {
        TicketsArray: TicketsArray,
        client: client,
        botiga: botiga,
        month: month,
        year: year,
        companyID: companyID,
        database: database,
        client_id: client_id,
        client_secret: client_secret,
        tenant: tenant,
        entorno: entorno,
      },
    });
    console.log('Sales Silema Recap sync sent...');
  } catch (error) {
    console.error('Error al sincronizar Sales Silema Recap:', error);
  }
}

async function syncItemsSilema(companyID, database, client_id, client_secret, tenant, entorno) {
  try {
    await axios.get('http://localhost:3333/syncItemsSilema', {
      params: {
        companyID: companyID,
        database: database,
        client_id: client_id,
        client_secret: client_secret,
        tenant: tenant,
        entorno: entorno,
      },
      timeout: 30000,
    });
    console.log('Items Silema sync sent...');
  } catch (error) {
    console.error('Error al sincronizar Items Silema:', error);
  }
}

async function syncCustomersSilema(companyID, database, client_id, client_secret, tenant, entorno) {
  try {
    await axios.get('http://localhost:3333/syncCustomersSilema', {
      params: {
        companyID: companyID,
        database: database,
        client_id: client_id,
        client_secret: client_secret,
        tenant: tenant,
        entorno: entorno,
      },
      timeout: 30000,
    });
    console.log('Customers Silema sync sent...');
  } catch (error) {
    console.error('Error al sincronizar Customers Silema:', error);
  }
}

async function syncContactsSilema(companyID, database, client_id, client_secret, tenant, entorno) {
  try {
    await axios.get('http://localhost:3333/syncContactsSilema', {
      params: {
        companyID: companyID,
        database: database,
        client_id: client_id,
        client_secret: client_secret,
        tenant: tenant,
        entorno: entorno,
      },
      timeout: 30000,
    });
    console.log('Contacts Silema sync sent...');
  } catch (error) {
    console.error('Error al sincronizar Contacts Silema:', error);
  }
}

async function syncVendorsSilema(companyID, database, client_id, client_secret, tenant, entorno) {
  try {
    await axios.get('http://localhost:3333/syncVendorsSilema', {
      params: {
        companyID: companyID,
        database: database,
        client_id: client_id,
        client_secret: client_secret,
        tenant: tenant,
        entorno: entorno,
      },
      timeout: 30000,
    });
    console.log('Vendors Silema sync sent...');
  } catch (error) {
    console.error('Error al sincronizar Vendors Silema:', error);
  }
}

async function syncLocationsSilema(companyID, database, client_id, client_secret, tenant, entorno) {
  try {
    await axios.get('http://localhost:3333/syncLocationSilema', {
      params: {
        companyID: companyID,
        database: database,
        client_id: client_id,
        client_secret: client_secret,
        tenant: tenant,
        entorno: entorno,
      },
      timeout: 30000,
    });
    console.log('Locations Silema sync sent...');
  } catch (error) {
    console.error('Error al sincronizar Locations Silema:', error);
  }
}

async function customers(companyID, database, client_id, client_secret, tenant, entorno) {
  try {
    await axios.get('http://localhost:3333/syncCustomers', {
      params: {
        companyID: companyID,
        database: database,
        client_id: client_id,
        client_secret: client_secret,
        tenant: tenant,
        entorno: entorno,
      },
      timeout: 30000,
    });
    console.log('Customers sync sent...');
  } catch (error) {
    console.error('Error al sincronizar clientes:', error);
  }
}

async function items(companyID, database, client_id, client_secret, tenant, entorno) {
  try {
    await axios.get('http://localhost:3333/syncItems', {
      params: {
        companyID: companyID,
        database: database,
        client_id: client_id,
        client_secret: client_secret,
        tenant: tenant,
        entorno: entorno,
      },
      timeout: 30000,
    });
    console.log('Items sync sent...');
  } catch (error) {
    console.error('Error al sincronizar ítems:', error);
  }
}

async function itemCategories(companyID, database, client_id, client_secret, tenant, entorno) {
  try {
    await axios.get('http://localhost:3333/syncItemCategories', {
      params: {
        companyID: companyID,
        database: database,
        client_id: client_id,
        client_secret: client_secret,
        tenant: tenant,
        entorno: entorno,
      },
      timeout: 30000,
    });
    console.log('ItemCategories sync sent...');
  } catch (error) {
    console.error('Error al sincronizar categorías de ítems:', error);
  }
}

async function tickets(dayStart, dayEnd, month, year, companyID, database, botiga, client_id, client_secret, tenant, entorno) {
  try {
    await axios.get('http://localhost:3333/syncSalesTickets', {
      params: {
        dayStart: dayStart,
        dayEnd: dayEnd,
        month: month,
        year: year,
        companyID: companyID,
        database: database,
        botiga: botiga,
        client_id: client_id,
        client_secret: client_secret,
        tenant: tenant,
        entorno: entorno,
      },
    });
    console.log('Tickets sync sent...');
  } catch (error) {
    console.error('Error al sincronizar tickets de ventas:', error);
  }
}

async function facturas(companyID, database, idFactura, tabla, client_id, client_secret, tenant, entorno) {
  try {
    await axios.get('http://localhost:3333/syncSalesFacturas', {
      params: {
        companyID: companyID,
        database: database,
        idFactura: idFactura,
        tabla: tabla,
        client_id: client_id,
        client_secret: client_secret,
        tenant: tenant,
        entorno: entorno,
      },
    });
    console.log('Sincronización de facturas acabada');
  } catch (error) {
    console.error('Error al sincronizar facturas de ventas:', error);
  }
}

async function setCompanies(client_id, client_secret, tenant, entorno) {
  try {
    await axios.get('http://localhost:3333/getCompaniesId', {
      params: {
        client_id: client_id,
        client_secret: client_secret,
        tenant: tenant,
        entorno: entorno,
      },
      timeout: 30000,
    });
    console.log('Companies sync sent...');
  } catch (error) {
    console.error('Error al sincronizar companies:', error);
  }
}

async function xml(companyID, idFactura, client_id, client_secret, tenant, entorno) {
  try {
    await axios.get('http://localhost:3333/generateXML', {
      params: {
        companyID: companyID,
        idFactura: idFactura,
        client_id: client_id,
        client_secret: client_secret,
        tenant: tenant,
        entorno: entorno,
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
        idFactura: idFactura,
      },
      timeout: 30000,
    });
    console.log('Sending mail to ' + mailTo);
  } catch (error) {
    console.error('Error al enviar mail:', error);
  }
}

async function empresa(name, displayName, client_id, client_secret, tenant, entorno, database, empresa_id, nif) {
  let res;
  try {
    console.log(`Intentado crear la empresa ${name}`);
    res = await axios.get('http://localhost:3333/crearEmpresa', {
      params: {
        name: name,
        displayName: displayName,
        client_id: client_id,
        client_secret: client_secret,
        tenant: tenant,
        entorno: entorno,
        database: database,
        empresa_id: empresa_id,
        nif: nif,
      },
    });
  } catch (error) {
    console.error('Error al crear la empresa:', error);
  }
}

async function initConfig(companyID, database, client_id, client_secret, tenant, entorno) {
  let res;
  console.log(`companyID: ${companyID}, database: ${database}, client_id: ${client_id}, client_secret: ${client_secret}, tenant: ${tenant}, entorno: ${entorno}`);
  try {
    console.log(`Intentado la configuración inicial de la empresa`);
    res = await axios.get('http://localhost:3333/initConfig', {
      params: {
        companyID,
        database: database,
        client_id: client_id,
        client_secret: client_secret,
        tenant: tenant,
        entorno: entorno,
      },
    });
  } catch (error) {
    console.error('Error:', error);
  }
}

function mqttPublish(msg) {
  if (debug) client.publish('/Hit/Serveis/Apicultor/Log', msg);
  //console.log(msg);
}

function mqttPublishRepeat(msg) {
  client.publish('/Hit/Serveis/Apicultor', JSON.stringify(msg));
  //console.log(msg);
}

export { mqttPublish, mqttPublishRepeat };
