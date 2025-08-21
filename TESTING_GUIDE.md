# Testing Audio/Video Transmission Guide 🎥

## How to Test Multiple Devices Media Sharing

### 1. **Setup Test Environment**

#### Option A: Multiple Browser Tabs (Easiest)

1. Open 2-3 tabs in the same browser
2. Go to your app URL in each tab
3. Use different display names:
   - Tab 1: "Alice"
   - Tab 2: "Bob"
   - Tab 3: "Charlie"
4. Use the same Room ID (e.g., "4")

#### Option B: Different Browsers

1. Chrome: User "Alice"
2. Firefox: User "Bob"
3. Safari: User "Charlie"
4. Same Room ID

#### Option C: Different Devices

1. Desktop + Mobile
2. Different networks (WiFi vs 4G)
3. Same Room ID

### 2. **Expected Flow When Working**

#### Step 1: Connection

```
📱 Device A connects:
  ✅ "Successfully connected to room"
  ✅ Auto-starts camera/mic
  ✅ Shows local video

📱 Device B connects:
  ✅ "Successfully connected to room"
  ✅ Auto-starts camera/mic
  ✅ Device A receives "newPeer" notification
  ✅ Device A receives "newConsumer" notifications (video + audio)
  ✅ Both devices see each other's video/audio
```

#### Step 2: What You Should See

**Device A (First joiner):**

- Local video playing (you see yourself)
- Participants: (1) | Consumers (0) initially
- When Device B joins → Consumers (2) - one for video, one for audio
- Remote video box appears showing Device B's video

**Device B (Second joiner):**

- Local video playing (you see yourself)
- Participants: (2) | Consumers (2) immediately
- Remote video box showing Device A's video

### 3. **Debug Console Messages**

Look for these key messages in browser console:

#### ✅ **Success Messages:**

```
🚀 Connection attempt 1/3
🔌 Connecting with peerId: Alice_1640234567_abc123
🌐 WebSocket URL: ws://server.com/?roomId=4&peerId=Alice_1640234567_abc123
📱 Initializing mediasoup device...
✅ Device initialized successfully: true
🚚 Creating send transport...
📎 Send transport info received: {...}
🚚 Creating receive transport...
📎 Receive transport info received: {...}
✅ Both transports created successfully
🚀 Join response: {...}
✅ Successfully connected to room: 4
🎥 Starting media production...
📹 Requesting user media with constraints: {...}
✅ Got user media stream: {videoTracks: 1, audioTracks: 1}
📹 Producing video...
✅ Video producer created: producer-id-123
🎤 Producing audio...
✅ Audio producer created: producer-id-456
🎉 Successfully started producing media!

// When another user joins:
📨 Received notification: newPeer {...}
📨 Received notification: newConsumer {...}
📨 Creating consumer: {id: "consumer-123", peerId: "Bob_...", kind: "video"}
▶️ Resuming consumer: consumer-123
✅ Consumer created successfully: {...}
🎆 New remote consumer detected: {...}
📺 Attached remote stream to element: {...}
```

#### ❌ **Error Messages to Watch For:**

```
❌ Device initialization failed: ...
❌ Failed to create transports: ...
❌ Failed to start producing: ...
❌ Error in handleNewConsumer: ...
❌ Could not attach consumer - element or track missing: ...
```

### 4. **Debug Panel Information**

The app shows debug stats:

```
📊 Debug Stats
- Connected: Yes
- Producing: Yes
- Local Video: On
- Local Audio: On
- Remote Consumers: 2 (for 1 remote user)
- Participants: 2
```

### 5. **Troubleshooting Steps**

#### Problem: "Connected but no video/audio"

1. Check browser console for producer creation logs
2. Look for "newConsumer" notifications
3. Verify consumers count > 0
4. Check if backend is sending notifications

#### Problem: "One-way video only"

1. Check if both users see "Producing: Yes"
2. One user might have failed to create producers
3. Check microphone/camera permissions

#### Problem: "No remote video elements"

1. Look for "New remote consumer detected" logs
2. Check if video elements are created in DOM
3. Verify consumer.track exists

### 6. **Backend Requirements Checklist**

Your mediasoup backend MUST:

✅ **Support protoo protocol** (not socket.io)  
✅ **Handle requests:**

- `getRouterRtpCapabilities`
- `join` - with displayName, device, rtpCapabilities, sctpCapabilities
- `createWebRtcTransport` - with producing/consuming flags
- `connectWebRtcTransport` - with transportId, dtlsParameters
- `produce` - with transportId, kind, rtpParameters, appData
- `resumeConsumer` - with consumerId

✅ **Send notifications:**

- `newPeer` - when user joins
- `newConsumer` - when remote media available
- `consumerClosed` - when media ends

### 7. **Network Requirements**

✅ **WebSocket support** (ws:// or wss://)  
✅ **CORS enabled** for your domain  
✅ **ICE/STUN/TURN** configured for NAT traversal  
✅ **Firewall ports** open for WebRTC

### 8. **Expected Timeline**

**0-2 seconds:** Connection + device initialization  
**2-4 seconds:** Transport creation  
**4-6 seconds:** Media production starts  
**6-8 seconds:** Remote consumers appear  
**8-10 seconds:** Video/audio flowing between users

### 9. **Success Criteria**

✅ Both users see their own video (local)  
✅ Both users see each other's video (remote)  
✅ Audio works (unmute and test)  
✅ Participant count = number of connected users  
✅ Consumer count = 2 × (number of other users)  
✅ No errors in console  
✅ Media controls work (mute/unmute, video on/off)

If all criteria are met, your mediasoup setup is working correctly! 🎉
