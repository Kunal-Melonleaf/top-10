import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { IProcessorService, VolumeAndCount, IrisRawBatch } from './iprocessor.service';
import { AxiosError } from 'axios';

@Injectable()
export class IrisCrmService implements IProcessorService {
  private readonly logger = new Logger(IrisCrmService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  private getIrisConfig(processorName: string): { apiKey: string; baseUrl: string } {
    const name = processorName.toLowerCase();
      if (name.includes('argyle')) {
        const apiKey = this.configService.get<string>('ARGYLE_API_TOKEN');
        const baseUrl = this.configService.get<string>('ARGYLE_BASE_URL');
        if (!apiKey || !baseUrl) throw new NotFoundException('Argyle configuration is incomplete.');
        return { apiKey, baseUrl };
    }
     if (name.includes('merchant lynx')) {
        const apiKey = this.configService.get<string>('MERCHANT_LYNX_API_TOKEN');
        const baseUrl = this.configService.get<string>('MERCHANT_LYNX_BASE_URL');
        if (!apiKey || !baseUrl) throw new NotFoundException('Argyle configuration is incomplete.');
        return { apiKey, baseUrl };
    }
    throw new NotFoundException(`Configuration not found for IRIS CRM processor: ${processorName}`);
  }

  async calculateVolumeAndCount(
    merchantId: string,
    processorName: string,
    dateScope: { from: string | null },
  ): Promise<VolumeAndCount> {
    const { apiKey, baseUrl } = this.getIrisConfig(processorName);
    this.logger.log(`Calculating IRIS CRM volume for merchant ${merchantId} since ${dateScope.from || 'the beginning'}`);
    
    let totalSales = 0;
    let totalRefunds = 0;
    let totalTransactionCount = 0;
    
    const startDate = dateScope.from ? new Date(dateScope.from) : null;
    
    let page = 1;
    let hasMorePages = true;
    let stopFetching = false;

    while (hasMorePages && !stopFetching) {
      const url = `${baseUrl}/merchants/${merchantId}/transactions?page=${page}&per_page=100`;
      
      try {
        const response = await firstValueFrom(
          this.httpService.get<{ data: IrisRawBatch[] }>(url, {
            headers: { 'X-API-KEY': apiKey },
          }),
        );

        const batches = response.data.data;
        if (!batches || batches.length === 0) {
          hasMorePages = false;
          continue;
        }

        for (const batch of batches) {
          if (batch.transactions) {
            for (const trx of batch.transactions) {
              const trxDate = new Date(trx.date);
              if (startDate && trxDate < startDate) {
                stopFetching = true;
                break;
              }

              totalTransactionCount++;
              const amount = parseFloat(trx.amount);
              
              if (trx.type === 'Sale') {
                totalSales += amount;
              } else if (trx.type === 'Refund' || trx.type === 'Return') {
                totalRefunds += amount;
              }
            }
          }
          if (stopFetching) break;
        }
        page++;
      } catch (error) {
        const axiosError = error as AxiosError;
        this.logger.error(`Failed to fetch IRIS CRM transactions for merchant ${merchantId} on page ${page}`, axiosError.response?.data);
        hasMorePages = false;
        throw error;
      }
    }
    
    return {
      netVolume: totalSales - totalRefunds,
      transactionCount: totalTransactionCount,
    };
  }
}
