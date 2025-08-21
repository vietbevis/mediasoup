# Debug Guide - Audio Echo & Consumer Issues 🔧

## 🎯 Current Issues Being Debugged

1. **Local Audio Monitoring**: User hears their own voice immediately (not echo loop)
2. **No Remote Media**: Not receiving video/audio from other users

## 🔍 Debug Steps

### Step 1: Test Local Audio Issue

1. **Join room alone** (single tab)
2. **Speak into microphone**
3. **Check console logs**:

   ```
   📺 [ngAfterViewInit] Local video setup: {
     muted: true,        // ✅ Should be true
     volume: 0,          // ✅ Should be 0
     audioTracks: 1      // ✅ Should have audio
   }
   ```

4. **Use Debug Panel**:

   - Look at "Local Video Muted: Yes"
   - Look at "Local Video Volume: 0"
   - Click "🔍 Check Local Video" button
   - Click "🔇 Force Mute Local" if needed

5. **Expected Result**: Should NOT hear your own voice

### Step 2: Test Consumer Reception

1. **Open 2 browser tabs**
2. **Different display names**: "Alice", "Bob"
3. **Same room ID**: "4"
4. **Check console logs in BOTH tabs**:

**Expected Logs (Tab 1 - Alice):**

```
📨 [NOTIFICATION] Received: {
  method: "newPeer",
  data: {id: "Bob_...", displayName: "Bob"}
}

📨 [NOTIFICATION] Received: {
  method: "newConsumer",
  data: {peerId: "Bob_...", kind: "video"}
}

📨 [NOTIFICATION] Received: {
  method: "newConsumer",
  data: {peerId: "Bob_...", kind: "audio"}
}

🎆 [newConsumer] Processing: {...}
📨 RAW newConsumer notification received: {...}
🎆 Processing consumer from peer: {...}
✅ Consumer created successfully, updating UI...
```

**Expected Logs (Tab 2 - Bob):**

```
Similar logs but receiving Alice's consumers
```

### Step 3: Debug Consumer Blocking

**IMPORTANT**: We've temporarily **DISABLED** the `isOwnConsumer` check to see if consumers work at all.

Look for these logs:

```
🔍 isOwnConsumer check: {
  currentPeerId: "Alice_...",
  consumerPeerId: "Bob_...",
  directMatch: false,        // ✅ Should be false for different users
  nameMatch: false,          // ✅ Should be false for different users
  result: false              // ✅ Should be false (not blocking)
}
```

### Step 4: Check Debug Panel

After both users join, check debug stats:

```
📊 Debug Stats
- Connected: Yes
- Producing: Yes
- Remote Consumers: 2 (should be 2 for 1 remote user)
- Participants: 2 (should be 2 total)
- Local Video Muted: Yes (should be Yes)
- Local Video Volume: 0 (should be 0)
```

## 🚨 Common Issues & Solutions

### Issue 1: Still Hearing Own Voice

**Symptoms**: Local audio monitoring
**Debug**:

- Click "🔍 Check Local Video" button
- Check muted=true, volume=0
- If not, click "🔇 Force Mute Local"

### Issue 2: No Remote Consumers

**Symptoms**: Remote Consumers: 0
**Debug**:

- Check if both users are producing (Producing: Yes)
- Look for "newConsumer" notifications in console
- Check if backend is sending notifications

### Issue 3: Consumer Created But No Video

**Symptoms**: Remote Consumers > 0 but no video visible
**Debug**:

```
📺 Attached remote stream to element: {
  consumerId: "consumer-123",
  kind: "video",
  muted: true,              // ✅ Video should be muted
  peerId: "Bob_..."
}

📺 Attached remote stream to element: {
  consumerId: "consumer-456",
  kind: "audio",
  muted: false,             // ✅ Audio should NOT be muted
  peerId: "Bob_..."
}
```

## 🔧 Backend Debug Checklist

Your mediasoup backend should send these notifications:

### When User B joins (after User A):

```javascript
// To User A:
notification('newPeer', {
  id: 'userB_id',
  displayName: 'Bob',
  device: {...}
})

notification('newConsumer', {
  peerId: 'userB_id',
  producerId: 'producer-video-123',
  id: 'consumer-video-456',
  kind: 'video',
  rtpParameters: {...},
  type: 'simple',
  appData: {},
  producerPaused: false
})

notification('newConsumer', {
  peerId: 'userB_id',
  producerId: 'producer-audio-789',
  id: 'consumer-audio-012',
  kind: 'audio',
  rtpParameters: {...},
  type: 'simple',
  appData: {},
  producerPaused: false
})
```

### When User A joins (after User B):

```javascript
// To User B: Similar notifications about User A
```

## 🎯 Expected Test Results

### ✅ Working Correctly:

1. **No local audio feedback** - Don't hear own voice
2. **Remote consumers = 2 × other users** - Video + Audio per user
3. **Remote video elements visible** - See other users' video
4. **Remote audio audible** - Hear other users' voice
5. **Console shows consumer creation** - Detailed debug logs

### ❌ Still Broken:

1. **Hearing own voice** → Local video muting issue
2. **No newConsumer notifications** → Backend not sending
3. **Consumers created but no media** → Video element attachment issue
4. **Echo between users** → Re-enable echo prevention after fixing consumers

## 🔄 After Testing

Once consumers work correctly:

1. **Re-enable echo prevention** by uncommenting the `isOwnConsumer` check
2. **Verify no self-consuming** of own audio/video
3. **Test final configuration** with multiple users
4. **Performance testing** with 3+ users

## 📝 Debug Log Collection

For support, collect these logs:

1. Full browser console from both tabs
2. Debug panel stats
3. Network tab (WebSocket messages)
4. Backend logs (if available)

This will help identify exactly where the issue occurs! 🎉
