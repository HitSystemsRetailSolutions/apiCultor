import { Injectable, Inject, forwardRef } from '@nestjs/common';
import axios from 'axios';
import * as mqtt from 'mqtt';
import { getTokenService } from 'src/connection/getToken.service';

@Injectable()
export class verifactuService {
    private client = mqtt.connect({
        host: process.env.MQTT_HOST,
        username: process.env.MQTT_USER,
        password: process.env.MQTT_PASSWORD,
    });

    constructor(
        private token: getTokenService,
    ) { }

    async generarHuella(docNo: string, docType: string, entorno: string, tenant: string, client_id: string, client_secret: string, companyId: string) {
        console.log(`📡 Enviando factura ${docNo} a la API SOAP de Business Central...`);

        let token = await this.token.getToken2(client_id, client_secret, tenant);
        const getcompanyName = await axios.get(
            `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyId})`,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
            }
        );
        const companyName = getcompanyName.data.name;
        // Escapar correctamente los valores para XML
        const safeDocNo = this.escapeXml(docNo);
        const safeDocType = this.escapeXml(docType);


        const soapEnvelope = `
      <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
                    xmlns:tns="urn:microsoft-dynamics-schemas/codeunit/Huella">
        <soap:Header/>
        <soap:Body>
          <tns:GenerateInvoiceOrCreditHash>
            <tns:docNo>${safeDocNo}</tns:docNo>
            <tns:docType>${safeDocType}</tns:docType>
          </tns:GenerateInvoiceOrCreditHash>
        </soap:Body>
      </soap:Envelope>`.trim();

        const url = `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${entorno}/WS/${companyName}/Codeunit/Huella`;
        // Realizar la solicitud SOAP
        const response = await axios.post(
            url,
            soapEnvelope,
            {
                headers: {
                    Authorization: "Bearer " + token,
                    "Content-Type": "text/xml; charset=utf-8",
                    SOAPAction:
                        "urn:microsoft-dynamics-schemas/codeunit/Huella:GenerateInvoiceOrCreditHash",
                },
            }
        );
        console.log("✅ Respuesta de BC:", response.data);
    }

    async updateURL(companyID, invoiceNumber, endpoint, tenant, entorno, client_id: string, client_secret: string) {
        let factura;
        console.log(`📡 Actualizando la URL de la factura ${invoiceNumber} en Business Central...`);
        try {
            const token = await this.token.getToken2(client_id, client_secret, tenant);
            const url = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/${endpoint}?$filter=number eq '${invoiceNumber}'`;
            const urlID = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/InvoiceHashes?$filter=no eq '${invoiceNumber}'`;
            const urlNIF = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/companyInformation`
            const response = await axios.get(url, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
            });

            const responseID = await axios.get(urlID, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
            });

            const responseNIF = await axios.get(urlNIF, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
            });

            factura = response.data.value[0];
            const id = responseID.data.value[0].Id;
            function formatDate(date) {
                const d = new Date(date);
                const day = String(d.getDate()).padStart(2, '0');
                const month = String(d.getMonth() + 1).padStart(2, '0');
                const year = d.getFullYear();
                return `${day}-${month}-${year}`;
            }
            const nif = responseNIF.data.value[0].taxRegistrationNumber;
            const importe = factura.totalAmountIncludingTax.toFixed(2);
            const updateData = {
                url: `https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=${nif}&numserie=${factura.number}&fecha=${formatDate(factura.postingDate)}&importe=${importe}`,
            };
            const urlUpdate = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/InvoiceHashes(${id})`;
            await axios.patch(urlUpdate, updateData, {
                headers: {
                    Authorization: 'Bearer ' + token,
                    'Content-Type': 'application/json',
                    'If-Match': '*',
                },
            });
        } catch (error) {
            this.logError(`❌ Error al actualizar la factura con id ${factura.id}`, error);
            throw error;
        }
    }
    private escapeXml(unsafe: string): string {
        if (unsafe == null) return '';
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&apos;");
    }
    private logError(message: string, error: any) {
        this.client.publish('/Hit/Serveis/Apicultor/Log', JSON.stringify({ message, error: error.response?.data || error.message }));
        console.error(message, error.response?.data || error.message);
    }
}
