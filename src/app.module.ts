import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { AnalyticsModule } from './analytics/analytics.module';
import { RedisModule } from './redis/redis.module';
import { SalesforceModule } from './salesforce/salesforce.module';
import { ProcessorModule } from './processors/processors.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
      BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: { // <--- This property name is vital
          host: configService.get('REDIS_HOST', 'localhost'),
          port: parseInt(configService.get('REDIS_PORT', '6379'), 10),
        },
      }),
      inject: [ConfigService],
    }),
    RedisModule,
    SalesforceModule,
    ProcessorModule,
    AnalyticsModule,
  ],
})
export class AppModule {}