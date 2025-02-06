import { Injectable } from '@nestjs/common';
import { getTokenService } from '../conection/getToken.service';
import { runSqlService } from 'src/conection/sqlConection.service';
import axios from 'axios';
import { query } from 'express';

@Injectable()
export class customersSilemaService {
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
  async syncCustomersSilema(companyID, database, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    let url1 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/customers?$filter=processHit eq true`;
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
    for (let i = 0; i < res.data.value.length; i++) {
      if (res.data.value[i].processHIT) {
        let sqlNif = `select * from clients where Nif = '${res.data.value[i].vatRegistrationNo}'`
        let queryNif = await this.sql.runSql(sqlNif, database)
        if (queryNif.recordset.length == 0) {
          // console.log(`Cliente a procesar: ${res.data.value[i].number}`)
          let sqlCodi = `SELECT MAX(t1.Codi + 1) AS codigo_disponible FROM clients t1 LEFT JOIN clients t2 ON t1.Codi + 1 = t2.Codi WHERE t2.Codi IS NULL;`
          let queryCodi = await this.sql.runSql(sqlCodi, database)

          let Codi = queryCodi.recordset[0].codigo_disponible || 0; // Número convertido a entero o 0 si es inválido
          let Nom = res.data.value[i].name || ""; // Nombre o cadena vacía
          let Nif = res.data.value[i].vatRegistrationNo || ""; // CIF/NIF o cadena vacía
          let Adresa = res.data.value[i].address || ""; // Dirección o cadena vacía
          let Ciutat = res.data.value[i].city || ""; // Ciudad o cadena vacía
          let Cp = res.data.value[i].postCode || 0; // Código postal como entero o 0
          let NomLlarg = res.data.value[i].name || ""; // Nombre largo concatenado
          let eMail = res.data.value[i].eMail || "";
          let phone = res.data.value[i].phoneNo || "";
          let FormaPago = res.data.value[i].paymentMethodCode || "";
          let FormaPagoValor = 0;
          let primaryContactNo = res.data.value[i].primaryContactNo || "";
          let IdHitCFINAL = "";
          let pagaEnTienda = res.data.value[i].payInStore || true;

          let sqlSincroIds = `SELECT * FROM BC_SincroIds WHERE IdBc = '${res.data.value[i].number}'`;
          let querySincro = await this.sql.runSql(sqlSincroIds, database)
          if (querySincro.recordset.length == 0) {
            // Insert clients
            let sqlInsert = `INSERT INTO clients 
            (Codi, Nom, Nif, Adresa, Ciutat, Cp, [Nom Llarg]) VALUES
            (${Codi}, '${Nom}', '${Nif}', '${Adresa}', '${Ciutat}', '${Cp}', '${NomLlarg}')`
            //console.log(sql)

            let TipoDato = "customer"
            let IdBc = res.data.value[i].number || "";
            let IdHit = Codi;
            let IdEmpresaBc = companyID;
            let IdEmpresaHit = database;
            sqlSincroIds = `INSERT INTO BC_SincroIds 
            (TmSt, TipoDato, IdBc, IdHit, IdEmpresaBc, IdEmpresaHit) VALUES
            (GETDATE(), '${TipoDato}', '${IdBc}', '${IdHit}', '${IdEmpresaBc}', '${IdEmpresaHit}')`

            //Comprovar que paymentMethodCode es 
            switch (FormaPago) {
              case 'RebutDomiciliat':
                FormaPagoValor = 1;
                break;
              case 'Cheque':
                FormaPagoValor = 2;
                break;
              case 'CLI_EFECTIVO':
                FormaPagoValor = 3;
                break;
              case 'CLI_TRANSF':
                FormaPagoValor = 4;
                break;
            }
            if (primaryContactNo != "") {
              let sqlCFINAL = `SELECT * FROM BC_SincroIds WHERE IdBc = '${res.data.value[i].primaryContactNo}'`;
              console.log(sqlCFINAL);
              let queryCFINAL = await this.sql.runSql(sqlCFINAL, database)
              if (queryCFINAL.recordset.length > 0 && queryCFINAL.recordset[0].IdHit != null) IdHitCFINAL = queryCFINAL.recordset[0].IdHit;
              else console.log(`El "clientFinal" con IdBc *${res.data.value[i].primaryContactNo}* no existe en la base de datos o no tiene un IdHit`);
            }

            try {
              let queryInsert = await this.sql.runSql(sqlInsert, database)
              let queryInsertSincro = await this.sql.runSql(sqlSincroIds, database)
              if (eMail != "")
                await this.sqlConstantClient(Codi, 'eMail', eMail, 2, database)
              if (phone != "")
                await this.sqlConstantClient(Codi, 'Tel', phone, 2, database)
              if (FormaPagoValor == 0)
                await this.sqlConstantClient(Codi, 'FormaPagoLlista', FormaPagoValor, 2, database)
              if (!pagaEnTienda)
                await this.sqlConstantClient(Codi, 'NoPagaEnTienda', 'NoPagaEnTienda', 2, database)
              if (IdHitCFINAL != "")
                await this.sqlConstantClient(Codi, 'CFINAL', IdHitCFINAL, 2, database)
              const data = {
                processedHIT: true
              };
              let url2 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/customers(${res.data.value[i].id})`
              const patchResponse = await axios.patch(url2, data, {
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "application/json",
                  "If-Match": "*",
                },
              });
            } catch (error) {
              throw new Error('Failed to put customer');
            }
            console.log("Customer procesado")
          }
          else {
            Codi = querySincro.recordset[0].IdHit
            let sqlUpdate = `UPDATE clients SET 
            Nom = '${Nom}',
            Nif = '${Nif}',
            Adresa = '${Adresa}',
            Ciutat = '${Ciutat}',
            Cp = '${Cp}',
            [Nom Llarg] = '${NomLlarg}'
            WHERE Codi = ${Codi};`;
            //console.log(sqlUpdate);
            let eMail = res.data.value[i].eMail || "";
            let phone = res.data.value[i].phoneNo || "";
            let FormaPago = res.data.value[i].paymentMethodCode || "";
            let FormaPagoValor = 0;
            let primaryContactNo = res.data.value[i].primaryContactNo || "";
            let IdHitCFINAL = "";
            let pagaEnTienda = res.data.value[i].payInStore || true;
            switch (FormaPago) {
              case 'RebutDomiciliat':
                FormaPagoValor = 1;
                break;
              case 'Cheque':
                FormaPagoValor = 2;
                break;
              case 'CLI_EFECTIVO':
                FormaPagoValor = 3;
                break;
              case 'CLI_TRANSF':
                FormaPagoValor = 4;
                break;
            }
            if (primaryContactNo != "") {
              IdHitCFINAL = querySincro.recordset[0].IdHit;
            }
            await this.sqlConstantClient(Codi, '', '', 5, database)
            try {
              let queryUpdate = await this.sql.runSql(sqlUpdate, database)
              if (eMail != "")
                await this.sqlConstantClient(Codi, 'eMail', eMail, 2, database)
              if (phone != "")
                await this.sqlConstantClient(Codi, 'Tel', phone, 2, database)
              if (FormaPagoValor == 0)
                await this.sqlConstantClient(Codi, 'FormaPagoLlista', FormaPagoValor, 2, database)
              if (!pagaEnTienda)
                await this.sqlConstantClient(Codi, 'NoPagaEnTienda', 'NoPagaEnTienda', 2, database)
              if (IdHitCFINAL != "")
                await this.sqlConstantClient(Codi, 'CFINAL', IdHitCFINAL, 2, database)
              const data = {
                processedHIT: true
              };
              let url2 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/customers(${res.data.value[i].id})`
              const patchResponse = await axios.patch(url2, data, {
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "application/json",
                  "If-Match": "*",
                },
              });
            } catch (error) {
              throw new Error('Failed to put customer');
            }
            console.log("Customer actualizado")
          }

        } else {
          console.log(`Customer con NIF *${res.data.value[i].vatRegistrationNo}* ya existe en la base de datos`);
          let Codi = queryNif.recordset[0].Codi; // Número convertido a entero o 0 si es inválido
          let Nom = res.data.value[i].name || ""; // Nombre o cadena vacía
          let Nif = res.data.value[i].vatRegistrationNo || ""; // CIF/NIF o cadena vacía
          let Adresa = res.data.value[i].address || ""; // Dirección o cadena vacía
          let Ciutat = res.data.value[i].city || ""; // Ciudad o cadena vacía
          let Cp = res.data.value[i].postCode || 0; // Código postal como entero o 0
          let NomLlarg = res.data.value[i].name || ""; // Nombre largo concatenado
          let sqlUpdate = `UPDATE clients SET 
            Nom = '${Nom}',
            Nif = '${Nif}',
            Adresa = '${Adresa}',
            Ciutat = '${Ciutat}',
            Cp = '${Cp}',
            [Nom Llarg] = '${NomLlarg}'
            WHERE Codi = ${Codi};`;
          //console.log(sqlUpdate);
          let eMail = res.data.value[i].eMail || "";
          let phone = res.data.value[i].phoneNo || "";
          let FormaPago = res.data.value[i].paymentMethodCode || "";
          let FormaPagoValor = 0;
          let primaryContactNo = res.data.value[i].primaryContactNo || "";
          let IdHitCFINAL = "";
          let pagaEnTienda = res.data.value[i].payInStore || true;
          switch (FormaPago) {
            case 'RebutDomiciliat':
              FormaPagoValor = 1;
              break;
            case 'Cheque':
              FormaPagoValor = 2;
              break;
            case 'CLI_EFECTIVO':
              FormaPagoValor = 3;
              break;
            case 'CLI_TRANSF':
              FormaPagoValor = 4;
              break;
          }
          if (primaryContactNo != "") {
            IdHitCFINAL = Codi;
          }

          let TipoDato = "customer"
          let IdBc = res.data.value[i].number || "";
          let IdHit = Codi;
          let IdEmpresaBc = companyID;
          let IdEmpresaHit = database;
          let sqlSincroIds = `INSERT INTO BC_SincroIds 
          (TmSt, TipoDato, IdBc, IdHit, IdEmpresaBc, IdEmpresaHit) VALUES
          (GETDATE(), '${TipoDato}', '${IdBc}', '${IdHit}', '${IdEmpresaBc}', '${IdEmpresaHit}')`

          await this.sqlConstantClient(Codi, '', '', 5, database)
          try {
            let queryUpdate = await this.sql.runSql(sqlUpdate, database)
            let queryInsert = await this.sql.runSql(sqlSincroIds, database)
            if (eMail != "")
              await this.sqlConstantClient(Codi, 'eMail', eMail, 2, database)
            if (phone != "")
              await this.sqlConstantClient(Codi, 'Tel', phone, 2, database)
            if (FormaPagoValor == 0)
              await this.sqlConstantClient(Codi, 'FormaPagoLlista', FormaPagoValor, 2, database)
            if (!pagaEnTienda)
              await this.sqlConstantClient(Codi, 'NoPagaEnTienda', 'NoPagaEnTienda', 2, database)
            if (IdHitCFINAL != "")
              await this.sqlConstantClient(Codi, 'CFINAL', IdHitCFINAL, 2, database)
            const data = {
              processedHIT: true
            };
            let url2 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/customers(${res.data.value[i].id})`
            const patchResponse = await axios.patch(url2, data, {
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                "If-Match": "*",
              },
            });
          } catch (error) {
            throw new Error('Failed to put customer');
          }
          console.log("Customer actualizado")
        }
      }
      console.log(`Synchronizing customers... -> ${i}/${res.data.value.length} --- ${((i / res.data.value.length) * 100).toFixed(2)}%`);
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