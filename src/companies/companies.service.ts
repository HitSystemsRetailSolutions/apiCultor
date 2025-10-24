import { Injectable } from '@nestjs/common';
import { getTokenService } from 'src/connection/getToken.service';
import { runSqlService } from 'src/connection/sqlConnection.service';
import axios from 'axios';
import * as mqtt from 'mqtt';

@Injectable()
export class companiesService {
  private client = mqtt.connect({
    host: process.env.MQTT_HOST,
    username: process.env.MQTT_USER,
    password: process.env.MQTT_PASSWORD,
  });
  constructor(
    private tokenService: getTokenService,
    private sqlService: runSqlService,
  ) { }

  async getCompaniesId(client_id: string, client_secret: string, tenant: string, entorno: string) {
    console.log('🔍 Obteniendo empresas de Business Central...');
    const token = await this.tokenService.getToken2(client_id, client_secret, tenant);
    let res;
    try {
      res = await axios.get(`${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies`, {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      });
    } catch (error) {
      this.logError('❌ Error al obtener las empresas de BC', error);
    }
    let companies = res.data.value;
    if (companies.length === 0) {
      console.warn(`⚠️ No se encontraron empresas en la base de datos.`);
      return false;
    }

    try {
      // Obtener empresas almacenadas en la base de datos
      let dbCompanies = await this.sqlService.runSql(`SELECT BC_CompanyID FROM BC_PARAMS WHERE BC_Tenant = '${tenant}' AND BC_Entorno = '${entorno}'`, 'Hit');
      let dbCompanyIds = dbCompanies.recordset.map((row) => row.BC_CompanyID);

      // Lista de IDs de empresas obtenidas de BC
      let apiCompanyIds = companies.map((company) => company.id);

      for (let company of companies) {
        let exists = dbCompanyIds.includes(company.id);
        if (!exists) {
          await this.sqlService.runSql(
            `INSERT INTO BC_PARAMS (BC_CompanyNAME, BC_CompanyID, BC_Tenant, BC_Client_secret, BC_Client_id, BC_Entorno)
                   VALUES ('${company.name}', '${company.id}', '${tenant}', '${client_secret}', '${client_id}', '${entorno}')`,
            'Hit',
          );
        } else {
          await this.sqlService.runSql(
            `UPDATE BC_PARAMS 
                   SET BC_CompanyNAME = '${company.name}', BC_Tenant = '${tenant}', BC_Client_secret = '${client_secret}', BC_Client_id = '${client_id}', BC_Entorno = '${entorno}' 
                   WHERE BC_CompanyID = '${company.id}'`,
            'Hit',
          );
        }
      }

      // Eliminar empresas que ya no están en BC
      let companiesToDelete = dbCompanyIds.filter((id) => !apiCompanyIds.includes(id));
      if (companiesToDelete.length > 0) {
        let idsToDelete = companiesToDelete.map((id) => `'${id}'`).join(',');
        await this.sqlService.runSql(`DELETE FROM BC_PARAMS WHERE BC_CompanyID IN (${idsToDelete})`, 'Hit');
        console.log(`🗑️  Se eliminaron ${companiesToDelete.length} empresas que ya no existen en BC.`);
      }
    } catch (error) {
      this.logError(`❌ Error al procesar las empresas en la base de datos`, error);
      return false;
    }
    return true;
  }

  private logError(message: string, error: any) {
    this.client.publish('/Hit/Serveis/Apicultor/Log', JSON.stringify({ message, error: error.response?.data || error.message }));
    console.error(message, error.response?.data || error.message);
  }
}
