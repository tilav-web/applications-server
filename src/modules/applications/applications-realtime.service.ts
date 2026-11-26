import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Response } from 'express';

export const ALLOWED_ROW_COLORS = ['yellow', 'red', 'green', 'blue', 'purple', 'orange'] as const;

export type ApplicationRowColor = (typeof ALLOWED_ROW_COLORS)[number];

export interface RowColorBroadcastEvent {
  type: 'row_color_updated';
  items: Array<{
    id: string;
    district_id: string | null;
    row_color: ApplicationRowColor | null;
    row_color_by: string | null;
    row_color_updated_at: string | null;
  }>;
  actor_auth_id: string | null;
  actor_name: string | null;
}

interface RealtimeClient {
  id: string;
  authId: string;
  allowedDistrictIds: string[] | null;
  res: Response;
  heartbeatTimer: NodeJS.Timeout;
}

/**
 * Arizalar ro'yxati uchun real-vaqt (SSE) voqealar tarqatuvchisi.
 * Bir hodim ariza qatori rangini o'zgartirganda, barcha online hodimlarga
 * bir zumda yuboriladi (tuman xodimlariga faqat o'z tumani doirasida).
 */
@Injectable()
export class ApplicationsRealtimeService implements OnModuleDestroy {
  private readonly clients = new Map<string, RealtimeClient>();
  private clientSeq = 0;

  registerClient(res: Response, authId: string, allowedDistrictIds: string[] | null): () => void {
    const id = `rt_${++this.clientSeq}_${Date.now()}`;

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    const heartbeatTimer = setInterval(() => {
      try {
        if (!res.writableEnded) {
          res.write(`: ping ${Date.now()}\n\n`);
        }
      } catch {
        this.removeClient(id);
      }
    }, 25000);

    this.clients.set(id, {
      id,
      authId,
      allowedDistrictIds,
      res,
      heartbeatTimer,
    });

    // Ulanganda online foydalanuvchilar sonini barcha ulanganlarga yuborish
    this.broadcastPresence();

    return () => this.removeClient(id);
  }

  private removeClient(id: string): void {
    const client = this.clients.get(id);
    if (!client) return;
    clearInterval(client.heartbeatTimer);
    this.clients.delete(id);
    this.broadcastPresence();
  }

  getOnlineUserCount(): number {
    const uniqueAuthIds = new Set<string>();
    for (const c of this.clients.values()) {
      uniqueAuthIds.add(c.authId);
    }
    return uniqueAuthIds.size;
  }

  private broadcastPresence(): void {
    const payload = JSON.stringify({
      type: 'presence',
      online_users: this.getOnlineUserCount(),
    });
    for (const [id, client] of this.clients.entries()) {
      try {
        if (!client.res.writableEnded) {
          client.res.write(`event: presence\ndata: ${payload}\n\n`);
        } else {
          this.removeClient(id);
        }
      } catch {
        this.removeClient(id);
      }
    }
  }

  broadcastRowColorUpdate(event: RowColorBroadcastEvent): void {
    if (this.clients.size === 0 || event.items.length === 0) return;

    for (const [id, client] of this.clients.entries()) {
      try {
        if (client.res.writableEnded) {
          this.removeClient(id);
          continue;
        }

        // Tuman xodimi bo'lsa faqat o'ziga ruxsat etilgan tumanlar arizalarini yuboramiz
        const visibleItems =
          client.allowedDistrictIds === null
            ? event.items
            : event.items.filter(
                (item) =>
                  item.district_id !== null &&
                  client.allowedDistrictIds!.includes(item.district_id),
              );

        if (visibleItems.length === 0) continue;

        const data = JSON.stringify({
          ...event,
          items: visibleItems.map(({ district_id: _d, ...rest }) => rest),
        });
        client.res.write(`event: row_color_updated\ndata: ${data}\n\n`);
      } catch {
        this.removeClient(id);
      }
    }
  }

  onModuleDestroy(): void {
    for (const client of this.clients.values()) {
      clearInterval(client.heartbeatTimer);
      try {
        if (!client.res.writableEnded) {
          client.res.end();
        }
      } catch {
        // ignore shutdown errors
      }
    }
    this.clients.clear();
  }
}
