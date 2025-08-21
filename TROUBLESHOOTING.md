# MediaSoup Multiple Devices Troubleshooting Guide 🔧

## Common Issues When Multiple Devices Join

### 1. **Check Backend Server**

Make sure your mediasoup backend server:

- ✅ Supports protoo protocol (not socket.io)
- ✅ Is running and accessible
- ✅ Handles multiple peer connections
- ✅ Has proper CORS settings

### 2. **WebSocket URL Format**

The client generates WebSocket URLs like:

```
ws://your-server.com/?roomId=4&peerId=User_timestamp_random
```

### 3. **Unique Peer IDs**

Each device now generates unique peer IDs using:

- Display name (sanitized)
- Timestamp
- Random string

Format: `{displayName}_{timestamp}_{random}`

### 4. **Debug Information**

#### Check Browser Console

Look for these logs:

- 🔌 `Connecting with peerId: ...`
- 🌐 `WebSocket URL: ...`
- 📱 `Initializing mediasoup device...`
- 🚚 `Creating send transport...`
- ✅ `Successfully connected to room`

#### Common Error Messages

| Error                                | Cause                   | Solution                   |
| ------------------------------------ | ----------------------- | -------------------------- |
| `Connection timeout`                 | Backend not responding  | Check server status        |
| `Device initialization failed`       | RTP capabilities issue  | Verify backend router      |
| `Transport creation failed`          | Backend transport error | Check server logs          |
| `Connection failed after N attempts` | Network/server issue    | Check network connectivity |

### 5. **Testing Multiple Devices**

#### Method 1: Multiple Browser Tabs

1. Open 2-3 tabs in same browser
2. Use different display names
3. Join same room ID

#### Method 2: Different Browsers

1. Chrome, Firefox, Safari
2. Different display names
3. Same room ID

#### Method 3: Different Devices

1. Desktop + mobile
2. Different networks (WiFi vs 4G)
3. Same room ID

### 6. **Expected Behavior**

When working correctly:

1. First device connects ✅
2. Second device connects ✅
3. Both devices see each other in participants list
4. `newPeer` notifications received
5. Video/audio streams exchanged

### 7. **Backend Requirements**

Your mediasoup server must support:

```javascript
// Protoo methods your backend should handle:
-getRouterRtpCapabilities -
  join -
  createWebRtcTransport -
  connectWebRtcTransport -
  produce -
  pauseProducer / resumeProducer -
  closeProducer -
  // Protoo notifications your backend should send:
  newPeer -
  peerClosed -
  newConsumer -
  consumerClosed -
  consumerPaused / consumerResumed -
  activeSpeaker;
```

### 8. **Network Considerations**

- Firewall settings
- NAT traversal
- STUN/TURN servers
- ICE candidates

### 9. **Debug Mode**

The app now shows debug information when not connected, including:

- Server URL
- Room ID
- Generated WebSocket URL
- Connection status

This helps identify configuration issues quickly.
