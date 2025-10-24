import { Module } from '@nestjs/common';
import { runSqlService } from 'src/connection/sqlConnection.service';
import { getTokenService } from './getToken.service';
import { getAzureSASTokenService } from './azureSASToken.service';

@Module({
    providers: [runSqlService, getTokenService, getAzureSASTokenService],
    exports: [runSqlService, getTokenService, getAzureSASTokenService],
})
export class ConnectionModule { }
