import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { getTokenService } from 'src/connection/getToken.service';
import axios from 'axios';
import * as mqtt from 'mqtt';


@Injectable()
export class noSerieService {
    private client = mqtt.connect({
        host: process.env.MQTT_HOST,
        username: process.env.MQTT_USER,
        password: process.env.MQTT_PASSWORD,
    });

    constructor(
        private tokenService: getTokenService,
    ) { }

    async getNoSerie(companyID: string, client_id: string, client_secret: string, tenant: string, entorno: string, noSerie: string) {
        const token = await this.tokenService.getToken2(client_id, client_secret, tenant);

        try {
            // Verificar si existe noSerie
            const urlSerie = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/noSeries?$filter=code eq '${noSerie}'`;
            const responseSerie = await axios.get(urlSerie, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            });

            // Verificar si existe noSerie+
            const urlSerieReg = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/noSeries?$filter=code eq '${noSerie}_R'`;
            console.log(`Verificando existencia de No Serie+: ${urlSerieReg}`);
            const responseSerieReg = await axios.get(urlSerieReg, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            });

            if (responseSerie.data.value.length > 0 && responseSerieReg.data.value.length > 0) {
                console.log(`No Serie ${noSerie} y ${noSerie}_R ya existen.`);
                return true;
            }

            // Crear noSerie si no existe
            if (responseSerie.data.value.length === 0) {
                console.log(`No Serie ${noSerie} no existe. Creando...`);
                const createUrl = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/noSeries`;
                const noSerieData = {
                    code: noSerie,
                    description: `No Serie ${noSerie}`,
                    defaultNoseries: true,
                    manualNos: false,
                };
                await axios.post(createUrl, noSerieData, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                });

                const createLineUrl = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/noSeriesLines`;
                const noSerieLineData = {
                    code: noSerie,
                    lineNo: 10000,
                    startingNo: `${noSerie}-000001`,
                    endingNo: "",
                    incrementbyNo: 1,
                };
                await axios.post(createLineUrl, noSerieLineData, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                });
            }

            // Crear noSerie_R si no existe
            if (responseSerieReg.data.value.length === 0) {
                console.log(`No Serie ${noSerie}_R no existe. Creando...`);
                const createRegUrl = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/noSeries`;
                const noSerieDataReg = {
                    code: `${noSerie}_R`,
                    description: `No Serie ${noSerie} para facturas registradas`,
                    defaultNoseries: true,
                    manualNos: false,
                };
                await axios.post(createRegUrl, noSerieDataReg, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                });

                const createRegLineUrl = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/noSeriesLines`;
                const noSerieLineData = {
                    code: `${noSerie}_R`,
                    lineNo: 10000,
                    startingNo: `${noSerie}-000001`,
                    endingNo: "",
                    incrementbyNo: 1,
                };
                await axios.post(createRegLineUrl, noSerieLineData, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                });
            }

            return true;

        } catch (error) {
            this.logError('Error obteniendo o creando noSerie de la API', error);
            return false;
        }
    }


    private logError(message: string, error: any) {
        this.client.publish('/Hit/Serveis/Apicultor/Log', JSON.stringify({ message, error: error.response?.data || error.message }));
        console.error(message, error.response?.data || error.message);
    }
}
