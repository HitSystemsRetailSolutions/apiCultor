import { Module } from '@nestjs/common';
import { employeesController } from './employees/employees.controller';
import { employeesService } from './employees/employees.service';
import { getTokenService } from './conection/getToken.service';
import { ConfigModule } from '@nestjs/config';
import { runSqlService } from './conection/sqlConection.service';
import { signingsController } from './signings/signings.controller';
import { signingsService } from './signings/signings.service';
import { customersController } from './customers/customers.controller';
import { customersService } from './customers/customers.service';


@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [employeesController, signingsController, customersController],
  providers: [
    employeesService,
    getTokenService,
    runSqlService,
    signingsService,
    customersService,
  ],
})
export class AppModule {}
