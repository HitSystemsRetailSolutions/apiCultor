import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { getTokenService } from 'src/connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConnection.service';
import axios from 'axios';
import * as mqtt from 'mqtt';


@Injectable()
export class xmlService {
    private client = mqtt.connect({
        host: process.env.MQTT_HOST,
        username: process.env.MQTT_USER,
        password: process.env.MQTT_PASSWORD,
    });

    constructor(
        private tokenService: getTokenService,
        private sqlService: runSqlService,
    ) { }

    async getXML(companyID: string, database: string, client_id: string, client_secret: string, tenant: string, entorno: string, id: string, endpoint: string) {
        console.log('Iniciando proceso para obtener XML de la factura con ID:', id);
        const token = await this.tokenService.getToken2(client_id, client_secret, tenant);
        const getDocumentNo = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/${endpoint}(${id})`, {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        });
        const documentNo = getDocumentNo.data.number;
        try {
            const urlGet = `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/edocLog?$filter=documentNo eq '${documentNo}' and status eq 'Exported'&$orderby=entryNo desc&$top=1`;
            const responseGet = await axios.get(urlGet, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            });
            const num = responseGet.data.value[0].storageEntryNo;
            const url = `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/edocData(${num})/xml`;
            const xmlResponse = await axios.get(url, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/xml',
                },
            });
            const archivoBase64 = Buffer.from(xmlResponse.data).toString('base64');
            await this.subirXml(id, archivoBase64, database, client_id, client_secret, tenant, entorno, companyID, endpoint);
            return true;
        } catch (error) {
            this.logError('Error al obtener el XML de la factura', error);
            return false;
        }
    }
    async subirXml(facturaId: string, archivoBase64: string, database: string, client_id: string, client_secret: string, tenant: string, entorno: string, companyID: string, endpoint: string) {
        console.log('Iniciando subida de XML para la factura con ID:', facturaId);
        const token = await this.tokenService.getToken2(client_id, client_secret, tenant);
        try {
            const bufferArchivo = Buffer.from(archivoBase64, 'base64');
            const url = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/${endpoint}(${facturaId})`;
            const res = await axios.get(url, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            });
            if (!res.data) {
                this.logError('Respuesta inválida al obtener la factura', res.data);
            }
            const { postingDate } = res.data;
            const year = postingDate.split('-')[0];
            const xmlHex = bufferArchivo.toString('hex');
            const sql = `UPDATE BC_SyncSales_${year} SET BC_XML=0x${xmlHex} WHERE BC_IdSale='${facturaId}'`;
            await this.sqlService.runSql(sql, database);
            return { msg: 'Se ha insertado correctamente' };
        } catch (error) {
            this.logError('Error al subir el XML', error);
        }

    }

    private logError(message: string, error: any) {
        this.client.publish('/Hit/Serveis/Apicultor/Log', JSON.stringify({ message, error: error.response?.data || error.message }));
        console.error(message, error.response?.data || error.message);
    }
}
