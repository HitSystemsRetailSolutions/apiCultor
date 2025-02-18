import { Injectable } from '@nestjs/common';
import { getTokenService } from '../conection/getToken.service';
import { runSqlService } from 'src/conection/sqlConection.service';
import axios from 'axios';

@Injectable()
export class contactsSilemaService {
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

  async syncContactsSilema(companyID, database, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    let url1 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/contacts?$filter=processHit eq true`;
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
        throw new Error('Failed to obtain contacts');
      });
    for (let i = 0; i < res.data.value.length; i++) {
      if (res.data.value[i].processHIT) {
        let Id = `CliBoti_000_{${res.data.value[i].id.toUpperCase() || ""}}`
        let Nom = res.data.value[i].name || "0";
        let Telefon = res.data.value[i].phoneNo || "0";
        let Adreca = res.data.value[i].address || "0";
        let emili = res.data.value[i].eMail || "0";
        let Nif = res.data.value[i].vatRegistrationNo || "0";
        let IdExterna = res.data.value[i].loyaltyNo || "0";
        let sqlSincroIds = `SELECT * FROM BC_SincroIds WHERE IdBc = '${res.data.value[i].number}'`;
        let querySincro = await this.sql.runSql(sqlSincroIds, database)
        if (querySincro.recordset.length == 0) {
          // Insert clients
          let sqlInsert = `INSERT INTO clientsFinals 
          (Id, Nom, Telefon, Adreca, emili, Nif, IdExterna) VALUES
          ('${Id}', '${Nom}', '${Telefon}', '${Adreca}', '${emili}', '${Nif}', '${IdExterna}')`
          //console.log(sqlInsert)

          let TipoDato = "clientFinal"
          let IdBc = res.data.value[i].number || "";
          let IdHit = Id;
          let IdEmpresaBc = companyID;
          let IdEmpresaHit = database;
          sqlSincroIds = `INSERT INTO BC_SincroIds 
          (TmSt, TipoDato, IdBc, IdHit, IdEmpresaBc, IdEmpresaHit) VALUES
          (GETDATE(), '${TipoDato}', '${IdBc}', '${IdHit}', '${IdEmpresaBc}', '${IdEmpresaHit}')`


          try {
            let sqlCheck = `SELECT * FROM clientsFinals WHERE emili = '${emili}'`
            let queryCheck = await this.sql.runSql(sqlCheck, database)
            let sqlInserted = false;
            if (queryCheck.recordset.length == 0 && !sqlInserted) {
              let queryInsert = await this.sql.runSql(sqlInsert, database);
              let queryInsertSincro = await this.sql.runSql(sqlSincroIds, database);

              const data = { processedHIT: true };
              let url2 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/contacts(${res.data.value[i].id})`;

              const patchResponse = await axios.patch(url2, data, {
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "application/json",
                  "If-Match": "*",
                },
              });
              sqlInserted = true;
            }

            sqlCheck = `SELECT * FROM clientsFinals WHERE IdExterna = '${IdExterna}'`;
            queryCheck = await this.sql.runSql(sqlCheck, database);
            if (queryCheck.recordset.length == 0 && !sqlInserted) {
              let queryInsert = await this.sql.runSql(sqlInsert, database);
              let queryInsertSincro = await this.sql.runSql(sqlSincroIds, database);

              const data = { processedHIT: true };
              let url2 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/contacts(${res.data.value[i].id})`;

              const patchResponse = await axios.patch(url2, data, {
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "application/json",
                  "If-Match": "*",
                },
              });
              sqlInserted = true;
            }

            sqlCheck = `SELECT * FROM clientsFinals WHERE Telefon = '${Telefon}'`;
            queryCheck = await this.sql.runSql(sqlCheck, database);
            if (queryCheck.recordset.length == 0 && !sqlInserted) {
              let queryInsert = await this.sql.runSql(sqlInsert, database);
              let queryInsertSincro = await this.sql.runSql(sqlSincroIds, database);

              const data = { processedHIT: true };
              let url2 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/contacts(${res.data.value[i].id})`;

              const patchResponse = await axios.patch(url2, data, {
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "application/json",
                  "If-Match": "*",
                },
              });
              sqlInserted = true;
            }

            sqlCheck = `SELECT * FROM clientsFinals WHERE Telefon = '${Telefon}' AND emili = '${emili}' AND IdExterna = '${IdExterna}'`;
            queryCheck = await this.sql.runSql(sqlCheck, database);
            if (queryCheck.recordset.length == 0 && !sqlInserted) {
              let queryInsert = await this.sql.runSql(sqlInsert, database);
              let queryInsertSincro = await this.sql.runSql(sqlSincroIds, database);

              const data = { processedHIT: true };
              let url2 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/contacts(${res.data.value[i].id})`;

              const patchResponse = await axios.patch(url2, data, {
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "application/json",
                  "If-Match": "*",
                },
              });
            } else {
              sqlCheck = `SELECT * FROM clientsFinals WHERE Id = '${Id}'`;
              queryCheck = await this.sql.runSql(sqlCheck, database);
              if (queryCheck.recordset.length == 0 && !sqlInserted) {
                let queryInsert = await this.sql.runSql(sqlInsert, database);
                let queryInsertSincro = await this.sql.runSql(sqlSincroIds, database);

                const data = { processedHIT: true };
                let url2 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/contacts(${res.data.value[i].id})`;

                const patchResponse = await axios.patch(url2, data, {
                  headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                    "If-Match": "*",
                  },
                });
              } else if(!sqlInserted) {
                console.log("El cliente ya existe en la base de datos");
                let sqlUpdate = `UPDATE clientsFinals SET 
                Nom = '${Nom}', 
                Telefon = '${Telefon}', 
                Adreca = '${Adreca}', 
                emili = '${emili}', 
                Nif = '${Nif}'
                WHERE Id = '${Id}';`;
                console.log(`SQL: ${sqlUpdate}`)
                try {
                  let queryInsert = await this.sql.runSql(sqlUpdate, database)
                  let queryInsertSincro = await this.sql.runSql(sqlSincroIds, database);
                  //console.log("Cliente en la base de datos actualizado")
                  const data = {
                    processedHIT: true
                  };
                  let url2 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/contacts(${res.data.value[i].id})`
                  const patchResponse = await axios.patch(url2, data, {
                    headers: {
                      Authorization: `Bearer ${token}`,
                      "Content-Type": "application/json",
                      "If-Match": "*",
                    },
                  });
                } catch (error) {
                  throw new Error('Failed to put contact');
                }
                console.log("Contact actualizado")
              }
            }
          } catch (error) {
            throw new Error(`Failed to put contact. COMPANY: ${companyID}`);
          }
          console.log("Contact procesado")
        }
        else {
          let sqlUpdate = ` UPDATE clientsFinals SET 
            Nom = '${Nom}', 
            Telefon = '${Telefon}', 
            Adreca = '${Adreca}', 
            emili = '${emili}', 
            Nif = '${Nif}',
            IdExterna = '${IdExterna}'
            WHERE Id = '${Id}'; `;
          try {
            let queryInsert = await this.sql.runSql(sqlUpdate, database)
            const data = {
              processedHIT: true
            };
            let url2 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/contacts(${res.data.value[i].id})`
            const patchResponse = await axios.patch(url2, data, {
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                "If-Match": "*",
              },
            });
          } catch (error) {
            throw new Error('Failed to put contact');
          }
          console.log("Contact actualizado")
        }

      }
      console.log(`Synchronizing contacts... -> ${i}/${res.data.value.length} --- ${((i / res.data.value.length) * 100).toFixed(2)}%`);
    }
    return true
  }
}