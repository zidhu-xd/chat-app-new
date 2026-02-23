const express = require('express');
const router = express.Router();
const User = require('../models/User');
const auth = require('../middleware/auth');

// @route   GET /api/users
// @desc    Get all users (for finding friends)
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.user.id } })
      .select('fullName username avatar avatarInitial bio isOnline lastSeen')
      .sort({ isOnline: -1, fullName: 1 });

    res.json({
      success: true,
      data: { users }
    });

  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error',
      error: error.message 
    });
  }
});

// @route   GET /api/users/search
// @desc    Search users by username or name
// @access  Private
router.get('/search', auth, async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.trim().length === 0) {
      return res.status(400).json({ 
        success: false,
        message: 'Search query is required' 
      });
    }

    const users = await User.find({
      _id: { $ne: req.user.id },
      $or: [
        { username: { $regex: q, $options: 'i' } },
        { fullName: { $regex: q, $options: 'i' } }
      ]
    })
    .select('fullName username avatar avatarInitial bio isOnline lastSeen')
    .limit(20);

    res.json({
      success: true,
      data: { users }
    });

  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error',
      error: error.message 
    });
  }
});

// @route   GET /api/users/:username
// @desc    Get user by username
// @access  Private
router.get('/:username', auth, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username })
      .select('fullName username avatar avatarInitial bio isOnline lastSeen createdAt');

    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }

    res.json({
      success: true,
      data: { user }
    });

  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error',
      error: error.message 
    });
  }
});

// @route   PUT /api/users/profile
// @desc    Update user profile
// @access  Private
router.put('/profile', auth, async (req, res) => {
  try {
    const { fullName, bio } = req.body;

    const updateData = {};
    if (fullName) updateData.fullName = fullName;
    if (bio !== undefined) updateData.bio = bio;

    const user = await User.findByIdAndUpdate(
      req.user.id,
      updateData,
      { new: true, runValidators: true }
    ).select('fullName username avatar avatarInitial bio isOnline lastSeen');

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: { user }
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error',
      error: error.message 
    });
  }
});

// @route   POST /api/users/friend-request/:userId
// @desc    Send friend request
// @access  Private
router.post('/friend-request/:userId', auth, async (req, res) => {
  try {
    const targetUser = await User.findById(req.params.userId);
    
    if (!targetUser) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }

    // Check if already friends
    if (targetUser.friends.includes(req.user.id)) {
      return res.status(400).json({ 
        success: false,
        message: 'Already friends' 
      });
    }

    // Check if request already sent
    const existingRequest = targetUser.friendRequests.find(
      req => req.from.toString() === req.user.id.toString()
    );

    if (existingRequest) {
      return res.status(400).json({ 
        success: false,
        message: 'Friend request already sent' 
      });
    }

    // Add friend request
    targetUser.friendRequests.push({ from: req.user.id });
    await targetUser.save();

    res.json({
      success: true,
      message: 'Friend request sent'
    });

  } catch (error) {
    console.error('Friend request error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error',
      error: error.message 
    });
  }
});

// @route   POST /api/users/friend-request/:requestId/accept
// @desc    Accept friend request
// @access  Private
router.post('/friend-request/:requestId/accept', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const requestIndex = user.friendRequests.findIndex(
      req => req._id.toString() === req.params.requestId
    );

    if (requestIndex === -1) {
      return res.status(404).json({ 
        success: false,
        message: 'Friend request not found' 
      });
    }

    const senderId = user.friendRequests[requestIndex].from;

    // Add to friends list
    user.friends.push(senderId);
    user.friendRequests.splice(requestIndex, 1);
    await user.save();

    // Add to sender's friends list
    await User.findByIdAndUpdate(senderId, {
      $push: { friends: req.user.id }
    });

    res.json({
      success: true,
      message: 'Friend request accepted'
    });

  } catch (error) {
    console.error('Accept friend request error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error',
      error: error.message 
    });
  }
});

module.exports = router;
