const WebSocket = require('ws');

const wss = new WebSocket.Server({
  host: '0.0.0.0',
  port: 3001,
  // Increase max payload to handle larger signaling messages
  maxPayload: 65536, 
  // Faster ping detection
  perMessageDeflate: false
}, () => {
  console.log('Signaling server running on ws://0.0.0.0:3001');
  console.log('Connect using your local network IP address');
});

const rooms = new Map(); 
const clients = new Map();

wss.on('connection', (ws) => {
  const clientId = generateClientId();
  console.log(`New client connected: ${clientId}`);
  
  // Associate the client ID with this websocket
  clients.set(clientId, ws);
  
  // Send the client its assigned ID
  ws.send(JSON.stringify({
    type: 'client-id',
    id: clientId
  }));
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log(`Received message type: ${data.type} from client ${clientId}`);

      switch (data.type) {
        case 'create-room':
          const roomCode = generateRoomCode();
          rooms.set(roomCode, new Set([clientId]));
          
          console.log(`Room ${roomCode} created by client ${clientId}`);
          
          // Send room code back to creator
          ws.send(JSON.stringify({
            type: 'room-created',
            roomCode: roomCode
          }));
          break;
          
        case 'join-room':
          const roomToJoin = data.roomCode;
          
          if (!rooms.has(roomToJoin)) {
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Room does not exist'
            }));
            return;
          }
          
          // Add client to room
          rooms.get(roomToJoin).add(clientId);
          
          console.log(`Client ${clientId} joined room ${roomToJoin}`);
          
          // Notify everyone in the room about the new member
          broadcastToRoom(roomToJoin, {
            type: 'user-joined',
            clientId: clientId
          }, clientId);
          
          // Send room membership to the joining client
          const members = Array.from(rooms.get(roomToJoin));
          ws.send(JSON.stringify({
            type: 'room-joined',
            roomCode: roomToJoin,
            members: members
          }));
          break;
          
        case 'offer':
        case 'answer':
        case 'candidate':
          // Forward signaling messages to the intended recipient
          if (data.to && clients.has(data.to)) {
            console.log(`Forwarding ${data.type} from ${clientId} to ${data.to}`);
            clients.get(data.to).send(JSON.stringify({
              ...data,
              from: clientId
            }));
          }
          break;
          
        case 'broadcast':
          // Find which room this client is in
          for (const [roomCode, members] of rooms.entries()) {
            if (members.has(clientId)) {
              console.log(`Broadcasting message from ${clientId} in room ${roomCode}`);
              // Forward to all clients in the room except sender
              broadcastToRoom(roomCode, {
                type: 'broadcast',
                from: clientId,
                payload: data.payload
              }, clientId);
              break;
            }
          }
          break;
      }
    } catch (e) {
      console.error('Error handling message:', e);
    }
  });

  ws.on('close', () => {
    console.log(`Client ${clientId} disconnected`);
    
    // Remove client from any rooms they were in
    for (const [roomCode, members] of rooms.entries()) {
      if (members.has(clientId)) {
        members.delete(clientId);
        console.log(`Removed ${clientId} from room ${roomCode}`);
        
        // Notify others in the room
        broadcastToRoom(roomCode, {
          type: 'user-left',
          clientId: clientId
        });
        
        // If room is empty, remove it
        if (members.size === 0) {
          rooms.delete(roomCode);
          console.log(`Room ${roomCode} deleted (empty)`);
        }
      }
    }
    
    // Remove from clients map
    clients.delete(clientId);
  });
});

function broadcastToRoom(roomCode, message, excludeClientId = null) {
  if (!rooms.has(roomCode)) return;
  
  // Prepare the JSON string once for all recipients
  const messageString = JSON.stringify(message);
  
  const members = rooms.get(roomCode);
  for (const memberId of members) {
    if (memberId !== excludeClientId && clients.has(memberId)) {
      const ws = clients.get(memberId);
      // Use BINARY message type for slightly faster delivery
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(messageString);
        } catch (e) {
          console.error(`Error sending to client ${memberId}:`, e);
        }
      }
    }
  }
}

function generateClientId() {
  return 'client_' + Math.random().toString(36).substr(2, 9);
}

function generateRoomCode() {
  // Generate a 6-character room code
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Omitting similar-looking characters
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}
