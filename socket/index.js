const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');

const initializeSocket = (io) => {
  // Store connected users
  const connectedUsers = new Map();

  // Socket.IO authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      
      if (!token) {
        return next(new Error('Authentication error'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id);

      if (!user) {
        return next(new Error('User not found'));
      }

      socket.userId = user._id.toString();
      socket.username = user.username;
      next();

    } catch (error) {
      console.error('Socket auth error:', error);
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', async (socket) => {
    console.log(`✅ User connected: ${socket.username} (${socket.userId})`);

    // Store socket connection
    connectedUsers.set(socket.userId, socket.id);

    // Update user online status
    await User.findByIdAndUpdate(socket.userId, {
      isOnline: true,
      socketId: socket.id,
      lastSeen: new Date()
    });

    // Broadcast online status to all users
    socket.broadcast.emit('user:online', {
      userId: socket.userId,
      username: socket.username,
      isOnline: true
    });

    // Join user's personal room
    socket.join(socket.userId);

    // Handle sending messages
    socket.on('message:send', async (data) => {
      try {
        const { receiverId, content, messageType = 'text' } = data;

        // Create conversation ID
        const conversationId = [socket.userId, receiverId].sort().join('_');

        // Create message
        const message = await Message.create({
          conversationId,
          sender: socket.userId,
          receiver: receiverId,
          messageType,
          content,
          isDelivered: false,
          isRead: false
        });

        // Populate sender and receiver
        await message.populate('sender', 'fullName username avatar avatarInitial');
        await message.populate('receiver', 'fullName username avatar avatarInitial');

        // Update or create conversation
        let conversation = await Conversation.findOne({
          participants: { $all: [socket.userId, receiverId] }
        });

        if (conversation) {
          conversation.lastMessage = message._id;
          const unreadCount = conversation.unreadCount || new Map();
          unreadCount.set(receiverId, (unreadCount.get(receiverId) || 0) + 1);
          conversation.unreadCount = unreadCount;
          await conversation.save();
        } else {
          conversation = await Conversation.create({
            participants: [socket.userId, receiverId],
            lastMessage: message._id,
            unreadCount: {
              [socket.userId]: 0,
              [receiverId]: 1
            }
          });
        }

        // Send to receiver if online
        const receiverSocketId = connectedUsers.get(receiverId);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('message:receive', {
            message,
            conversationId
          });

          // Mark as delivered
          message.isDelivered = true;
          message.deliveredAt = new Date();
          await message.save();

          // Send delivery confirmation to sender
          socket.emit('message:delivered', {
            messageId: message._id,
            deliveredAt: message.deliveredAt
          });
        }

        // Send confirmation to sender
        socket.emit('message:sent', {
          message,
          conversationId
        });

      } catch (error) {
        console.error('Send message error:', error);
        socket.emit('message:error', {
          error: 'Failed to send message',
          details: error.message
        });
      }
    });

    // Handle typing indicator
    socket.on('typing:start', (data) => {
      const { receiverId } = data;
      const receiverSocketId = connectedUsers.get(receiverId);
      
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('typing:user', {
          userId: socket.userId,
          username: socket.username,
          isTyping: true
        });
      }
    });

    socket.on('typing:stop', (data) => {
      const { receiverId } = data;
      const receiverSocketId = connectedUsers.get(receiverId);
      
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('typing:user', {
          userId: socket.userId,
          username: socket.username,
          isTyping: false
        });
      }
    });

    // Handle message read status
    socket.on('message:read', async (data) => {
      try {
        const { messageId, senderId } = data;

        const message = await Message.findByIdAndUpdate(
          messageId,
          {
            isRead: true,
            readAt: new Date()
          },
          { new: true }
        );

        // Notify sender
        const senderSocketId = connectedUsers.get(senderId);
        if (senderSocketId) {
          io.to(senderSocketId).emit('message:read-receipt', {
            messageId,
            readAt: message.readAt,
            readBy: socket.userId
          });
        }

      } catch (error) {
        console.error('Mark as read error:', error);
      }
    });

    // Handle user going offline
    socket.on('disconnect', async () => {
      console.log(`❌ User disconnected: ${socket.username} (${socket.userId})`);

      // Remove from connected users
      connectedUsers.delete(socket.userId);

      // Update user offline status
      await User.findByIdAndUpdate(socket.userId, {
        isOnline: false,
        socketId: null,
        lastSeen: new Date()
      });

      // Broadcast offline status
      socket.broadcast.emit('user:offline', {
        userId: socket.userId,
        username: socket.username,
        isOnline: false,
        lastSeen: new Date()
      });
    });

    // Handle errors
    socket.on('error', (error) => {
      console.error('Socket error:', error);
    });
  });

  return io;
};

module.exports = initializeSocket;
