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
import { itemsController } from './items/items.controller';
import { itemsService } from './items/items.service';
import { itemCategoriesController } from './itemCategories/itemCategories.controller';
import { itemCategoriesService } from './itemCategories/itemCategories.service';
import { salesTicketsController } from './sales/salesTickets.controller';
import { salesTicketsService } from './sales/salesTickets.service';
import { salesFacturasController } from './sales/salesFacturas.controller';
import { salesFacturasService } from './sales/salesFacturas.service';


@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [
    employeesController, 
    signingsController, 
    customersController,
    itemsController,
    itemCategoriesController,
    salesTicketsController,
    salesFacturasController
  ],
  providers: [
    employeesService,
    getTokenService,
    runSqlService,
    signingsService,
    customersService,
    itemsService,
    itemCategoriesService,
    salesTicketsService,
    salesFacturasService
  ],
})
export class AppModule {}
