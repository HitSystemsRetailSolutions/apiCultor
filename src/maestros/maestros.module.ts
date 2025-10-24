import { Module } from '@nestjs/common';
import { ItemsModule } from './items/items.module';
import { LocationsModule } from './locations/locations.module';
import { CustomersModule } from './customers/customer.module';
import { ItemCategoriesModule } from './itemCategories/itemCategories.module';

@Module({
    imports: [ItemsModule, LocationsModule, CustomersModule, ItemCategoriesModule],
    exports: [ItemsModule, LocationsModule, CustomersModule, ItemCategoriesModule],
})
export class MaestrosModule { }