import { Injectable } from '@nestjs/common';
import { getTokenService } from '../conection/getToken.service';
import { runSqlService } from 'src/conection/sqlConection.service';
import axios from 'axios';
import { response } from 'express';

@Injectable()
export class companiesService {
  constructor(
    private token: getTokenService,
    private sql: runSqlService,
  ) {}

//Obtener Id de Company
  async getCompaniesId() {
    console.log("----------------getCompaniesId--------------");
    let token = await this.token.getToken();
    let res = await axios.get(
      `${process.env.baseURL}/v2.0/${process.env.tenant}/${process.env.entorno}/api/v2.0/companies`,
      {
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      },
    );

    if (!res.data) throw new Error('Failed to obtain access token');
    let companies = res.data.value;
    if (companies.length === 0) 
    {
        console.log('NO HAY COMPANIES');
    }
    else
    {
      for (let i=0;i<companies.length;i++)
      {
        //console.log(companies[i]);
        let res = await this.sql.runSql(
            `select * from BC_PARAMS where BC_CompanyID = '${companies[i].id}'`,
            "Hit",
          );
        if (res.recordset.length === 0) {
            let newId = await this.sql.runSql(
                `insert into BC_PARAMS (BC_CompanyNAME , BC_CompanyID) values ('${companies[i].name}', '${companies[i].id}')`,
                "Hit",
              );
        }

      }
    }
    return true;
  }
}