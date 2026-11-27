import type { Repository } from 'typeorm';

import { TransferDestinationType } from '../../common/enums/transfer-destination-type.enum';
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

  it('connects Card -> Crypto -> Card and Crypto -> Crypto chains via unified identifier keys', async () => {
    const cardA = { id: 'card-a', card_number: '8600120000001111', bank: null, citizen: null };
    const cardB = { id: 'card-b', card_number: '9860030000002222', bank: null, citizen: null };
    const cryptoIdentA = {
      id: 'ident-crypto-1',
      type: 'crypto_wallet',
      type_label: 'Binance (TRC-20)',
      raw_value: 'TX9aK111111111',
    };
    const cryptoIdentB = {
      id: 'ident-crypto-2',
      type: 'crypto_wallet',
      type_label: 'Bybit (TRC-20)',
      raw_value: 'TY8bM222222222',
    };

    const transfers = [
      {
        id: 'tr-1',
        amount: 12000000,
        currency: 'UZS',
        transfer_date: '2026-11-27',
        sender_card_id: 'card-a',
        sender_card: cardA,
        receiver_card_id: null,
        receiver_card: null,
        destination_type: TransferDestinationType.CRYPTO,
        receiver_identifier_id: cryptoIdentA.id,
        receiver_identifier: cryptoIdentA,
        destination_label: 'Binance (TRC-20): TX9aK111111111',
        destination_details: {
          platform: 'Binance',
          network: 'TRC-20',
          value: 'TX9aK111111111',
        },
      },
      {
        id: 'tr-2',
        amount: 950,
        currency: 'USDT',
        transfer_date: '2026-11-27',
        sender_card_id: null,
        sender_card: null,
        receiver_card_id: null,
        receiver_card: null,
        destination_type: TransferDestinationType.CRYPTO,
        receiver_identifier_id: cryptoIdentB.id,
        receiver_identifier: cryptoIdentB,
        destination_label: 'Bybit (TRC-20): TY8bM222222222',
        destination_details: {
          source_type: TransferDestinationType.CRYPTO,
          source_platform: 'Binance',
          source_network: 'TRC-20',
          source_value: 'TX9aK111111111',
          source_label: 'Binance (TRC-20): TX9aK111111111',
          source_identifier_id: cryptoIdentA.id,
          platform: 'Bybit',
          network: 'TRC-20',
          value: 'TY8bM222222222',
        },
      },
      {
        id: 'tr-3',
        amount: 11500000,
        currency: 'UZS',
        transfer_date: '2026-11-27',
        sender_card_id: null,
        sender_card: null,
        receiver_card_id: 'card-b',
        receiver_card: cardB,
        destination_type: TransferDestinationType.CARD,
        receiver_identifier_id: null,
        receiver_identifier: null,
        destination_details: {
          source_type: TransferDestinationType.CRYPTO,
          source_platform: 'Bybit',
          source_network: 'TRC-20',
          source_value: 'TY8bM222222222',
          source_label: 'Bybit (TRC-20): TY8bM222222222',
          source_identifier_id: cryptoIdentB.id,
        },
      },
    ];

    const flowService = new FinancialFlowService(
      { find: jest.fn().mockResolvedValue([cardA, cardB]) } as unknown as Repository<Card>,
      { find: jest.fn().mockResolvedValue(transfers) } as unknown as Repository<Transfer>,
      { find: jest.fn().mockResolvedValue([]) } as unknown as Repository<Application>,
      {} as Repository<Bank>,
      {} as Repository<User>,
    );

    const graph = await flowService.getNetworkGraph({});

    expect(graph.nodes).toHaveLength(4);
    expect(graph.edges).toHaveLength(3);

    const e1 = graph.edges.find((e) => e.id === 'tr-1');
    const e2 = graph.edges.find((e) => e.id === 'tr-2');
    const e3 = graph.edges.find((e) => e.id === 'tr-3');

    expect(e1).toMatchObject({ from: 'card-a', to: 'ident__ident-crypto-1', currency: 'UZS' });
    expect(e2).toMatchObject({
      from: 'ident__ident-crypto-1',
      to: 'ident__ident-crypto-2',
      currency: 'USDT',
      displayAmount: 950,
    });
    expect(e3).toMatchObject({ from: 'ident__ident-crypto-2', to: 'card-b', currency: 'UZS' });
  });
});
