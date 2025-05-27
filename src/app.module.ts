import { Module } from '@nestjs/common';
import { employeesController } from './employees/employees.controller';
import { employeesService } from './employees/employees.service';
import { getTokenService } from './connection/getToken.service';
import { ConfigModule } from '@nestjs/config';
import { runSqlService } from './connection/sqlConection.service';
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
import { companiesController } from './companies/companies.controller';
import { companiesService } from './companies/companies.service';
import { PdfController } from './pdf/pdf.controller';
import { PdfService } from './pdf/pdf.service';
// import { IncidenciaController } from './incidencias/incidencia.controller';
// import { IncidenciaService } from './incidencias/incidencia.service';
// import { archivosController } from './archivos/archivos.controller';
// import { archivosService } from './archivos/archivos.service';
import { empresasController } from './empresas/empresas.controller';
import { empresasService } from './empresas/empresas.service';
// import { traspasosController } from './traspasos/traspasos.controller';
// import { traspasosService } from './traspasos/traspasos.service';
import { initConfigService } from './configuracionInicial/initConfig.service';
import { initConfigController } from './configuracionInicial/initConfig.controller';
import { salesSilemaController } from './silema/salesSilema.controller';
import { salesSilemaService } from './silema/salesSilema.service';
import { itemsSilemaController } from './silema/itemsSilema.controller';
import { itemsSilemaService } from './silema/itemsSilema.service';
import { contactsSilemaController } from './silema/contactsSilema.controller';
import { contactsSilemaService } from './silema/contactsSilema.service';
import { customersSilemaController } from './silema/customersSilema.controller';
import { customersSilemaService } from './silema/customersSilema.service';
import { vendorsSilemaController } from './silema/vendorsSilema.controller';
import { vendorsSilemaService } from './silema/vendorsSilema.service';
import { locationSilemaController } from './silema/locationSilema.controller';
import { locationSilemaService } from './silema/locationSilema.service';
import { locationsController } from './locations/locations.controller';
import { locationsService } from './locations/locations.service';
import { trabajadoresController } from './trabajadores/trabajadores.controller';
import { trabajadoresService } from './trabajadores/trabajadores.service';
import { salesSilemaRecapManualService } from './silema/salesSilemaRecapManual.service';  
import { salesSilemaRecapManualController } from './silema/salesSilemaRecapManual.controller';
import { salesSilemaRecapController } from './silema/salesSilemaRecap.controller';    
import { salesSilemaRecapService } from './silema/salesSilemaRecap.service';
import { salesSilemaCierreController } from './silema/salesSilemaCierre.controller';
import { salesSilemaCierreService } from './silema/salesSilemaCierre.service';
import { salesSilemaAbonoController } from './silema/salesSilemaAbono.controller';
import { salesSilemaAbonoService } from './silema/salesSilemaAbono.service';
import { intercompanySilemaService} from './silema/intercompanySilema.service';
import { intercompanySilemaController} from './silema/intercompanySilema.controller';


@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [
    employeesController,
    signingsController,
    customersController,
    itemsController,
    itemCategoriesController,
    salesTicketsController,
    salesFacturasController,
    companiesController,
    PdfController,
    // IncidenciaController,
    // archivosController,
    empresasController,
    // traspasosController,
    initConfigController,
    salesSilemaController,
    itemsSilemaController,
    contactsSilemaController,
    customersSilemaController,
    vendorsSilemaController,
    locationSilemaController,
    initConfigController,
    locationsController,
    trabajadoresController,
    salesSilemaRecapManualController,
    salesSilemaRecapController,
    salesSilemaCierreController,
    salesSilemaAbonoController,
    intercompanySilemaController,
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
    salesFacturasService,
    companiesService,
    PdfService,
    // IncidenciaService,
    // archivosService,
    empresasService,
    // traspasosService,
    initConfigService,
    salesSilemaService,
    itemsSilemaService,
    contactsSilemaService,
    customersSilemaService,
    vendorsSilemaService,
    locationSilemaService,
    initConfigService,
    locationsService,
    trabajadoresService,
    salesSilemaRecapManualService,
    salesSilemaRecapService,
    salesSilemaCierreService,
    salesSilemaAbonoService,
    intercompanySilemaService,
  ],
})
export class AppModule {}
