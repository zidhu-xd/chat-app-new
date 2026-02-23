const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }],
  lastMessage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  },
  unreadCount: {
    type: Map,
    of: Number,
    default: {}
  }
}, {
  timestamps: true
});

// Ensure only 2 participants for one-on-one chat
conversationSchema.index({ participants: 1 });

// Static method to find or create conversation
conversationSchema.statics.findOrCreate = async function(user1Id, user2Id) {
  let conversation = await this.findOne({
    participants: { $all: [user1Id, user2Id] }
  }).populate('participants', 'fullName username avatar isOnline lastSeen')
    .populate('lastMessage');
  
  if (!conversation) {
    conversation = await this.create({
      participants: [user1Id, user2Id],
      unreadCount: {
        [user1Id]: 0,
        [user2Id]: 0
      }
    });
    conversation = await conversation.populate('participants', 'fullName username avatar isOnline lastSeen');
  }
  
  return conversation;
};

const Conversation = mongoose.model('Conversation', conversationSchema);

module.exports = Conversation;
