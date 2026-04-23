import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as bodyParser from 'body-parser';
import { join } from 'path';
import { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.use(bodyParser.json({ limit: '50mb' }));
  app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
  app.useStaticAssets(join(__dirname, '..', 'public'));
  await app.listen(3333);
}
bootstrap();

const axios = require('axios');
axios.defaults.baseURL = 'http://localhost:3333';
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
  //let tema = '/Ana/Hit/Serveis/Apicultor';
  //let tema = '/Testinggg/Hit/Serveis/Apicultor';
  
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
    console.log('Mensaje recibido en el tema:', topic, '- Contenido:', message.toString());
  }
  try {
    const msgJson = JSON.parse(message);
    console.log('Mensaje en modo JSON:', msgJson);

    // DEBUG
    const debug = msgJson.debug === 'true';
    console.log(`Debug: ${debug ? 'activado' : 'desactivado'}`);

    // TEST
    const test = msgJson.test === 'true';
    console.log(`Test: ${test ? 'activado' : 'desactivado'}`);

    // COMPANY
    let companyID = msgJson.companyID || '';
    let companyNAME = msgJson.companyNAME ?? msgJson.companyName ?? '';

    if (companyID) {
      if (!isValidCompanyID(companyID)) {
        mqttPublish('Error: "companyID" no valido');
        return;
      }
    } else if (!companyNAME) {
      mqttPublish('El JSON recibido no tiene el campo "companyID" o "companyNAME"');
    }

    // DATABASE
    let database = msgJson.database ?? msgJson.dataBase;
    if (!database) {
      mqttPublish('El JSON recibido no tiene el campo "database"');
    }

    // ENVIRONMENT VARIABLES
    const client_id = msgJson.client_id || process.env.client_id;
    const client_secret = msgJson.client_secret || process.env.client_secret;
    const tenant = msgJson.tenant || process.env.tenant;
    const entorno = msgJson.entorno || process.env.entorno;

    const nif = msgJson.nif || '';
    const turno = msgJson.turno || 0;

    if (!test) {
      const actions = {
        SyncEmployees: () => callSync('syncEmployees', { companyID, database, client_id, client_secret, tenant, entorno }, '✅ Sincronización de empleados acabada'),
        SyncDependentes: () => callSync('syncEmployees', { companyID, database, client_id, client_secret, tenant, entorno }, '✅ Sincronización de empleados acabada'),
        employees: () => callSync('syncEmployees', { companyID, database, client_id, client_secret, tenant, entorno }, '✅ Sincronización de empleados acabada'),

        SyncCustomers: () => callSync('syncCustomers', { companyID, database, client_id, client_secret, tenant, entorno }, '✅ Sincronización de clientes acabada'),
        customers: () => callSync('syncCustomers', { companyID, database, client_id, client_secret, tenant, entorno }, '✅ Sincronización de clientes acabada'),

        SyncItems: () => callSync('syncItems', { companyID, database, client_id, client_secret, tenant, entorno }, '✅ Sincronización de artículos acabada'),
        items: () => callSync('syncItems', { companyID, database, client_id, client_secret, tenant, entorno }, '✅ Sincronización de artículos acabada'),

        SyncItemsMP: () => callSync('syncItemsMP', { companyID, database, client_id, client_secret, tenant, entorno, codiHIT: msgJson.codiHIT }, '✅ Sincronización de artículos MP acabada'),
        itemsMP: () => callSync('syncItemsMP', { companyID, database, client_id, client_secret, tenant, entorno, codiHIT: msgJson.codiHIT }, '✅ Sincronización de artículos MP acabada'),

        SyncVendors: () => callSync('syncVendors', { companyID, database, client_id, client_secret, tenant, entorno }, '✅ Sincronización de proveedores acabada'),
        vendors: () => callSync('syncVendors', { companyID, database, client_id, client_secret, tenant, entorno }, '✅ Sincronización de proveedores acabada'),

        SyncItemscategories: () => callSync('syncItemCategories', { companyID, database, client_id, client_secret, tenant, entorno }, '✅ Sincronización de familias de artículos acabada'),
        itemCategories: () => callSync('syncItemCategories', { companyID, database, client_id, client_secret, tenant, entorno }, '✅ Sincronización de familias de artículos acabada'),

        factura: () => callSync('syncSalesFacturas', { companyID, database, idFactura: msgJson.idFactura, tabla: msgJson.tabla, client_id, client_secret, tenant, entorno }, '✅ Sincronización de facturas acabada'),
        reintentarPDF: () => callSync('reintentarPDF', { idFactura: msgJson.idFactura, database, client_id, client_secret, tenant, entorno, companyID, endpoint: msgJson.endpoint }, '✅ Reintento de subida de PDF realizado'),
        invoiceByNumber: () => callSync('getInvoiceByNumber', { companyID, invoiceNumber: msgJson.invoiceNumber, client_id, client_secret, tenant, entorno, database }, '✅ Factura obtenida por número'),
        xml: () => callSync('getXML', { companyID, database, client_id, client_secret, tenant, entorno, id: msgJson.id, endpoint: msgJson.endpoint }, '✅ XML de factura obtenido'),
        updateRegistro: () => callSync('updateRegistro', { companyID, database, idFactura: msgJson.idFactura, client_id, client_secret, tenant, entorno, endpoint: msgJson.endpoint }, '✅ Registro de factura actualizado'),
        rellenarBCSyncSales: () => callSync('rellenarBCSyncSales', { companyID, database, idFactura: msgJson.idFactura, client_id, client_secret, tenant, entorno, year: msgJson.year }, '✅ Relleno de BC_SyncSales realizado'),

        facturaCompra: () => callSync('syncPurchaseFacturas', { companyID, database, idFactura: msgJson.idFactura, tabla: msgJson.tabla, client_id, client_secret, tenant, entorno }, '✅ Sincronización de facturas de compra acabada'),
        purchaseInvoiceByNumber: () => callSync('getPurchaseInvoiceByNumber', { companyID, invoiceNumber: msgJson.invoiceNumber, client_id, client_secret, tenant, entorno, database }, '✅ Factura de compra obtenida por número'),
        updateRegistroPurchase: () => callSync('updateRegistroPurchase', { companyID, database, idFactura: msgJson.idFactura, client_id, client_secret, tenant, entorno, endpoint: msgJson.endpoint }, '✅ Registro de factura de compra actualizado'),
        rellenarBCSyncPurchase: () => callSync('rellenarBCSyncPurchase', { companyID, database, idFactura: msgJson.idFactura, client_id, client_secret, tenant, entorno, year: msgJson.year }, '✅ Relleno de BC_SyncPurchase realizado'),

        Companies: () => callSync('getCompaniesId', { client_id, client_secret, tenant, entorno }, '✅ Información de empresas obtenida'),
        mail: () => callSync('sendMail', { database, mailTo: msgJson.mailTo, idFactura: msgJson.idFactura }, '✅ Envío de correo electrónico realizado'),

        empresa: () => callSync('crearEmpresa', { name: msgJson.name, displayName: msgJson.displayName, client_id, client_secret, tenant, entorno, database, empresa_id: msgJson.empresa_id, nif }, '✅ Empresa sincronizada'),
        initConfig: () => callSync('initConfig', { companyID, database, client_id, client_secret, tenant, entorno }, '✅ Configuración inicial completada'),
        incidencias: () => callSync('syncIncidencias', { companyID, database, client_id, client_secret, tenant, entorno }, '✅ Sincronización de incidencias acabada'),
        syncTickets: () => callSync('syncTickets', { companyID, database, client_id, client_secret, tenant, entorno, botiga: msgJson.botiga, dia: msgJson.dia }, '✅ Sincronización de tickets acabada'),
        automateTicketSync: () => callSync('automateTicketSync', { tenant, entorno }, '✅ Automatización de tickets acabada'),
        ventasPrevisiones: () => callSync('syncVentasPrevisiones', { companyID, database, client_id, client_secret, tenant, entorno }, '✅ Sincronización de previsiones y ventas acabada'),
      };

      // Ejecutar acción según el mensaje
      if (actions[msgJson.msg]) {
        await actions[msgJson.msg]();
      } else {
        mqttPublish('Mensaje recibido no coincide con ninguna acción esperada');
      }
    } else {
      console.log('Testing: ', test);
    }
  } catch (error) {
    if (debug) {
      console.log('Mensaje recibido como una cadena');
    }
    console.error('Error al procesar el mensaje:', error);
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

async function callSync(endpoint, params, successMsg) {
  console.log(`🔄 Llamando a la función de sincronización: ${endpoint}`);
  try {
    await axios.get(endpoint, {
      params,
    });
    console.log(successMsg);
  } catch (error) {
    console.error(`Error al sincronizar en ${endpoint}: ${error.message}`);
  }
}

function mqttPublish(msg) {
  if (debug) client.publish('/Hit/Serveis/Apicultor/Log', msg);
}

export { mqttPublish };
