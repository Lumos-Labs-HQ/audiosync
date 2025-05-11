const { Server } = require('socket.io');
const io = new Server({
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const rooms = new Map();

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  socket.on('join-room', (roomId) => {
    console.log(`Client ${socket.id} joining room ${roomId}`);
    socket.join(roomId);
    
    // Create room if it doesn't exist
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    
    // Add client to room
    rooms.get(roomId).add(socket.id);
    
    // Notify client they joined successfully
    socket.emit('room-joined', roomId);
    
    // Notify others in the room
    socket.to(roomId).emit('user-joined', socket.id);
  });

  socket.on('audio-chunk', (data) => {
    // Broadcast the audio chunk to the specific room with timestamp
    if (data && data.roomId && data.chunk) {
      // Always preserve the original timestamp for accurate sync
      // Only generate a timestamp if one wasn't provided
      if (!data.timestamp) {
        data.timestamp = Date.now();
        console.log(`No timestamp provided, adding server timestamp: ${data.timestamp}`);
      }
      
      console.log(`Broadcasting audio chunk to room ${data.roomId}, size: ${data.chunk.byteLength}, timestamp: ${data.timestamp}`);
      
      // Forward the chunk with original timestamp to all others in the room
      // This keeps the timing intact for synchronization
      socket.to(data.roomId).emit('audio-chunk', {
        chunk: data.chunk,
        timestamp: data.timestamp
      });
    } else {
      console.warn('Received invalid audio chunk data:', Object.keys(data || {}));
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    // Remove client from any rooms they were in
    rooms.forEach((clients, roomId) => {
      if (clients.has(socket.id)) {
        clients.delete(socket.id);
        console.log(`Removed ${socket.id} from room ${roomId}`);
        
        // Notify others in the room
        socket.to(roomId).emit('user-left', socket.id);
        
        // Clean up empty rooms
        if (clients.size === 0) {
          rooms.delete(roomId);
          console.log(`Deleted empty room ${roomId}`);
        }
      }
    });
  });
});

const port = process.env.PORT || 3001;
io.listen(port);
console.log(`Socket.IO server running on port ${port}`);
