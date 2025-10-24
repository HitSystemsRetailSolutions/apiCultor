import { Module } from '@nestjs/common';
import { locationsController } from './locations.controller';
import { locationsService } from './locations.service';
import { ConnectionModule } from 'src/connection/connection.module';

@Module({
    imports: [ConnectionModule],
    controllers: [locationsController],
    providers: [locationsService],
    exports: [locationsService],
})
export class LocationsModule { }
