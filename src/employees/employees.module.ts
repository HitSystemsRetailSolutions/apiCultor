import { Module } from '@nestjs/common';
import { employeesController } from './employees.controller';
import { employeesService } from './employees.service';
import { ConnectionModule } from 'src/connection/connection.module';

@Module({
    imports: [ConnectionModule],
    controllers: [employeesController],
    providers: [employeesService],
    exports: [employeesService],
})
export class EmployeesModule { }
