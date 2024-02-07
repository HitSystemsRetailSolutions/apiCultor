const axios = require("axios")
// horas = *(60*60*1000)
// minutos = *(60*1000)
// segundos = *(1000)
const employeesTime = 5 * (60 * 60 * 1000); // hours
const signingsTime = 5 * (60 * 1000); // minutes
const customersTime = 5 * (60 * 60 * 1000); // hours

const mqtt = require('mqtt');

// Definir la URL del broker MQTT
const mqttBrokerUrl = 'mqtt://santaana2.nubehit.com'; // Cambia a la URL de tu broker MQTT

// Crear un cliente MQTT
const client = mqtt.connect(mqttBrokerUrl);

// Manejar evento de conexión
client.on('connect', function () {
    console.log('Conectado al broker MQTT');
    
    // Suscribirse a un tema
    const tema = '/#';
    client.subscribe(tema, function (err) {
        if (err) {
            console.error('Error al suscribirse al tema', err);
        } else {
            console.log('Suscripción exitosa al tema', tema);
        }
    });
});

// Manejar mensajes recibidos
client.on('message', function (topic, message) {
    console.log('Mensaje recibido en el tema:', topic, ' - Contenido:', message.toString())

    try {
        const msgJson = JSON.parse(message);
        console.log('Mensaje en modo JSON:', msgJson);
        if (msgJson.hasOwnProperty('companyID')) {
            process.env.companyID = msgJson.companyID;
            console.log('Se ha asignado process.env.companyID:', process.env.companyID);
        } else {
            console.log('El JSON recibido no tiene el campo "companyID"');
        }
        if (msgJson.hasOwnProperty('database')) {
            process.env.database = msgJson.database;
            console.log('Se ha asignado process.env.database:', process.env.database);
        } else if (msgJson.hasOwnProperty('dataBase')) {
            process.env.database = msgJson.dataBase;
            console.log('Se ha asignado process.env.database:', process.env.database);
        } else {
            console.log('El JSON recibido no tiene el campo "database"');
        }
        
    } catch (error) {
        console.log('Mensaje recibido como una cadena:', message.toString());
    }
});

// Manejar errores
client.on('error', function (error) {
    console.error('Error en el cliente MQTT:', error);
});


async function employes() {
    axios.get("http://localhost:3333/syncEmployees", { timeout: 30000 })
    console.log("Employee sync sent...")
}

async function signings() {
    axios.get("http://localhost:3333/syncSignings", { timeout: 30000 })
    console.log("Signings sync sent...")
}

async function customers() {
    axios.get("http://localhost:3333/syncCustomers", { timeout: 30000 })
    console.log("Customers sync sent...")
}

async function items() {
    axios.get("http://localhost:3333/syncItems", { timeout: 30000 })
    console.log("Items sync sent...")
}

async function itemCategories() {
    axios.get("http://localhost:3333/syncItemCategories", { timeout: 30000 })
    console.log("ItemCategories sync sent...")
}

async function tickets() {
    axios.get("http://localhost:3333/syncSalesTickets", { timeout: 30000 })
    console.log("Tickets sync sent...")
}

async function bucle() {
    await setInterval(() => {
        employes()
    }, employeesTime);

    await setInterval(() => {
        signings()
    }, signingsTime);

    await setInterval(() => {
        customers()
    }, customersTime);

}

// bucle()
//employes()
//customers()
//itemCategories()
//items()
//tickets()
//signings()