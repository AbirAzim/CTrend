import { Injectable } from '@nestjs/common';
import { pubsub, USER_PRESENCE_CHANGED } from '../pubsub';
import type { WebSocket } from 'ws';

@Injectable()
export class PresenceService {
  private readonly socketToUser = new Map<WebSocket, string>();
  private readonly userConnections = new Map<string, number>();

  markOnline(socket: WebSocket, userId: string): void {
    this.socketToUser.set(socket, userId);
    const prev = this.userConnections.get(userId) ?? 0;
    this.userConnections.set(userId, prev + 1);
    if (prev === 0) {
      void pubsub.publish(USER_PRESENCE_CHANGED, {
        presenceChanged: { userId, online: true },
      });
    }
  }

  markOffline(socket: WebSocket): void {
    const userId = this.socketToUser.get(socket);
    if (!userId) return;
    this.socketToUser.delete(socket);
    const count = (this.userConnections.get(userId) ?? 1) - 1;
    if (count <= 0) {
      this.userConnections.delete(userId);
      void pubsub.publish(USER_PRESENCE_CHANGED, {
        presenceChanged: { userId, online: false },
      });
    } else {
      this.userConnections.set(userId, count);
    }
  }

  isOnline(userId: string): boolean {
    return (this.userConnections.get(userId) ?? 0) > 0;
  }

  onlineUserIds(): string[] {
    return Array.from(this.userConnections.keys());
  }
}
