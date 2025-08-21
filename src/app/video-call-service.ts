import { Injectable } from '@angular/core';
import * as mediasoupClient from 'mediasoup-client';
import * as protooClient from 'protoo-client';
import { BehaviorSubject, Observable } from 'rxjs';

export interface Participant {
  id: string;
  displayName: string;
  device: {
    name: string;
    version: string;
  };
  isLocal: boolean;
  videoElement?: HTMLVideoElement;
  audioEnabled: boolean;
  videoEnabled: boolean;
}

export interface MediaSoupState {
  isConnected: boolean;
  isProducing: boolean;
  participants: Participant[];
  error: string | null;
  activeSpeaker?: {
    peerId: string;
    volume: number;
  };
}

export interface ConsumerInfo {
  peerId: string;
  producerId: string;
  id: string;
  kind: 'audio' | 'video';
  rtpParameters: any;
  type: string;
  appData: any;
  producerPaused: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class VideoCallService {
  private protooTransport!: protooClient.WebSocketTransport;
  private peer!: protooClient.Peer;
  private device!: mediasoupClient.Device;
  private sendTransport!: mediasoupClient.types.Transport;
  private recvTransport!: mediasoupClient.types.Transport;
  private videoProducer?: mediasoupClient.types.Producer;
  private audioProducer?: mediasoupClient.types.Producer;
  private consumers = new Map<string, mediasoupClient.types.Consumer>();
  private participants = new Map<string, Participant>();
  private currentPeerId?: string;
  private currentRoomId?: string;
  private connectionRetries = 0;
  private maxRetries = 3;
  private localPeerDisplayName?: string;

  private stateSubject = new BehaviorSubject<MediaSoupState>({
    isConnected: false,
    isProducing: false,
    participants: [],
    error: null,
  });

  private participantsSubject = new BehaviorSubject<Participant[]>([]);
  private localStreamSubject = new BehaviorSubject<MediaStream | null>(null);

  constructor() {}

  async connectWithRetry(serverUrl: string, displayName: string, roomId?: string): Promise<void> {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        console.log(`🚀 Connection attempt ${attempt}/${this.maxRetries}`);
        await this.connect(serverUrl, displayName, roomId);
        this.connectionRetries = 0;
        return; // Success
      } catch (error) {
        console.error(`❌ Attempt ${attempt} failed:`, error);
        this.connectionRetries = attempt;

        if (attempt === this.maxRetries) {
          const finalError = new Error(
            `Connection failed after ${this.maxRetries} attempts: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`
          );
          this.updateState({ error: finalError.message });
          throw finalError;
        }

        // Wait before retry (exponential backoff)
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        console.log(`⏳ Waiting ${delay}ms before retry...`);
        await new Promise((resolve) => setTimeout(resolve, delay));

        // Clean up before retry
        try {
          if (this.peer) this.peer.close();
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    }
  }

  get state$(): Observable<MediaSoupState> {
    return this.stateSubject.asObservable();
  }

  get participants$(): Observable<Participant[]> {
    return this.participantsSubject.asObservable();
  }

  get localStream$(): Observable<MediaStream | null> {
    return this.localStreamSubject.asObservable();
  }

  async connect(serverUrl: string, displayName: string, roomId?: string): Promise<void> {
    try {
      // Generate unique peer ID
      const peerId = this.generateUniquePeerId(displayName);
      this.currentPeerId = peerId;
      this.localPeerDisplayName = displayName;
      console.log('🔌 Connecting with peerId:', peerId);

      // Convert HTTP URL to WebSocket URL
      const wsUrl = this.buildWebSocketUrl(serverUrl, roomId, peerId);
      console.log('🌐 WebSocket URL:', wsUrl);

      // Create protoo WebSocket transport
      this.protooTransport = new protooClient.WebSocketTransport(wsUrl);
      this.peer = new protooClient.Peer(this.protooTransport);

      this.setupProtooListeners();

      // Wait for connection with timeout
      await this.waitForConnection();

      // Initialize device để có rtpCapabilities và sctpCapabilities
      console.log('📱 Initializing mediasoup device...');
      await this.initializeDevice();

      // Tham gia room theo requirements.md format
      const joinData = {
        displayName,
        device: {
          name: this.getDeviceName(),
          version: '1.0.0',
        },
        rtpCapabilities: this.device.rtpCapabilities,
        sctpCapabilities: this.device.sctpCapabilities,
      };

      console.log('🚀 Joining room with data:', { displayName, roomId });
      const joinResponse = await this.peer.request('join', joinData);
      console.log('🎉 Join response:', joinResponse);

      // Store the assigned peer ID from server if different
      if (joinResponse && joinResponse.peerId) {
        this.currentPeerId = joinResponse.peerId;
        console.log('🏷️ Server assigned peer ID:', this.currentPeerId);
      }

      console.log('✅ Successfully connected to room:', roomId);
      this.updateState({ isConnected: true, error: null });
    } catch (error) {
      console.error('❌ Connection error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Không thể kết nối tới server';
      this.updateState({ error: errorMessage });
      throw error;
    }
  }

  private generateUniquePeerId(displayName: string): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    const sanitizedName = displayName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 8);
    return `${sanitizedName}_${timestamp}_${random}`;
  }

  private buildWebSocketUrl(serverUrl: string, roomId?: string, peerId?: string): string {
    let wsUrl = serverUrl.replace(/^http/, 'ws');

    // Ensure proper path ending
    if (!wsUrl.endsWith('/')) {
      wsUrl += '/';
    }

    // Add query parameters
    const params = new URLSearchParams();
    if (roomId) params.set('roomId', roomId);
    if (peerId) params.set('peerId', peerId);

    return wsUrl + '?' + params.toString();
  }

  private waitForConnection(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let resolved = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error('Connection timeout after 10 seconds'));
        }
      }, 10000);

      this.peer.on('open', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          console.log('🎉 Protoo peer connection opened');
          resolve();
        }
      });

      this.peer.on('failed', (error: any) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          console.error('💥 Protoo peer connection failed:', error);
          reject(new Error(`Connection failed: ${error?.message || 'Unknown error'}`));
        }
      });

      // Don't reject on disconnected here - let it be handled by listeners
    });
  }

  async initializeDevice(): Promise<void> {
    try {
      this.device = new mediasoupClient.Device();

      // Lấy RTP capabilities từ server thông qua protoo
      console.log('📋 Requesting router RTP capabilities...');
      const routerRtpCapabilities = await this.peer.request('getRouterRtpCapabilities');
      console.log('📎 Received RTP capabilities:', !!routerRtpCapabilities);

      await this.device.load({ routerRtpCapabilities });

      console.log('✅ Device initialized successfully:', this.device.loaded);
      console.log('📱 Device info:', {
        rtpCapabilities: !!this.device.rtpCapabilities,
        sctpCapabilities: !!this.device.sctpCapabilities,
        handlerName: this.device.handlerName,
        loaded: this.device.loaded,
      });
    } catch (error) {
      console.error('❌ Device initialization failed:', error);
      throw new Error(
        `Device initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private getDeviceName(): string {
    const userAgent = navigator.userAgent;
    if (/Mobile|Android|iPhone|iPad/.test(userAgent)) {
      return 'Mobile Device';
    } else if (/Chrome/.test(userAgent)) {
      return 'Chrome Browser';
    } else if (/Firefox/.test(userAgent)) {
      return 'Firefox Browser';
    } else if (/Safari/.test(userAgent)) {
      return 'Safari Browser';
    }
    return 'Unknown Device';
  }

  async createTransports(): Promise<void> {
    try {
      if (!this.device || !this.device.loaded) {
        throw new Error('Device must be initialized before creating transports');
      }

      console.log('🚚 Creating send transport...');
      // Tạo send transport theo requirements.md
      const sendTransportInfo = await this.peer.request('createWebRtcTransport', {
        forceTcp: false,
        producing: true,
        consuming: false,
        sctpCapabilities: this.device.sctpCapabilities,
      });

      console.log('📎 Send transport info received:', {
        id: sendTransportInfo.id,
        iceParameters: !!sendTransportInfo.iceParameters,
        iceCandidates: sendTransportInfo.iceCandidates?.length || 0,
        dtlsParameters: !!sendTransportInfo.dtlsParameters,
      });

      this.sendTransport = this.device.createSendTransport(sendTransportInfo);

      this.sendTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
        try {
          await this.peer.request('connectWebRtcTransport', {
            transportId: this.sendTransport.id,
            dtlsParameters,
          });
          callback();
        } catch (error: any) {
          errback(error);
        }
      });

      this.sendTransport.on(
        'produce',
        async ({ kind, rtpParameters, appData }, callback, errback) => {
          try {
            const { producerId } = await this.peer.request('produce', {
              transportId: this.sendTransport.id,
              kind,
              rtpParameters,
              appData: appData || {},
            });
            callback({ id: producerId });
          } catch (error: any) {
            errback(error);
          }
        }
      );

      console.log('🚚 Creating receive transport...');
      // Tạo receive transport theo requirements.md
      const recvTransportInfo = await this.peer.request('createWebRtcTransport', {
        forceTcp: false,
        producing: false,
        consuming: true,
        sctpCapabilities: this.device.sctpCapabilities,
      });

      console.log('📎 Receive transport info received:', {
        id: recvTransportInfo.id,
        iceParameters: !!recvTransportInfo.iceParameters,
        iceCandidates: recvTransportInfo.iceCandidates?.length || 0,
        dtlsParameters: !!recvTransportInfo.dtlsParameters,
      });

      this.recvTransport = this.device.createRecvTransport(recvTransportInfo);

      this.recvTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
        try {
          await this.peer.request('connectWebRtcTransport', {
            transportId: this.recvTransport.id,
            dtlsParameters,
          });
          callback();
        } catch (error: any) {
          errback(error);
        }
      });
      console.log('✅ Both transports created successfully');
    } catch (error) {
      console.error('❌ Failed to create transports:', error);
      throw new Error(
        `Transport creation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async startProducing(enableVideo = true, enableAudio = true): Promise<MediaStream> {
    try {
      if (!this.sendTransport) {
        throw new Error('Send transport not available. Create transports first.');
      }

      console.log('🎥 Starting media production...', { enableVideo, enableAudio });

      const constraints: MediaStreamConstraints = {
        video: enableVideo
          ? {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 30 },
            }
          : false,
        audio: enableAudio
          ? {
              echoCancellation: true, // Enable echo cancellation
              noiseSuppression: true, // Enable noise suppression
              autoGainControl: true, // Enable automatic gain control
              sampleRate: 48000, // High quality audio
              sampleSize: 16, // 16-bit audio
              channelCount: 1, // Mono audio to reduce echo
            }
          : false,
      };

      console.log('📹 Requesting user media with constraints:', constraints);
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('✅ Got user media stream:', {
        videoTracks: stream.getVideoTracks().length,
        audioTracks: stream.getAudioTracks().length,
      });

      this.localStreamSubject.next(stream);

      // Produce video
      if (enableVideo && stream.getVideoTracks().length > 0) {
        console.log('📹 Producing video...');
        const videoTrack = stream.getVideoTracks()[0];
        this.videoProducer = await this.sendTransport.produce({
          track: videoTrack,
          codecOptions: {
            videoGoogleStartBitrate: 1000,
          },
        });

        console.log('✅ Video producer created:', this.videoProducer.id);

        this.videoProducer.on('trackended', () => {
          console.log('🚫 Video track ended');
        });

        this.videoProducer.on('transportclose', () => {
          console.log('🚫 Video transport closed');
        });
      }

      // Produce audio
      if (enableAudio && stream.getAudioTracks().length > 0) {
        console.log('🎤 Producing audio...');
        const audioTrack = stream.getAudioTracks()[0];
        this.audioProducer = await this.sendTransport.produce({
          track: audioTrack,
        });

        console.log('✅ Audio producer created:', this.audioProducer.id);

        this.audioProducer.on('trackended', () => {
          console.log('🚫 Audio track ended');
        });

        this.audioProducer.on('transportclose', () => {
          console.log('🚫 Audio transport closed');
        });
      }

      this.updateState({ isProducing: true });
      this.updateParticipants();

      console.log('🎉 Successfully started producing media!');
      return stream;
    } catch (error) {
      console.error('❌ Failed to start producing:', error);
      this.updateState({ error: 'Không thể truy cập camera/microphone' });
      throw error;
    }
  }

  async pauseProducer(kind: 'video' | 'audio'): Promise<void> {
    try {
      const producer = kind === 'video' ? this.videoProducer : this.audioProducer;
      if (producer && !producer.paused) {
        producer.pause();
        await this.peer.request('pauseProducer', { producerId: producer.id });
      }
    } catch (error) {
      console.error(`Lỗi pause ${kind} producer:`, error);
    }
  }

  async resumeProducer(kind: 'video' | 'audio'): Promise<void> {
    try {
      const producer = kind === 'video' ? this.videoProducer : this.audioProducer;
      if (producer && producer.paused) {
        producer.resume();
        await this.peer.request('resumeProducer', { producerId: producer.id });
      }
    } catch (error) {
      console.error(`Lỗi resume ${kind} producer:`, error);
    }
  }

  async consume(consumerInfo: ConsumerInfo): Promise<mediasoupClient.types.Consumer> {
    try {
      if (!this.recvTransport) {
        throw new Error('Receive transport not available');
      }

      console.log('📨 Creating consumer:', {
        id: consumerInfo.id,
        peerId: consumerInfo.peerId,
        producerId: consumerInfo.producerId,
        kind: consumerInfo.kind,
      });

      const consumer = await this.recvTransport.consume({
        id: consumerInfo.id,
        producerId: consumerInfo.producerId,
        kind: consumerInfo.kind,
        rtpParameters: consumerInfo.rtpParameters,
      });

      this.consumers.set(consumer.id, consumer);

      // Resume consumer để bắt đầu nhận media
      console.log('▶️ Resuming consumer:', consumer.id);
      await this.peer.request('resumeConsumer', { consumerId: consumer.id });

      consumer.on('trackended', () => {
        console.log('🚫 Consumer track ended:', consumer.id);
        this.consumers.delete(consumer.id);
        this.updateParticipants();
      });

      consumer.on('transportclose', () => {
        console.log('🚫 Consumer transport closed:', consumer.id);
        this.consumers.delete(consumer.id);
        this.updateParticipants();
      });

      // Store additional info for UI
      (consumer as any).peerId = consumerInfo.peerId;
      (consumer as any).kind = consumerInfo.kind;

      console.log('✅ Consumer created successfully:', {
        id: consumer.id,
        kind: consumer.kind,
        peerId: consumerInfo.peerId,
        hasTrack: !!consumer.track,
      });

      return consumer;
    } catch (error) {
      console.error('❌ Failed to create consumer:', error);
      throw error;
    }
  }

  async closeProducer(kind: 'video' | 'audio'): Promise<void> {
    try {
      const producer = kind === 'video' ? this.videoProducer : this.audioProducer;
      if (producer) {
        producer.close();
        await this.peer.request('closeProducer', { producerId: producer.id });

        if (kind === 'video') {
          this.videoProducer = undefined;
        } else {
          this.audioProducer = undefined;
        }
      }
    } catch (error) {
      console.error(`Lỗi đóng ${kind} producer:`, error);
    }
  }

  disconnect(): void {
    try {
      // Đóng tất cả producers
      if (this.videoProducer) {
        this.videoProducer.close();
      }
      if (this.audioProducer) {
        this.audioProducer.close();
      }

      // Đóng tất cả consumers
      this.consumers.forEach((consumer) => consumer.close());
      this.consumers.clear();

      // Đóng transports
      if (this.sendTransport) {
        this.sendTransport.close();
      }
      if (this.recvTransport) {
        this.recvTransport.close();
      }

      // Đóng protoo peer
      if (this.peer) {
        this.peer.close();
      }

      // Reset state
      this.updateState({
        isConnected: false,
        isProducing: false,
        participants: [],
        error: null,
      });

      this.localStreamSubject.next(null);
      this.participantsSubject.next([]);
      this.participants.clear();

      // Reset peer info to prevent echo issues
      this.currentPeerId = undefined;
      this.localPeerDisplayName = undefined;
    } catch (error) {
      console.error('Lỗi disconnect:', error);
    }
  }

  private setupProtooListeners(): void {
    // Handle connection events
    this.peer.on('open', () => {
      console.log('🟢 Protoo peer connected');
    });

    this.peer.on('disconnected', () => {
      console.warn('🟡 Protoo peer disconnected - attempting to reconnect...');
      this.updateState({ isConnected: false });
      // Could add auto-reconnect logic here
    });

    this.peer.on('close', () => {
      console.log('🔴 Protoo peer closed');
      this.updateState({ isConnected: false });
    });

    this.peer.on('failed', (error: any) => {
      console.error('💥 Protoo peer failed:', error);
      this.updateState({ error: `Connection failed: ${error?.message || 'Unknown error'}` });
    });

    // Handle notifications from server
    this.peer.on('notification', (notification: any) => {
      console.log('📨 [NOTIFICATION] Received:', {
        method: notification.method,
        data: notification.data,
        timestamp: new Date().toISOString(),
      });

      try {
        switch (notification.method) {
          case 'newPeer':
            console.log('👥 [newPeer] Processing:', notification.data);
            this.handleNewPeer(notification.data);
            break;
          case 'peerClosed':
            console.log('🚪 [peerClosed] Processing:', notification.data);
            this.handlePeerClosed(notification.data);
            break;
          case 'newConsumer':
            console.log('🎆 [newConsumer] Processing:', notification.data);
            // Handle async operation
            this.handleNewConsumer(notification.data).catch((error) => {
              console.error('❌ Error in handleNewConsumer:', error);
            });
            break;
          case 'consumerClosed':
            console.log('🗑️ [consumerClosed] Processing:', notification.data);
            this.handleConsumerClosed(notification.data);
            break;
          case 'consumerPaused':
            console.log('⏸️ [consumerPaused] Processing:', notification.data);
            this.handleConsumerPaused(notification.data);
            break;
          case 'consumerResumed':
            console.log('▶️ [consumerResumed] Processing:', notification.data);
            this.handleConsumerResumed(notification.data);
            break;
          case 'activeSpeaker':
            console.log('🎙️ [activeSpeaker] Processing:', notification.data);
            this.handleActiveSpeaker(notification.data);
            break;
          default:
            console.warn('⚠️ [UNKNOWN] Unknown notification method:', {
              method: notification.method,
              data: notification.data,
            });
        }
      } catch (error) {
        console.error(`❌ Error handling notification ${notification.method}:`, error);
      }
    });

    // Handle request errors
    this.peer.on('request', (request: any, accept: any, reject: any) => {
      console.warn('⚠️ Unexpected request from server:', request.method);
      reject(new Error('Client does not handle requests'));
    });
  }

  // Helper methods for handling notifications
  private handleNewPeer(data: { id: string; displayName: string; device: any }): void {
    console.log('New peer joined:', data);
    this.addParticipant({
      id: data.id,
      displayName: data.displayName,
      device: data.device,
      isLocal: false,
      audioEnabled: false,
      videoEnabled: false,
    });
  }

  private handlePeerClosed(data: { peerId: string }): void {
    console.log('Peer left:', data);
    this.removeParticipant(data.peerId);
  }

  private async handleNewConsumer(consumerInfo: ConsumerInfo): Promise<void> {
    try {
      console.log('📨 RAW newConsumer notification received:', {
        id: consumerInfo.id,
        peerId: consumerInfo.peerId,
        producerId: consumerInfo.producerId,
        kind: consumerInfo.kind,
        type: consumerInfo.type,
        producerPaused: consumerInfo.producerPaused,
      });

      // TEMPORARILY DISABLE OWN CONSUMER CHECK FOR DEBUGGING
      // TODO: Re-enable after confirming consumers work
      /*
      if (this.isOwnConsumer(consumerInfo.peerId)) {
        console.log('⚠️ Ignoring own consumer to prevent echo:', {
          consumerId: consumerInfo.id,
          peerId: consumerInfo.peerId,
          kind: consumerInfo.kind,
        });
        return;
      }
      */

      console.log('🎆 Processing consumer from peer:', consumerInfo);
      const consumer = await this.consume(consumerInfo);

      console.log('✅ Consumer created successfully, updating UI...');
      // Update participant media status
      this.updateParticipantMedia(consumerInfo.peerId, consumerInfo.kind, true);
      this.updateParticipants();
    } catch (error) {
      console.error('❌ Error handling newConsumer:', error);
    }
  }

  private handleConsumerClosed(data: { consumerId: string }): void {
    console.log('Consumer closed:', data);
    const consumer = this.consumers.get(data.consumerId);
    if (consumer) {
      consumer.close();
      this.consumers.delete(data.consumerId);
      this.updateParticipants();
    }
  }

  private handleConsumerPaused(data: { consumerId: string }): void {
    console.log('Consumer paused:', data);
    const consumer = this.consumers.get(data.consumerId);
    if (consumer) {
      consumer.pause();
    }
  }

  private handleConsumerResumed(data: { consumerId: string }): void {
    console.log('Consumer resumed:', data);
    const consumer = this.consumers.get(data.consumerId);
    if (consumer) {
      consumer.resume();
    }
  }

  private handleActiveSpeaker(data: { peerId: string; volume: number }): void {
    console.log('Active speaker:', data);
    this.updateState({ activeSpeaker: data });
  }

  private isOwnConsumer(consumerPeerId: string): boolean {
    // Check if this consumer is from our own peer
    if (!this.currentPeerId || !consumerPeerId) {
      console.log('🔍 isOwnConsumer: Missing peer info', {
        currentPeerId: this.currentPeerId,
        consumerPeerId,
        result: false,
      });
      return false;
    }

    // Direct peer ID match
    const directMatch = this.currentPeerId === consumerPeerId;

    // Also check display name match (backup check)
    const nameMatch = !!(
      this.localPeerDisplayName && consumerPeerId.includes(this.localPeerDisplayName)
    );

    const isOwn = directMatch || nameMatch;

    console.log('🔍 isOwnConsumer check:', {
      currentPeerId: this.currentPeerId,
      consumerPeerId,
      localDisplayName: this.localPeerDisplayName,
      directMatch,
      nameMatch,
      result: isOwn,
    });

    return isOwn;
  }

  private updateState(updates: Partial<MediaSoupState>): void {
    const currentState = this.stateSubject.value;
    this.stateSubject.next({ ...currentState, ...updates });
  }

  private addParticipant(participant: Participant): void {
    const currentParticipants = this.participantsSubject.value;
    const existingIndex = currentParticipants.findIndex((p) => p.id === participant.id);

    if (existingIndex === -1) {
      this.participantsSubject.next([...currentParticipants, participant]);
    }
  }

  private removeParticipant(peerId: string): void {
    const currentParticipants = this.participantsSubject.value;
    const filtered = currentParticipants.filter((p) => p.id !== peerId);
    this.participantsSubject.next(filtered);
  }

  private updateParticipantMedia(peerId: string, kind: 'audio' | 'video', enabled: boolean): void {
    const currentParticipants = this.participantsSubject.value;
    const updated = currentParticipants.map((p) => {
      if (p.id === peerId) {
        return {
          ...p,
          [kind === 'audio' ? 'audioEnabled' : 'videoEnabled']: enabled,
        };
      }
      return p;
    });
    this.participantsSubject.next(updated);
  }

  private updateParticipants(): void {
    // Update local participant status
    const currentParticipants = this.participantsSubject.value;
    const localParticipant = currentParticipants.find((p) => p.isLocal);

    if (localParticipant) {
      localParticipant.audioEnabled = !!this.audioProducer && !this.audioProducer.paused;
      localParticipant.videoEnabled = !!this.videoProducer && !this.videoProducer.paused;
    } else {
      // Add local participant if not exists
      this.addParticipant({
        id: 'local',
        displayName: 'You',
        device: { name: 'Local', version: '1.0.0' },
        isLocal: true,
        audioEnabled: !!this.audioProducer && !this.audioProducer.paused,
        videoEnabled: !!this.videoProducer && !this.videoProducer.paused,
      });
    }

    // Trigger state update
    this.updateState({ participants: this.participantsSubject.value });
  }

  // Getter methods
  getConsumers(): Map<string, mediasoupClient.types.Consumer> {
    return this.consumers;
  }

  getRemoteStreams(): Map<string, { peerId: string; kind: string; stream: MediaStream }> {
    const remoteStreams = new Map();

    this.consumers.forEach((consumer, consumerId) => {
      if (consumer.track) {
        const peerId = (consumer as any).peerId || 'unknown';
        const kind = consumer.kind;
        const stream = new MediaStream([consumer.track]);

        remoteStreams.set(consumerId, {
          peerId,
          kind,
          stream,
        });
      }
    });

    return remoteStreams;
  }

  getRemoteStreamsByPeer(): Map<string, { video?: MediaStream; audio?: MediaStream }> {
    const streamsByPeer = new Map();

    this.consumers.forEach((consumer) => {
      if (consumer.track) {
        const peerId = (consumer as any).peerId || 'unknown';
        const kind = consumer.kind;

        if (!streamsByPeer.has(peerId)) {
          streamsByPeer.set(peerId, {});
        }

        const peerStreams = streamsByPeer.get(peerId);
        const stream = new MediaStream([consumer.track]);

        if (kind === 'video') {
          peerStreams.video = stream;
        } else if (kind === 'audio') {
          peerStreams.audio = stream;
        }
      }
    });

    return streamsByPeer;
  }

  getLocalStream(): MediaStream | null {
    return this.localStreamSubject.value;
  }

  isVideoEnabled(): boolean {
    return !!this.videoProducer && !this.videoProducer.paused;
  }

  isAudioEnabled(): boolean {
    return !!this.audioProducer && !this.audioProducer.paused;
  }
}
