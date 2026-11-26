import type { Response } from 'express';

import { ApplicationsRealtimeService } from './applications-realtime.service';

function createMockResponse() {
  const headers: Record<string, string> = {};
  const chunks: string[] = [];
  const res: {
    writableEnded: boolean;
    status: jest.Mock;
    setHeader: jest.Mock;
    flushHeaders: jest.Mock;
    write: jest.Mock;
    end: jest.Mock;
  } = {
    writableEnded: false,
    status: jest.fn(),
    setHeader: jest.fn((key: string, value: string) => {
      headers[key] = value;
      return res;
    }),
    flushHeaders: jest.fn(),
    write: jest.fn((chunk: string) => {
      chunks.push(chunk);
      return true;
    }),
    end: jest.fn(() => {
      res.writableEnded = true;
    }),
  };
  res.status.mockReturnValue(res);
  return { res: res as unknown as Response, headers, chunks };
}

describe('ApplicationsRealtimeService', () => {
  let service: ApplicationsRealtimeService;

  beforeEach(() => {
    jest.useFakeTimers();
    service = new ApplicationsRealtimeService();
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('sets SSE headers, deduplicates online user presence by authId, and updates on disconnect', () => {
    const c1 = createMockResponse();
    const c2 = createMockResponse();
    const c3 = createMockResponse();

    const off1 = service.registerClient(c1.res, 'user-a', null);
    expect(c1.headers['Content-Type']).toContain('text/event-stream');
    expect(c1.headers['X-Accel-Buffering']).toBe('no');
    expect(service.getOnlineUserCount()).toBe(1);

    // Same user opens a second tab -> still 1 unique online user
    const off2 = service.registerClient(c2.res, 'user-a', null);
    expect(service.getOnlineUserCount()).toBe(1);

    // Second officer connects -> 2 unique online users
    const off3 = service.registerClient(c3.res, 'user-b', ['district-1']);
    expect(service.getOnlineUserCount()).toBe(2);
    expect(c1.chunks.at(-1)).toContain('"online_users":2');

    off3();
    expect(service.getOnlineUserCount()).toBe(1);
    expect(c1.chunks.at(-1)).toContain('"online_users":1');

    off1();
    off2();
    expect(service.getOnlineUserCount()).toBe(0);
  });

  it('broadcasts row color updates to global clients and filters strictly by district for district officers', () => {
    const globalClient = createMockResponse();
    const districtClient = createMockResponse();

    const offGlobal = service.registerClient(globalClient.res, 'admin-1', null);
    const offDistrict = service.registerClient(districtClient.res, 'officer-1', ['dist-1']);

    globalClient.chunks.length = 0;
    districtClient.chunks.length = 0;

    service.broadcastRowColorUpdate({
      type: 'row_color_updated',
      items: [
        {
          id: 'app-1',
          district_id: 'dist-1',
          row_color: 'yellow',
          row_color_by: 'Aliyev S.',
          row_color_updated_at: '2026-11-26T07:00:00.000Z',
        },
        {
          id: 'app-2',
          district_id: 'dist-2',
          row_color: 'red',
          row_color_by: 'Aliyev S.',
          row_color_updated_at: '2026-11-26T07:00:00.000Z',
        },
      ],
      actor_auth_id: 'admin-1',
      actor_name: 'Aliyev S.',
    });

    expect(globalClient.chunks).toHaveLength(1);
    expect(globalClient.chunks[0]).toContain('event: row_color_updated');
    expect(globalClient.chunks[0]).toContain('"app-1"');
    expect(globalClient.chunks[0]).toContain('"app-2"');
    expect(globalClient.chunks[0]).not.toContain('district_id');

    expect(districtClient.chunks).toHaveLength(1);
    expect(districtClient.chunks[0]).toContain('"app-1"');
    expect(districtClient.chunks[0]).not.toContain('"app-2"');

    offGlobal();
    offDistrict();
  });

  it('sends periodic ping comments to keep SSE connections alive through Nginx', () => {
    const client = createMockResponse();
    const off = service.registerClient(client.res, 'user-a', null);
    client.chunks.length = 0;

    jest.advanceTimersByTime(25000);
    expect(client.chunks.some((c) => c.startsWith(': ping '))).toBe(true);

    off();
  });
});
