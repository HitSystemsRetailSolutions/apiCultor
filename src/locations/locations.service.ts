import { Injectable } from '@nestjs/common';
import { getTokenService } from '../conection/getToken.service';
import { runSqlService } from 'src/conection/sqlConection.service';
import axios from 'axios';
import * as mqtt from 'mqtt';

@Injectable()
export class locationsService {
  private client = mqtt.connect({
    host: process.env.MQTT_HOST,
    username: process.env.MQTT_USER,
    password: process.env.MQTT_PASSWORD,
  });

  constructor(
    private tokenService: getTokenService,
    private sqlService: runSqlService,
  ) {}

  async syncLocations(companyID: string, database: string, client_id: string, client_secret: string, tenant: string, entorno: string, codiHIT?: string) {
    console.log('Sincronizando almacenes...');

    let locations;
    try {
      if (codiHIT) {
      locations = await this.sqlService.runSql(
        `SELECT c.codi AS CODIGO, c.Nom AS NOMBRE, c.Adresa AS DIRECCION, c.Ciutat AS CIUDAD, c.Cp AS CP, c2_email.valor AS EMAIL, c2_tel.valor AS TELEFONO
        FROM clients c
        INNER JOIN ParamsHw ph ON ph.codi = c.codi
        LEFT JOIN ConstantsClient c2_email ON c2_email.codi = c.codi AND c2_email.variable = 'eMail'
        LEFT JOIN ConstantsClient c2_tel ON c2_tel.codi = c.codi AND c2_tel.variable = 'tel'
        WHERE c.codi = ${codiHIT};`,
        database,
      );
      } else {
        locations = await this.sqlService.runSql(
          `SELECT c.codi AS CODIGO, c.Nom AS NOMBRE, c.Adresa AS DIRECCION, c.Ciutat AS CIUDAD, c.Cp AS CP, c2_email.valor AS EMAIL, c2_tel.valor AS TELEFONO
          FROM clients c
          INNER JOIN ParamsHw ph ON ph.codi = c.codi
          LEFT JOIN ConstantsClient c2_email ON c2_email.codi = c.codi AND c2_email.variable = 'eMail'
          LEFT JOIN ConstantsClient c2_tel ON c2_tel.codi = c.codi AND c2_tel.variable = 'tel';`,
          database,
        );
      }
    } catch (error) {
      this.logError(`Database '${database}' does not exist`, error);
      return false;
    }

    if (locations.recordset.length == 0) {
      this.client.publish('/Hit/Serveis/Apicultor/Log', 'No hay registros');
      console.log('Locations. No hay registros');
      return false;
    }

    const token = await this.tokenService.getToken2(client_id, client_secret, tenant);
    let i = 1;
    for (const location of locations.recordset) {
      try {
        const locationData = {
          code: `${location.CODIGO}`,
          displayName: `${location.NOMBRE}`,
          addressLine1: `${location.DIRECCION}`,
          city: `${location.CIUDAD}`,
          country: 'ES',
          postalCode: `${location.CP}`,
          phoneNumber: `${location.TELEFONO}`,
          email: `${location.EMAIL}`,
        };

        const res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/ODataV4/Company('${companyID}')/locationS?$filter=code eq '${location.CODIGO}'`, {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        });

        if (res.data.value.length == 0) {
          await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/ODataV4/Company('${companyID}')/locations`, locationData, {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          });
        } else {
          const etag = res.data.value[0]['@odata.etag'];
          await axios.patch(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/ODataV4/Company('${companyID}')/locations(${res.data.value[0].id})`, locationData, {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
              'If-Match': etag,
            },
          });
        }
      } catch (error) {
        this.logError(`Error processing location ${location.Nombre}`, error);
        return false;
      }
      console.log(`Synchronizing location ${location.Nombre} ... -> ${i}/${locations.recordset.length} --- ${((i / locations.recordset.length) * 100).toFixed(2)}% `);
      i++;
    }
    return true;
  }

  async getLocationFromAPI(companyID, database, codiHIT, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let locationCode = '';
    const token = await this.tokenService.getToken2(client_id, client_secret, tenant);
    let res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/HitSystems/HitSystems/v2.0/companies(${companyID})/locations?$filter=code eq '${codiHIT}'`, {
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
    });

    if (!res.data) throw new Error('Failed to get location');

    if (res.data.value.length > 0) {
      locationCode = res.data.value[0].code;
      console.log(`locationCode existente : ${locationCode}`);
      return locationCode;
    }
    const newLocation = await this.syncLocations(companyID, database, client_id, client_secret, tenant, entorno, codiHIT);
    console.log(`locationCode nuevo : ${locationCode}`);
    return locationCode;
  }

  private logError(message: string, error: any) {
    this.client.publish('/Hit/Serveis/Apicultor/Log', message);
    console.error(message, error);
  }
}
