import { Module } from '@nestjs/common';
import { initConfigController } from './initConfig.controller';
import { initConfigService } from './initConfig.service';
import { ConnectionModule } from 'src/connection/connection.module';
import { CustomersModule } from 'src/maestros/customers/customer.module';

@Module({
    imports: [ConnectionModule, CustomersModule],
    controllers: [initConfigController],
    providers: [initConfigService],
    exports: [initConfigService],
})
export class InitConfigModule { }
