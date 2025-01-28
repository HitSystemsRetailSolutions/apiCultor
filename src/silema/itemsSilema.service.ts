import { Injectable } from '@nestjs/common';
import { getTokenService } from '../conection/getToken.service';
import { runSqlService } from 'src/conection/sqlConection.service';
import axios from 'axios';

@Injectable()
export class itemsSilemaService {
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

  async syncItemsSilema(companyID, database, client_id: string, client_secret: string, tenant: string, entorno: string) {
    let token = await this.token.getToken2(client_id, client_secret, tenant);
    let url1 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/items?$filter=processHit eq true`;
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
        throw new Error('Failed to obtain items');
      });
    for (let i = 0; i < res.data.value.length; i++) {
      //console.log(`Iteracion numero ${i}`)
      if (!res.data.value[i].processedHIT && res.data.value[i].processHIT && res.data.value[i].familyDimValue !== "" && res.data.value[i].subfamilyDimValue !== "" && res.data.value[i].level3DimValue !== "") {
        let sqlIva = `select * from tipusIva where Iva = ${res.data.value[i].vatPercent}`
        let queryIva = await this.sql.runSql(sqlIva, database)
        let Codi = res.data.value[i].number ?? 0;
        let NOM = res.data.value[i].displayName ?? 'Nombre de ejemplo'
        let PREU = res.data.value[i].unitPrice ?? 0;
        let PreuMajor = res.data.value[i].unitPriceExcludeVAT ?? 0;
        let Desconte = 1
        let EsSumable = 1
        if (res.data.value[i].baseUnitOfMeasureCode == 'KG') EsSumable = 0
        let Familia = res.data.value[i].level3DimValue;
        let CodiGenetic = Codi;
        let TipoIva = queryIva.recordset[0].Tipus ?? 6
        let NoDescontesEspecials = 0; // ?? Producte acabat o no
        //console.log("Hay que procesar este producto en HIT")
        // Familia N1
        let sqlFamilia = `SELECT * FROM [families] WHERE Nom = '${res.data.value[i].familyDimValue}'`;
        let queryFamilia = await this.sql.runSql(sqlFamilia, database)
        if (queryFamilia.recordset.length == 0) {
          let sqlInsert = `INSERT INTO families (Nom, Pare, Nivell) VALUES ('${res.data.value[i].familyDimValue}', 'Article', 1);`;
          let recordsInsert = await this.sql.runSql(sqlInsert, database);
        }
        // Familia N2
        sqlFamilia = `SELECT * FROM [families] WHERE Nom = '${res.data.value[i].subfamilyDimValue}'`;
        queryFamilia = await this.sql.runSql(sqlFamilia, database)
        if (queryFamilia.recordset.length == 0) {
          let sqlInsert = `INSERT INTO families (Nom, Pare, Nivell) VALUES ('${res.data.value[i].subfamilyDimValue}', '${res.data.value[i].familyDimValue}', 2);`;
          let recordsInsert = await this.sql.runSql(sqlInsert, database);
        }
        // Familia N3
        sqlFamilia = `SELECT * FROM [families] WHERE Nom = '${res.data.value[i].level3DimValue}'`;
        queryFamilia = await this.sql.runSql(sqlFamilia, database)
        if (queryFamilia.recordset.length == 0) {
          let sqlInsert = `INSERT INTO families (Nom, Pare, Nivell) VALUES ('${res.data.value[i].level3DimValue}', '${res.data.value[i].subfamilyDimValue}', 3);`;
          let recordsInsert = await this.sql.runSql(sqlInsert, database);
        }

        let sqlSincroIds = `SELECT * FROM BC_SincroIds WHERE IdBc = '${res.data.value[i].number}'`;
        let querySincro = await this.sql.runSql(sqlSincroIds, database)
        if (querySincro.recordset.length == 0) {
          // Insert producte
          let sqlInsert = `INSERT INTO articles (Codi, NOM, PREU, PreuMajor, Desconte, EsSumable, Familia, CodiGenetic, TipoIva, NoDescontesEspecials) VALUES
          (${Codi}, '${NOM}', ${PREU}, ${PreuMajor}, ${Desconte}, ${EsSumable}, '${Familia}', ${CodiGenetic}, ${TipoIva}, ${NoDescontesEspecials})`
          //console.log(sql)
          let TipoDato = "item"
          let IdBc = res.data.value[i].number || "";
          let IdHit = Codi;
          let IdEmpresaBc = companyID;
          let IdEmpresaHit = database;
          sqlSincroIds = `INSERT INTO BC_SincroIds (TmSt, TipoDato, IdBc, IdHit, IdEmpresaBc, IdEmpresaHit) VALUES
          (GETDATE(), '${TipoDato}', '${IdBc}', '${IdHit}', '${IdEmpresaBc}', '${IdEmpresaHit}')`
          try {
            let queryInsert = await this.sql.runSql(sqlInsert, database)
            let queryInsertSincro = await this.sql.runSql(sqlSincroIds, database)
            const data = {
              processedHIT: true
            };
            let url2 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/items(${res.data.value[i].id})`
            const patchResponse = await axios.patch(url2, data, {
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                "If-Match": "*",
              },
            });
          } catch (error) {
            throw new Error('Failed to put item');
          }
          console.log("Item procesado")
        }
        else {
          let sqlUpdate = ` UPDATE articles SET 
          NOM = '${NOM}', 
          PREU = ${PREU}, 
          PreuMajor = ${PreuMajor}, 
          Desconte = ${Desconte}, 
          EsSumable = ${EsSumable}, 
          Familia = '${Familia}', 
          CodiGenetic = ${CodiGenetic}, 
          TipoIva = ${TipoIva}, 
          NoDescontesEspecials = ${NoDescontesEspecials} 
          WHERE Codi = ${Codi}; `;
          try {
            let queryUpdate = await this.sql.runSql(sqlUpdate, database)
            const data = {
              processedHIT: true
            };
            let url2 = `${process.env.baseURL}/v2.0/${tenant}/${entorno}/api/abast/hitIntegration/v2.0/companies(${companyID})/items(${res.data.value[i].id})`
            const patchResponse = await axios.patch(url2, data, {
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                "If-Match": "*",
              },
            });
          } catch (error) {
            throw new Error('Failed to put item');
          }
          console.log("Item actualizado")
        }
      }
      console.log(`Synchronizing items... -> ${i}/${res.data.value.length} --- ${((i / res.data.value.length) * 100).toFixed(2)}%`);
    }
    return true;
  }
}