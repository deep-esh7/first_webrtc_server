const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Configure CORS for Flutter app
const io = socketIo(server, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || "*",
    methods: ["GET", "POST"]
  },
  // Socket.io optimizations
  pingTimeout: 60000,
  pingInterval: 25000,
  upgradeTimeout: 10000,
  maxHttpBufferSize: 1e6
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Store room and user information
const rooms = new Map();
const users = new Map();

// Metrics for monitoring
let metrics = {
  connections: 0,
  totalConnections: 0,
  messages: 0,
  errors: 0
};

// PM2 graceful shutdown
process.on('SIGINT', () => {
  console.log('Received SIGINT. Graceful shutdown...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// PM2 ready signal
if (process.send) {
  process.send('ready');
}

// Socket.io connection handling with error handling
io.on('connection', (socket) => {
  metrics.connections++;
  metrics.totalConnections++;
  console.log(`User connected: ${socket.id} (Total: ${metrics.connections})`);

  // Handle room joining
  socket.on('join-room', (data) => {
    try {
      const { roomId, userId } = data;
      
      if (!roomId || !userId) {
        socket.emit('error', { message: 'Missing roomId or userId' });
        return;
      }
      
      // Store user info
      users.set(socket.id, { userId, roomId });
      
      // Join the socket room
      socket.join(roomId);
      
      // Initialize room if it doesn't exist
      if (!rooms.has(roomId)) {
        rooms.set(roomId, new Set());
      }
      
      // Add user to room
      const room = rooms.get(roomId);
      room.add(userId);
      
      // Notify other users in the room
      socket.to(roomId).emit('user-joined', { 
        userId,
        socketId: socket.id 
      });
      
      // Send current room participants to the new user
      const participants = Array.from(room).filter(id => id !== userId);
      socket.emit('room-participants', { participants });
      
      console.log(`User ${userId} joined room ${roomId}`);
      metrics.messages++;
    } catch (error) {
      console.error('Error in join-room:', error);
      metrics.errors++;
      socket.emit('error', { message: 'Failed to join room' });
    }
  });

  // Handle signaling messages with error handling
  socket.on('signaling-message', (data) => {
    try {
      const { roomId, targetUserId, type } = data;
      
      if (targetUserId) {
        const targetSocket = findSocketByUserId(targetUserId, roomId);
        if (targetSocket) {
          targetSocket.emit(type, {
            ...data,
            fromUserId: users.get(socket.id)?.userId
          });
        }
      } else {
        socket.to(roomId).emit(type, {
          ...data,
          fromUserId: users.get(socket.id)?.userId
        });
      }
      metrics.messages++;
    } catch (error) {
      console.error('Error in signaling-message:', error);
      metrics.errors++;
    }
  });

  // Handle WebRTC offers
  socket.on('offer', (data) => {
    try {
      const { roomId, targetUserId } = data;
      const fromUserId = users.get(socket.id)?.userId;
      
      if (targetUserId) {
        const targetSocket = findSocketByUserId(targetUserId, roomId);
        if (targetSocket) {
          targetSocket.emit('offer', {
            ...data,
            fromUserId
          });
        }
      }
      metrics.messages++;
    } catch (error) {
      console.error('Error in offer:', error);
      metrics.errors++;
    }
  });

  // Handle WebRTC answers
  socket.on('answer', (data) => {
    try {
      const { roomId, targetUserId } = data;
      const fromUserId = users.get(socket.id)?.userId;
      
      if (targetUserId) {
        const targetSocket = findSocketByUserId(targetUserId, roomId);
        if (targetSocket) {
          targetSocket.emit('answer', {
            ...data,
            fromUserId
          });
        }
      }
      metrics.messages++;
    } catch (error) {
      console.error('Error in answer:', error);
      metrics.errors++;
    }
  });

  // Handle ICE candidates
  socket.on('ice-candidate', (data) => {
    try {
      const { roomId, targetUserId } = data;
      const fromUserId = users.get(socket.id)?.userId;
      
      if (targetUserId) {
        const targetSocket = findSocketByUserId(targetUserId, roomId);
        if (targetSocket) {
          targetSocket.emit('ice-candidate', {
            ...data,
            fromUserId
          });
        }
      } else {
        socket.to(roomId).emit('ice-candidate', {
          ...data,
          fromUserId
        });
      }
      metrics.messages++;
    } catch (error) {
      console.error('Error in ice-candidate:', error);
      metrics.errors++;
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    try {
      metrics.connections--;
      const userInfo = users.get(socket.id);
      
      if (userInfo) {
        const { userId, roomId } = userInfo;
        
        // Remove user from room
        if (rooms.has(roomId)) {
          const room = rooms.get(roomId);
          room.delete(userId);
          
          // Remove empty rooms
          if (room.size === 0) {
            rooms.delete(roomId);
          }
        }
        
        // Notify other users in the room
        socket.to(roomId).emit('user-left', { 
          userId,
          socketId: socket.id 
        });
        
        // Remove user from tracking
        users.delete(socket.id);
        
        console.log(`User ${userId} left room ${roomId}`);
      }
      
      console.log(`User disconnected: ${socket.id} (Total: ${metrics.connections})`);
    } catch (error) {
      console.error('Error in disconnect:', error);
      metrics.errors++;
    }
  });

  // Handle errors
  socket.on('error', (error) => {
    console.error('Socket error:', error);
    metrics.errors++;
  });
});

// Helper function to find socket by user ID
function findSocketByUserId(userId, roomId) {
  for (const [socketId, userInfo] of users.entries()) {
    if (userInfo.userId === userId && userInfo.roomId === roomId) {
      return io.sockets.sockets.get(socketId);
    }
  }
  return null;
}

// REST API endpoints
app.get('/rooms', (req, res) => {
  try {
    const roomList = Array.from(rooms.entries()).map(([roomId, users]) => ({
      roomId,
      userCount: users.size,
      users: Array.from(users)
    }));
    
    res.json({ rooms: roomList });
  } catch (error) {
    console.error('Error getting rooms:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/rooms/:roomId', (req, res) => {
  try {
    const { roomId } = req.params;
    const room = rooms.get(roomId);
    
    if (room) {
      res.json({
        roomId,
        userCount: room.size,
        users: Array.from(room)
      });
    } else {
      res.status(404).json({ error: 'Room not found' });
    }
  } catch (error) {
    console.error('Error getting room:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    activeRooms: rooms.size,
    activeUsers: users.size,
    metrics: {
      ...metrics,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      pid: process.pid
    }
  });
});

// Metrics endpoint for monitoring
app.get('/metrics', (req, res) => {
  res.json({
    ...metrics,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    activeRooms: rooms.size,
    activeUsers: users.size,
    pid: process.pid,
    timestamp: new Date().toISOString()
  });
});

// Changed default port to 3006
const PORT = process.env.PORT || 3006;

server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Metrics: http://localhost:${PORT}/metrics`);
  
  // Send ready signal to PM2
  if (process.send) {
    process.send('ready');
  }
});

module.exports = { app, server };