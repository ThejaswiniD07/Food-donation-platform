import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';

export class WebSocketManager {
  constructor() {
    this.wss = null;
    this.clients = new Map(); // ws -> { userId, role }
  }

  init(server, jwtSecret) {
    this.wss = new WebSocketServer({ noServer: true });

    this.wss.on('connection', (ws, req, user) => {
      this.clients.set(ws, user);

      ws.on('close', () => {
        this.clients.delete(ws);
      });

      ws.on('error', (err) => {
        console.warn('[WS client error]:', err.message);
        this.clients.delete(ws);
      });

      // Send initial welcome/connected
      this.sendToSocket(ws, { type: 'connected', userId: user.userId, role: user.role });
    });

    server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      if (url.pathname === '/ws') {
        const token = url.searchParams.get('token');
        if (!token) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        try {
          const decoded = jwt.verify(token, jwtSecret);
          this.wss.handleUpgrade(request, socket, head, (ws) => {
            this.wss.emit('connection', ws, request, { userId: decoded.id, role: decoded.role });
          });
        } catch {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
        }
      }
    });
  }

  sendToSocket(ws, data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(data));
      } catch (err) {
        console.warn('[WS send error]:', err.message);
      }
    }
  }

  sendToUser(userId, data) {
    for (const [ws, user] of this.clients.entries()) {
      if (user.userId === userId) {
        this.sendToSocket(ws, data);
      }
    }
  }

  sendToRole(role, data) {
    for (const [ws, user] of this.clients.entries()) {
      if (user.role === role) {
        this.sendToSocket(ws, data);
      }
    }
  }

  broadcast(data) {
    for (const [ws] of this.clients.entries()) {
      this.sendToSocket(ws, data);
    }
  }
}

export const wsManager = new WebSocketManager();
