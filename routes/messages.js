const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const auth = require('../middleware/auth');

// @route   GET /api/messages/conversations
// @desc    Get all conversations for current user
// @access  Private
router.get('/conversations', auth, async (req, res) => {
  try {
    const conversations = await Conversation.find({
      participants: req.user.id
    })
    .populate('participants', 'fullName username avatar avatarInitial isOnline lastSeen')
    .populate('lastMessage')
    .sort({ updatedAt: -1 });

    // Format conversations
    const formattedConversations = conversations.map(conv => {
      const otherUser = conv.participants.find(
        p => p._id.toString() !== req.user.id.toString()
      );

      return {
        id: conv._id,
        otherUser: {
          id: otherUser._id,
          fullName: otherUser.fullName,
          username: otherUser.username,
          avatar: otherUser.avatar,
          avatarInitial: otherUser.avatarInitial,
          isOnline: otherUser.isOnline,
          lastSeen: otherUser.lastSeen
        },
        lastMessage: conv.lastMessage,
        unreadCount: conv.unreadCount?.get(req.user.id.toString()) || 0,
        updatedAt: conv.updatedAt
      };
    });

    res.json({
      success: true,
      data: { conversations: formattedConversations }
    });

  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error',
      error: error.message 
    });
  }
});

// @route   GET /api/messages/:userId
// @desc    Get messages with a specific user
// @access  Private
router.get('/:userId', auth, async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    // Create conversation ID (sorted user IDs)
    const conversationId = [req.user.id, userId].sort().join('_');

    // Get messages
    const messages = await Message.find({
      conversationId,
      isDeleted: false
    })
    .populate('sender', 'fullName username avatar avatarInitial')
    .populate('receiver', 'fullName username avatar avatarInitial')
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);

    // Get total count
    const count = await Message.countDocuments({
      conversationId,
      isDeleted: false
    });

    // Mark messages as read
    await Message.updateMany(
      {
        conversationId,
        receiver: req.user.id,
        isRead: false
      },
      {
        isRead: true,
        readAt: new Date()
      }
    );

    res.json({
      success: true,
      data: {
        messages: messages.reverse(),
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(count / limit),
          totalMessages: count,
          hasMore: page * limit < count
        }
      }
    });

  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error',
      error: error.message 
    });
  }
});

// @route   POST /api/messages/:userId
// @desc    Send message to user
// @access  Private
router.post('/:userId', auth, async (req, res) => {
  try {
    const { userId } = req.params;
    const { content, messageType = 'text' } = req.body;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ 
        success: false,
        message: 'Message content is required' 
      });
    }

    // Create conversation ID
    const conversationId = [req.user.id, userId].sort().join('_');

    // Create message
    const message = await Message.create({
      conversationId,
      sender: req.user.id,
      receiver: userId,
      messageType,
      content: content.trim(),
      isDelivered: false,
      isRead: false
    });

    // Populate sender info
    await message.populate('sender', 'fullName username avatar avatarInitial');
    await message.populate('receiver', 'fullName username avatar avatarInitial');

    // Update or create conversation
    let conversation = await Conversation.findOne({
      participants: { $all: [req.user.id, userId] }
    });

    if (conversation) {
      conversation.lastMessage = message._id;
      const unreadCount = conversation.unreadCount || new Map();
      unreadCount.set(userId, (unreadCount.get(userId) || 0) + 1);
      conversation.unreadCount = unreadCount;
      await conversation.save();
    } else {
      conversation = await Conversation.create({
        participants: [req.user.id, userId],
        lastMessage: message._id,
        unreadCount: {
          [req.user.id]: 0,
          [userId]: 1
        }
      });
    }

    res.status(201).json({
      success: true,
      message: 'Message sent successfully',
      data: { message }
    });

  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error',
      error: error.message 
    });
  }
});

// @route   PUT /api/messages/:messageId/read
// @desc    Mark message as read
// @access  Private
router.put('/:messageId/read', auth, async (req, res) => {
  try {
    const message = await Message.findById(req.params.messageId);

    if (!message) {
      return res.status(404).json({ 
        success: false,
        message: 'Message not found' 
      });
    }

    if (message.receiver.toString() !== req.user.id.toString()) {
      return res.status(403).json({ 
        success: false,
        message: 'Unauthorized' 
      });
    }

    message.isRead = true;
    message.readAt = new Date();
    await message.save();

    res.json({
      success: true,
      message: 'Message marked as read'
    });

  } catch (error) {
    console.error('Mark as read error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error',
      error: error.message 
    });
  }
});

// @route   DELETE /api/messages/:messageId
// @desc    Delete message
// @access  Private
router.delete('/:messageId', auth, async (req, res) => {
  try {
    const message = await Message.findById(req.params.messageId);

    if (!message) {
      return res.status(404).json({ 
        success: false,
        message: 'Message not found' 
      });
    }

    if (message.sender.toString() !== req.user.id.toString()) {
      return res.status(403).json({ 
        success: false,
        message: 'Unauthorized' 
      });
    }

    message.isDeleted = true;
    await message.save();

    res.json({
      success: true,
      message: 'Message deleted successfully'
    });

  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error',
      error: error.message 
    });
  }
});

module.exports = router;
