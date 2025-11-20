import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { IProcessorService, VolumeAndCount} from './iprocessor.service';
import { AxiosError } from 'axios';

interface IrisRawBatch {
  transactions: {
    date: string;
    amount: string;
    type: string;
  }[];
}

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
            if (!apiKey || !baseUrl) throw new NotFoundException('Argyle configuration incomplete.');
            return { apiKey, baseUrl };
          }
          if (name.includes('merchant lynx')) {
            const apiKey = this.configService.get<string>('MERCHANT_LYNX_API_TOKEN');
            const baseUrl = this.configService.get<string>('MERCHANT_LYNX_BASE_URL');
            if (!apiKey || !baseUrl) throw new NotFoundException('Merchant Lynx configuration incomplete.');
            return { apiKey, baseUrl };
          }
          throw new NotFoundException(`Configuration not found for IRIS CRM processor: ${processorName}`);
        }

  async calculateVolumeAndCount(
    merchantId: string,
    processorName: string,
     dateScope: { from: string; to: string },
  ): Promise<VolumeAndCount> {
    const { apiKey, baseUrl } = this.getIrisConfig(processorName);
    this.logger.log(`Calculating IRIS CRM volume for merchant ${merchantId} since ${dateScope.from || 'the beginning'}`);
    
    // let totalSales = 0;
    // let totalRefunds = 0;
    let totalNetVolume = 0;
    let totalTransactionCount = 0;
    
    // const startDate = dateScope.from ? new Date(dateScope.from) : null;
    const startDate = new Date(dateScope.from);
    startDate.setHours(0, 0, 0, 0);
    // this.logger.warn(`[DEBUG] Merchant: ${merchantId}`);
    // this.logger.warn(`[DEBUG] Target Start Date (Input): ${dateScope.from}`);
    // this.logger.warn(`[DEBUG] Target Start Date (Parsed): ${startDate.toString()} | ISO: ${startDate.toISOString()}`);

    let page = 1;
    let hasMorePages = true;

    //  let debugLogCount = 0;

    // let loggedOneTransaction = false; 

    while (hasMorePages) {
      // FIX: Using start_date and end_date query parameters as requested
      const url = `${baseUrl}/merchants/${merchantId}/transactions`;
      const params = {
        page,
        per_page: 100,
        start_date: dateScope.from, // Format: YYYY-MM-DD
        end_date: dateScope.to,     // Format: YYYY-MM-DD
      };

      try {
        const response = await firstValueFrom(
          this.httpService.get<{ data: IrisRawBatch[] }>(url, { 
            headers: { 'X-API-KEY': apiKey },
            params: params 
          }),
        );

        const batches = response.data.data;
        if (!batches || batches.length === 0) {
          hasMorePages = false;
          continue;
        }

        // if (!loggedOneTransaction) {
        //       this.logger.debug(`[IrisCrmService] Inspecting first RAW BATCH for merchant ${merchantId}:`);
        //       // Log just the first item in the array to keep it readable
        //       this.logger.debug(JSON.stringify(batches[0], null, 2));
        //       loggedOneTransaction = true;
        //     }

        for (const batch of batches) {
          if (batch.transactions) {
            for (const trx of batch.transactions) {
              totalTransactionCount++;
              const amount = parseFloat(trx.amount);
              const type = trx.type ? trx.type.toString().toUpperCase() : '';

              if (type === '0101' || type === '0106') {
                totalNetVolume += amount;
              } else if (type === 'SALE') {
                 totalNetVolume += amount;
              } else if (type === 'REFUND' || type === 'RETURN' || type === 'VOID') {
                 totalNetVolume -= Math.abs(amount);
              } else if (amount < 0) {
                 totalNetVolume += amount;
              }
            }
          }
        }
        page++;
      } catch (error) {
        const axiosError = error as AxiosError;
        this.logger.error(`Failed to fetch IRIS CRM transactions for ${merchantId}`, axiosError.response?.data);
        hasMorePages = false;
        throw error;
      }
    }
    
    return {
      netVolume: parseFloat(totalNetVolume.toFixed(2)),
      transactionCount: totalTransactionCount,
    };
  }
}