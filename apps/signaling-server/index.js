const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 3001 }, () => {
  console.log('Signaling server running on ws://localhost:3001');
});

const clients = new Map();

wss.on('connection', (ws) => {
  console.log('New client connected');

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      const { type, to, from, payload } = data;

      if (type === 'register') {
        clients.set(from, ws);
        console.log(`Client registered as ${from}`);
        return;
      }

      if (to && clients.has(to)) {
        clients.get(to).send(JSON.stringify({ type, from, payload }));
      }

    } catch (e) {
      console.error('Error handling message:', e);
    }
  });

  ws.on('close', () => {
    for (const [id, socket] of clients.entries()) {
      if (socket === ws) {
        clients.delete(id);
        console.log(`Client ${id} disconnected`);
        break;
      }
    }
  });
});
