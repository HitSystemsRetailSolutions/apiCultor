import { Injectable } from '@nestjs/common';
import { getTokenService } from '../conection/getToken.service';
import { runSqlService } from 'src/conection/sqlConection.service';
import axios from 'axios';
import { query } from 'express';

@Injectable()
export class locationSilemaService {
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) { }

  async getSaleFromAPI(companyID, docNumber, client_id: string, client_secret: string, tenant: string, entorno: string) {
    // Get the authentication token
    let token = await this.token.getToken();

    let res = await axios
      .get(
        `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/v2.0/companies(${companyID})/salesInvoices?$filter=externalDocumentNumber eq '${docNumber}'`,
        {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        },
      )
      .catch((error) => {
        throw new Error('Failed to obtain ticket');
      });

    if (!res.data) throw new Error('Failed to obtain ticket');

    return res;
  }

  // Hay que sincronizar primero los clientes finales (contacts) antes que los clientes (customers)
  async syncLocationSilema(companyID, database, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    let url1 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/locations?$filter=processHit eq true`;
    let res = await axios
      .get(
        url1,
        {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
        },
      )
      .catch((error) => {
        console.log(`Url ERROR: ${url1}`)
        throw new Error('Failed to obtain customers');
      });
    let sqlClients = `select * from clients`
    let queryClients = await this.sql.runSql(sqlClients, database)
    for (let i = 0; i < res.data.value.length; i++) {
      if (res.data.value[i].processHIT) {
        let locationExists = false;
        let Nom = res.data.value[i].name || "";
        for (let j = 0; j < queryClients.recordset.length; j++) {
          if (queryClients.recordset[j].Nom.toLowerCase() == Nom.toLowerCase()) {
            locationExists = true;
            break;
          }
        }
        // console.log(`Cliente a procesar: ${res.data.value[i].number}`)
        let sqlCodi = `SELECT MAX(t1.Codi + 1) AS codigo_disponible FROM clients t1 LEFT JOIN clients t2 ON t1.Codi + 1 = t2.Codi WHERE t2.Codi IS NULL;`
        let queryCodi = await this.sql.runSql(sqlCodi, database)

        let Codi = queryCodi.recordset[0].codigo_disponible || 0;
        let Adresa = res.data.value[i].address || "";
        let Ciutat = res.data.value[i].city || "";
        let Cp = res.data.value[i].postCode || 0;
        let NomLlarg = res.data.value[i].name || "";
        let eMail = res.data.value[i].eMail || "";
        let phone = res.data.value[i].phoneNo || "";

        let sqlSincroIds = `SELECT * FROM BC_SincroIds WHERE IdBc = '${res.data.value[i].number}'`;
        let querySincro = await this.sql.runSql(sqlSincroIds, database)
        if (querySincro.recordset.length == 0) {
          // Insert clients
          let sqlInsert = `INSERT INTO clients 
          (Codi, Nom, Adresa, Ciutat, Cp, [Nom Llarg]) VALUES
          (${Codi}, '${Nom}', '${Adresa}', '${Ciutat}', '${Cp}', '${NomLlarg}')`
          //console.log(sqlInsert);

          let TipoDato = "location"
          let IdBc = res.data.value[i].code || "";
          let IdHit = Codi;
          let IdEmpresaBc = companyID;
          let IdEmpresaHit = database;
          sqlSincroIds = `INSERT INTO BC_SincroIds 
          (TmSt, TipoDato, IdBc, IdHit, IdEmpresaBc, IdEmpresaHit) VALUES
          (GETDATE(), '${TipoDato}', '${IdBc}', '${IdHit}', '${IdEmpresaBc}', '${IdEmpresaHit}')`

          try {
            let queryInsert = await this.sql.runSql(sqlInsert, database)
            let queryInsertSincro = await this.sql.runSql(sqlSincroIds, database)
            if (eMail != "")
              await this.sqlConstantClient(Codi, 'eMail', eMail, 2, database)
            if (phone != "")
              await this.sqlConstantClient(Codi, 'Tel', phone, 2, database)
            const data = {
              processedHIT: true
            };
            let url2 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/locations(${res.data.value[i].id})`
            const patchResponse = await axios.patch(url2, data, {
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                "If-Match": "*",
              },
            });
          } catch (error) {
            throw new Error('Failed to put location');
          }
          console.log("Location procesado")
        }
        else {
          Codi = querySincro.recordset[0].IdHit
          let sqlUpdate = `UPDATE clients SET 
            Nom = '${Nom}',
            Adresa = '${Adresa}',
            Ciutat = '${Ciutat}',
            Cp = '${Cp}',
            [Nom Llarg] = '${NomLlarg}'
            WHERE Codi = ${Codi};`;
          console.log(sqlUpdate);
          let eMail = res.data.value[i].eMail || "";
          let phone = res.data.value[i].phoneNo || "";
          await this.sqlConstantClient(Codi, '', '', 5, database)
          try {
            let queryUpdate = await this.sql.runSql(sqlUpdate, database)
            if (eMail != "")
              await this.sqlConstantClient(Codi, 'eMail', eMail, 2, database)
            if (phone != "")
              await this.sqlConstantClient(Codi, 'Tel', phone, 2, database)
            const data = {
              processedHIT: true
            };
            let url2 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/locations(${res.data.value[i].id})`
            const patchResponse = await axios.patch(url2, data, {
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                "If-Match": "*",
              },
            });
          } catch (error) {
            throw new Error('Failed to put location');
          }
          console.log("Location actualizado")
        }
      }
      console.log(`Synchronizing locations... -> ${i}/${res.data.value.length} --- ${((i / res.data.value.length) * 100).toFixed(2)}%`);
    }
    return true;
  }

  async sqlConstantClient(Codi, Variable, Valor, query, database) {
    /*
    query = 1 //SELECT
    query = 2 //INSERT
    query = 3 //UPDATE
    query = 4 //DELETE
    query = 5 //DELETE ALL from Codi
    */
    if (query == 1) {
      let sql = `SELECT * FROM constantClient WHERE Codi = ${Codi} and Variable = ${Variable}`
      let sqlQuery = await this.sql.runSql(sql, database)
      return sqlQuery.length;
    } else if (query == 2) {
      let sql = `INSERT INTO constantsclient (Codi, Variable, Valor) VALUES ('${Codi}', '${Variable}', '${Valor}')`
      let sqlQuery = await this.sql.runSql(sql, database)
    } else if (query == 3) {
      let sql = `UPDATE constantsclient SET Valor = '${Valor}' WHERE Codi = ${Codi} and Variable = ${Variable}`
      let sqlQuery = await this.sql.runSql(sql, database)
    } else if (query == 4) {
      let sql = `DELETE FROM constantsclient WHERE Codi = ${Codi} and Variable = ${Variable}`
      let sqlQuery = await this.sql.runSql(sql, database)
    } else if (query == 5) {
      let sql = `DELETE FROM constantsclient WHERE Codi = ${Codi}`
      let sqlQuery = await this.sql.runSql(sql, database)
    }

  }
}