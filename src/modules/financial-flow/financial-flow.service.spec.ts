import type { Repository } from 'typeorm';

import type { Application } from '../applications/application.entity';
import type { Bank } from '../applications/transfers/banks/bank.entity';
import type { Card } from '../applications/transfers/cards/card.entity';
import type { Transfer } from '../applications/transfers/transfer.entity';
import type { User } from '../users/user.entity';
import { FinancialFlowService } from './financial-flow.service';

describe('FinancialFlowService', () => {
  let service: FinancialFlowService;

  beforeEach(() => {
    service = new FinancialFlowService(
      {} as Repository<Card>,
      {} as Repository<Transfer>,
      {} as Repository<Application>,
      {} as Repository<Bank>,
      {} as Repository<User>,
    );
  });

  it('identifies specific 6-digit Uzcard/Humo BINs before generic 4-digit prefixes', () => {
    expect(service.identifyBank('8600 1234 5678 9012')).toBe('Milliy Bank (NBU)');
    expect(service.identifyBank('8600 4800 1111 2222')).toBe('Anorbank');
    expect(service.identifyBank('9860 6001 2222 3333')).toBe('Uzum Bank');
    expect(service.identifyBank('9860 0301 4444 5555')).toBe('Ipak Yo‘li Banki');
    expect(service.identifyBank('8600 9900 1111 2222')).toBe('Uzcard');
    expect(service.identifyBank('9860 9900 1111 2222')).toBe('Humo');
  });
});
