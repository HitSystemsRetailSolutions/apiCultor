import { Module } from '@nestjs/common';
import { customersController } from './customers.controller';
import { customersService } from './customers.service';
import { ConnectionModule } from 'src/connection/connection.module';
import { HelpersModule } from 'src/helpers/helpers.module';

@Module({
    imports: [ConnectionModule, HelpersModule],
    controllers: [customersController],
    providers: [customersService],
    exports: [customersService],
})
export class CustomersModule { }
