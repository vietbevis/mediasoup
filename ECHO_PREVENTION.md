# Echo Prevention Guide 🎧

## Problem: Hearing Your Own Voice

If you hear your own voice when speaking, this is called **echo** or **audio feedback**. This is a common issue in video calling applications.

## ✅ Fixes Applied

### 1. **Fixed Remote Audio Muting Logic**

**Before:** `[muted]="consumer.value.kind === 'audio'"` ❌  
**After:** `[muted]="consumer.value.kind === 'video'"` ✅

- Video consumers should be muted (no audio)
- Audio consumers should NOT be muted (we want to hear them)

### 2. **Prevent Self-Consuming**

Added logic to prevent consuming your own audio/video:

```typescript
private isOwnConsumer(consumerPeerId: string): boolean {
  // Check if this consumer is from our own peer
  return this.currentPeerId === consumerPeerId;
}
```

### 3. **Enhanced Echo Cancellation**

Improved getUserMedia constraints:

```typescript
audio: {
  echoCancellation: true,    // Enable echo cancellation
  noiseSuppression: true,    // Enable noise suppression
  autoGainControl: true,     // Enable automatic gain control
  sampleRate: 48000,         // High quality audio
  channelCount: 1,           // Mono audio to reduce echo
}
```

### 4. **Proper Element Muting**

```typescript
// Local video: Always muted (prevent hearing yourself)
<video #localVideo autoplay muted playsinline>

// Remote video consumers: Muted (no audio track)
if (consumer.kind === 'video') {
  videoElement.muted = true;
}

// Remote audio consumers: NOT muted (we want to hear them)
if (consumer.kind === 'audio') {
  videoElement.muted = false;
}
```

## 🧪 How to Test

### Step 1: Single Device Test

1. Join room alone
2. Speak into microphone
3. **Expected:** You should NOT hear your own voice

### Step 2: Multiple Device Test

1. Open 2 browser tabs
2. Join same room with different names
3. Speak in Tab 1
4. **Expected:**
   - Tab 1: No echo of own voice
   - Tab 2: Hears Tab 1's voice clearly

### Step 3: Headphone Test

1. Use headphones on one device
2. Speakers on another device
3. **Expected:** No echo even with speakers

## 🔧 Additional Prevention Tips

### For Users:

- **Use headphones** - Best solution to prevent echo
- **Lower speaker volume** if using speakers
- **Mute when not speaking** in group calls
- **Use push-to-talk** for large meetings

### For Developers:

- Always mute local video element
- Implement proper audio routing
- Use echo cancellation in getUserMedia
- Prevent self-consuming audio streams

## 🚨 Debug Console Messages

### ✅ Good Messages (No Echo):

```
⚠️ Ignoring own consumer to prevent echo: {
  consumerId: "consumer-123",
  peerId: "Alice_1640234567_abc123",
  kind: "audio"
}

📺 Attached remote stream to element: {
  consumerId: "consumer-456",
  kind: "audio",
  muted: false,
  peerId: "Bob_1640234567_def456"
}
```

### ❌ Bad Messages (Potential Echo):

```
📺 Attached remote stream to element: {
  kind: "audio",
  muted: true,  // ❌ Should be false for audio
}

// Missing peer ID check - might consume own audio
```

## 🎯 Root Causes of Echo

1. **Microphone picks up speaker output**
2. **Audio feedback loop** (mic → speaker → mic)
3. **Self-consuming own audio streams**
4. **Incorrect muting of remote audio**
5. **Poor echo cancellation settings**

## 📱 Platform-Specific Notes

### Chrome/Chromium:

- Best echo cancellation support
- Hardware acceleration available
- Use `echoCancellation: true`

### Firefox:

- Good echo cancellation
- May need lower audio quality
- Test with different sample rates

### Safari:

- Limited echo cancellation
- Recommend headphones
- May have audio routing issues

### Mobile:

- Built-in echo cancellation
- Use device-specific optimizations
- Test with both wired/wireless headphones

## 🔄 Fallback Solutions

If echo persists:

1. **Manual Mute Control**: Add push-to-talk button
2. **Audio Gain Control**: Reduce microphone sensitivity
3. **Directional Microphones**: Better hardware solution
4. **Room Acoustics**: Improve physical environment
5. **Noise Gates**: Filter low-level audio

## ✨ Advanced Features

### Noise Suppression:

```typescript
audio: {
  noiseSuppression: true,
  autoGainControl: true,
  echoCancellation: true,
}
```

### Audio Level Detection:

```typescript
// Monitor audio levels to detect feedback
const audioContext = new AudioContext();
const analyser = audioContext.createAnalyser();
// Check for sudden volume spikes indicating feedback
```

### Adaptive Echo Cancellation:

```typescript
// Adjust settings based on detected echo
if (echoDetected) {
  // Reduce microphone gain
  // Increase echo cancellation aggressiveness
}
```

With these fixes, echo should be eliminated in most scenarios! 🎉
