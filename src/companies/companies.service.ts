import { Injectable } from '@nestjs/common';
import { getTokenService } from '../conection/getToken.service';
import axios from 'axios';
import { response } from 'express';

@Injectable()
export class companiesService {
  constructor(
    private token: getTokenService,
  ) {}

//Obtener Id de Company
  async getCompaniesId() {
    console.log("----------------getCompaniesId--------------");
    let token = await this.token.getToken();
    let res = await axios.get(
      `${process.env.baseURL}/v2.0/${process.env.tenant}/production/api/v2.0/companies`,
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
        console.log(companies[i]);
      }
    }
    return true;
  }
}