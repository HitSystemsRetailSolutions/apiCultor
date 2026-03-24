import { Module } from '@nestjs/common';
import { vendorsController } from './vendors.controller';
import { vendorsService } from './vendors.service';
import { ConnectionModule } from 'src/connection/connection.module';
import { HelpersModule } from 'src/helpers/helpers.module';

@Module({
    imports: [ConnectionModule, HelpersModule],
    controllers: [vendorsController],
    providers: [vendorsService],
    exports: [vendorsService],
})
export class VendorsModule { }
