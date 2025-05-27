import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { getTokenService } from '../connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConection.service';
import axios from 'axios';
import * as mqtt from 'mqtt';
import { salesFacturasService } from 'src/sales/salesFacturas.service';

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
    @Inject(forwardRef(() => salesFacturasService))
    private salesFacturas: salesFacturasService,
  ) {}

  async syncLocations(companyID: string, database: string, client_id: string, client_secret: string, tenant: string, entorno: string, codiHIT?: string) {
    if (tenant === process.env.blockedTenant) return;
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
      this.logError(`❌ Error al ejecutar la consulta SQL en la base de datos '${database}'`, error);
      throw error;
    }

    if (locations.recordset.length == 0) {
      this.client.publish('/Hit/Serveis/Apicultor/Log', 'No hay registros');
      console.error('⚠️ Advertencia: No se encontraron registros de almacén');
      return false;
    }

    const token = await this.tokenService.getToken2(client_id, client_secret, tenant);
    let locationID = '';
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

        let res;
        try {
          res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/locations?$filter=code eq '${location.CODIGO}'`, {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          });
        } catch (error) {
          this.logError(`❌ Error consultando el almacén en BC con código ${location.CODIGO}`, error);
          continue;
        }

        if (res.data.value.length == 0) {
          const createLocation = await axios.post(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/locations`, locationData, {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
          });
          locationID = createLocation.data.id;
        } else {
          const etag = res.data.value[0]['@odata.etag'];
          await axios.patch(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/locations(${res.data.value[0].id})`, locationData, {
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
              'If-Match': etag,
            },
          });
          locationID = res.data.value[0].id;
        }
      } catch (error) {
        this.logError(`❌ Error al procesar el almacén ${location.NOMBRE}:`, error);
        if (codiHIT) {
          throw error;
        }
        continue;
      }
      console.log(`⏳ Sincronizando almacén ${location.NOMBRE} ... -> ${i}/${locations.recordset.length} --- ${((i / locations.recordset.length) * 100).toFixed(2)}% `);
      i++;
    }
    if (codiHIT) {
      return locationID;
    }
    return true;
  }

  async getLocationFromAPI(companyID, database, codiHIT, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let locationCode = '';
    const token = await this.tokenService.getToken2(client_id, client_secret, tenant);
    let res;

    try {
      res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/locations?$filter=code eq '${codiHIT}'`, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      });
    } catch (error) {
      this.logError(`❌ Error consultando almacén con código ${codiHIT}`, error);
      throw error;
    }

    if (res.data.value.length > 0) {
      locationCode = res.data.value[0].code;
      return true;
    }
    await this.syncLocations(companyID, database, client_id, client_secret, tenant, entorno, codiHIT);
    return true;
  }

  private logError(message: string, error: any) {
    this.client.publish('/Hit/Serveis/Apicultor/Log', JSON.stringify({ message, error: error.response?.data || error.message }));
    console.error(message, error.response?.data || error.message);
  }
}
