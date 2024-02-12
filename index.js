const axios = require("axios")
// horas = *(60*60*1000)
// minutos = *(60*1000)
// segundos = *(1000)
const employeesTime = 5 * (60 * 60 * 1000); // hours
const signingsTime = 5 * (60 * 1000); // minutes
const customersTime = 5 * (60 * 60 * 1000); // hours

var test = false; //test: call functions
var debug = true; //debug: mqtt publish
const mqtt = require('mqtt');
const { config } = require("process");

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
    if (debug){
        console.log('Mensaje recibido en el tema:', topic, '- Contenido:', message.toString())
    }
    try {
        const msgJson = JSON.parse(message);
        console.log('Mensaje en modo JSON:', msgJson);
        if(msgJson.hasOwnProperty('debug')){
            if (msgJson.debug == "true"){
                console.log('Debug: activado')
                debug = true;
            }
            else{
                console.log('Debug: desactivado')
                debug = false;
            }
        } else{
            console.log('No hay debug: desactivado') //No enviar mensajes a /Hit/Serveis/Apicultor/Log
            debug = false;
        }
        if (msgJson.hasOwnProperty('companyID')) {
            console.log('El JSON recibido tiene el campo "companyID"');
            if(!isValidCompanyID(msgJson.companyID)){
                mqttPublish('Error: "companyID" no valido')
            }
        } else {
            console.log('El JSON recibido no tiene el campo "companyID"');
        }
        if (msgJson.hasOwnProperty('database') || msgJson.hasOwnProperty('dataBase')) {
            console.log('El JSON recibido tiene el campo "database"');
        } else {
            console.log('El JSON recibido no tiene el campo "database"');
        }

        if(!test){
            switch (msgJson.msg) {
                case 'SyncEmployes':
                case 'SyncDependentes':                
                case 'employes':
                    if (msgJson.hasOwnProperty('database')) 
                        await employes(msgJson.companyID, msgJson.database);
                    else if (msgJson.hasOwnProperty('dataBase')) 
                        await employes(msgJson.companyID, msgJson.dataBase);
                    break;
                case 'SyncSignings':
                case 'signings':
                    if (msgJson.hasOwnProperty('database')) 
                        await signings(msgJson.companyID, msgJson.database);
                    else if (msgJson.hasOwnProperty('dataBase')) 
                        await signings(msgJson.companyID, msgJson.dataBase);
                    break;
                case 'SyncCustomers':
                case 'customers':
                    if (msgJson.hasOwnProperty('database')) 
                        await customers(msgJson.companyID, msgJson.database);
                    else if (msgJson.hasOwnProperty('dataBase')) 
                        await customers(msgJson.companyID, msgJson.dataBase);
                    break;
                case 'SyncItems':
                case 'items':
                    if (msgJson.hasOwnProperty('database')) 
                        await items(msgJson.companyID, msgJson.database);
                    else if (msgJson.hasOwnProperty('dataBase')) 
                        await items(msgJson.companyID, msgJson.dataBase);
                    break;
                case 'SyncItemscategories':
                case 'itemCategories':
                    if (msgJson.hasOwnProperty('database')) 
                        await itemCategories(msgJson.companyID, msgJson.database);
                    else if (msgJson.hasOwnProperty('dataBase')) 
                        await itemCategories(msgJson.companyID, msgJson.dataBase);
                    break;
                case 'SyncTickets':
                case 'tickets':
                    if (msgJson.hasOwnProperty('database')) 
                        await tickets(msgJson.companyID, msgJson.database);
                    else if (msgJson.hasOwnProperty('dataBase')) 
                        await tickets(msgJson.companyID, msgJson.dataBase);
                    break;
                case 'bucle':
                    if (msgJson.hasOwnProperty('database')) 
                        await bucle(msgJson.companyID, msgJson.database);
                    else if (msgJson.hasOwnProperty('dataBase')) 
                        await bucle(msgJson.companyID, msgJson.dataBase);
                    break;
                default:
                    mqttPublish('Mensaje recibido no coincide con ninguna acción esperada')
                    break;
            }
        } else{
            console.log("Testing: ", test)
        }
        
    } catch (error) {
        if (debug){
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

async function employes(companyID, database) {
    try {
        await axios.get("http://localhost:3333/syncEmployees", {
            params: {
                companyID: companyID,
                database: database
            },
            timeout: 30000
        });
        console.log("Employee sync sent...");
    } catch (error) {
        console.error('Error al sincronizar empleados:', error);
    }
}

async function signings(companyID, database) {
    try {
        await get("http://localhost:3333/syncSignings", {
            params: {
                companyID: companyID,
                database: database
            },
            timeout: 30000
        });
        console.log("Signings sync sent...")
    } catch (error) {
        console.error('Error al sincronizar firmas:', error);
    }
}

async function customers(companyID, database) {
    try {
        await get("http://localhost:3333/syncCustomers", {
            params: {
                companyID: companyID,
                database: database
            },
            timeout: 30000
        });
        console.log("Customers sync sent...")
    } catch (error) {
        console.error('Error al sincronizar clientes:', error);
    }
}

async function items(companyID, database) {
    try {
        await get("http://localhost:3333/syncItems", {
            params: {
                companyID: companyID,
                database: database
            },
            timeout: 30000
        });
        console.log("Items sync sent...")
    } catch (error) {
        console.error('Error al sincronizar ítems:', error);
    }
}

async function itemCategories(companyID, database) {
    try {
        await get("http://localhost:3333/syncItemCategories", {
            params: {
                companyID: companyID,
                database: database
            },
            timeout: 30000
        });
        console.log("ItemCategories sync sent...")
    } catch (error) {
        console.error('Error al sincronizar categorías de ítems:', error);
    }
}

async function tickets(companyID, database) {
    try {
        await get("http://localhost:3333/syncSalesTickets", {
            params: {
                companyID: companyID,
                database: database
            },
            timeout: 30000
        });
        console.log("Tickets sync sent...")
    } catch (error) {
        console.error('Error al sincronizar tickets de ventas:', error);
    }
}

async function bucle(companyID, database) {
    await setInterval(() => {
        employes(companyID, database)
    }, employeesTime);

    await setInterval(() => {
        signings(companyID, database)
    }, signingsTime);

    await setInterval(() => {
        customers(companyID, database)
    }, customersTime);

}

function mqttPublish(msg) {
    if (debug)
        client.publish('/Hit/Serveis/Apicultor/Log', msg);
    console.log(msg);
}

// bucle()
//employes()
//customers()
//itemCategories()
//items()
//tickets()
//signings()