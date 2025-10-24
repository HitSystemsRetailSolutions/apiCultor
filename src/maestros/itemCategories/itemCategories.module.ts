import { Module } from '@nestjs/common';
import { itemCategoriesController } from './itemCategories.controller';
import { itemCategoriesService } from './itemCategories.service';
import { ConnectionModule } from 'src/connection/connection.module';

@Module({
    imports: [ConnectionModule],
    controllers: [itemCategoriesController],
    providers: [itemCategoriesService],
})
export class ItemCategoriesModule { }
