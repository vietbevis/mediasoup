### WebSocket Events

#### Client to Server Events
1. **join**
   - Purpose: Join a room
   - Data:
   ```javascript
   {
     displayName: string,
     device: {
       name: string,
       version: string
     },
     rtpCapabilities: {},
     sctpCapabilities: {}
   }
   ```

2. **createWebRtcTransport**
   - Purpose: Create media transport
   - Data:
   ```javascript
   {
     forceTcp: boolean,
     producing: boolean,
     consuming: boolean,
     sctpCapabilities: {}
   }
   ```

3. **connectWebRtcTransport**
   - Purpose: Connect transport
   - Data:
   ```javascript
   {
     transportId: string,
     dtlsParameters: {}
   }
   ```

4. **produce**
   - Purpose: Start producing media
   - Data:
   ```javascript
   {
     transportId: string,
     kind: 'audio|video',
     rtpParameters: {},
     appData: {}
   }
   ```

5. **pauseProducer**
   - Purpose: Pause media production
   - Data: `{ producerId: string }`

6. **resumeProducer**
   - Purpose: Resume media production
   - Data: `{ producerId: string }`

7. **closeProducer**
   - Purpose: Stop media production
   - Data: `{ producerId: string }`

#### Server to Client Events
1. **newPeer**
   - Purpose: New participant notification
   - Data:
   ```javascript
   {
     id: string,
     displayName: string,
     device: {}
   }
   ```

2. **peerClosed**
   - Purpose: Participant left notification
   - Data: `{ peerId: string }`

3. **newConsumer**
   - Purpose: New media stream available
   - Data:
   ```javascript
   {
     peerId: string,
     producerId: string,
     id: string,
     kind: 'audio|video',
     rtpParameters: {},
     type: string,
     appData: {},
     producerPaused: boolean
   }
   ```

4. **consumerClosed**
   - Purpose: Media stream ended
   - Data: `{ consumerId: string }`

5. **consumerPaused**
   - Purpose: Media stream paused
   - Data: `{ consumerId: string }`

6. **consumerResumed**
   - Purpose: Media stream resumed
   - Data: `{ consumerId: string }`

7. **activeSpeaker**
   - Purpose: Active speaker updates
   - Data:
   ```javascript
   {
     peerId: string,
     volume: number
   }
   ```