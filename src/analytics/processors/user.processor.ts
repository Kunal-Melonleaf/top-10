import { Processor, Process } from '@nestjs/bull';
import { Job, FlowProducer } from 'bullmq';
import { Logger, Inject } from '@nestjs/common';
import { SalesForceService } from '../../salesforce/salesforce.service';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.provider';

interface UserJobData { userId: string; portalId: string; }

@Processor('user-analytics')
export class UserAnalyticsProcessor {
  private readonly logger = new Logger(UserAnalyticsProcessor.name);
  private readonly flowProducer: FlowProducer;

  constructor(
    private readonly salesforceService: SalesForceService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.flowProducer = new FlowProducer({ connection: redis });
  }

  @Process('process-user')
  async processUserJob(job: Job<UserJobData>) {
    const { userId, portalId } = job.data;
    const lockKey = `analytics-status:${userId}`;
    await this.redis.set(lockKey, 'processing');
    this.logger.log(`Starting analytics for User ID: ${userId}`);

    try {
      const merchants = await this.salesforceService.getMerchantsForUser(portalId);
      if (!merchants || merchants.length === 0) {
        this.logger.warn(`No merchants found for User ID: ${userId}. Job complete.`);
        await this.redis.set(lockKey, 'completed');
        return;
      }
      this.logger.log(`Found ${merchants.length} merchants for User ID: ${userId}. Creating child jobs.`);

      const childJobs = merchants.map(merchant => ({
        name: 'process-merchant',
        queueName: 'merchant-analytics',
        data: {
          merchantId: merchant.MerchantID__c,
          processorName: merchant.ProcessorName__c,
        },
        opts: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 30000 }, // Polite retry: 30s, 60s, 120s
        }
      }));

      await this.flowProducer.add({
        name: `user-flow-${userId}`,
        queueName: 'finalization',
        data: {
          userId,
          merchantIds: merchants.map(m => m.MerchantID__c),
        },
        children: childJobs,
      });
    } catch (error) {
      this.logger.error(`Failed to process user job for User ID: ${userId}`, error);
      await this.redis.set(lockKey, 'failed');
      throw error;
    }
  }
}