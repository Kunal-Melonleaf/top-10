import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, FlowProducer } from 'bullmq';
import { Logger, Inject } from '@nestjs/common';
import { SalesForceService } from '../../salesforce/salesforce.service';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.provider';
import { ConfigService } from '@nestjs/config';

interface UserJobData { userId: string; portalId: string; }

@Processor('user-analytics')
export class UserAnalyticsProcessor extends WorkerHost {
  private readonly logger = new Logger(UserAnalyticsProcessor.name);
  private readonly flowProducer: FlowProducer;

  constructor(
    private readonly salesforceService: SalesForceService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly configService: ConfigService,
  ) {
    super(); 
    
    this.flowProducer = new FlowProducer({ 
      connection: {
        host: this.configService.get('REDIS_HOST', 'localhost'),
        port: parseInt(this.configService.get('REDIS_PORT', '6379')),
      },
      prefix: 'bull', 
    });
  }

   async process(job: Job<UserJobData>): Promise<any> {
    const { userId, portalId } = job.data;
    const lockKey = `analytics-status:${userId}`;
    await this.redis.set(lockKey, 'processing');
    this.logger.log(`Starting analytics for User ID: ${userId}`);

    try {
      const merchants = await this.salesforceService.getMerchantsForUser(portalId);
      if (merchants && merchants.length > 0) {
          this.logger.warn(`[DEBUG] Inspecting first merchant object from Salesforce:`);
          this.logger.warn(JSON.stringify(merchants[0], null, 2));
      }
      this.logger.debug(`Raw merchants response from Salesforce for user ${userId}:`);
      this.logger.debug(JSON.stringify(merchants, null, 2));
      if (!merchants || merchants.length === 0) {
        this.logger.warn(`No merchants found for User ID: ${userId}. Job complete.`);
        await this.redis.set(lockKey, 'completed');
        return;
      }
      this.logger.log(`Found ${merchants.length} merchants for User ID: ${userId}. Creating child jobs.`);
      const merchantNameMap: Record<string, string> = {};
      merchants.forEach(m => {
         if (!m.name) {
             this.logger.error(`[DEBUG] Merchant ${m.MerchantID} has undefined Name! Keys available: ${Object.keys(m).join(', ')}`);
        }
        merchantNameMap[m.MerchantID] = m.name || 'Unknown Merchant';
      });
      const childJobs = merchants.map(merchant => ({
        name: 'process-merchant',
        queueName: 'merchant-analytics',
        data: {
          merchantId:  merchant.MerchantID,
          processorName: merchant.ProcessorName,
        },
        opts: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 30000 },
             failParentOnFailure: false, // Polite retry: 30s, 60s, 120s
        }
      }));

       const flow = await this.flowProducer.add({
        name: `user-flow-${userId}`,
        queueName: 'finalization',
        data: {
          userId,
          portalId,
          merchantIds: merchants.map(m => m.MerchantID),
          merchantNameMap,
        },
        children: childJobs,
      });

      this.logger.warn(`[UserAnalyticsProcessor] 📢 FLOW CREATED. Parent Job ID: ${flow.job.id}`);
      this.logger.warn(`[UserAnalyticsProcessor] 📢 Monitor this ID using the debug endpoint.`);
    } catch (error) {
      this.logger.error(`Failed to process user job for User ID: ${userId}`, error);
      await this.redis.set(lockKey, 'failed');
      throw error;
    }
  }
}