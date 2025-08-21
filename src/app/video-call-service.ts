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

  private stateSubject = new BehaviorSubject<MediaSoupState>({
    isConnected: false,
    isProducing: false,
    participants: [],
    error: null,
  });

  private participantsSubject = new BehaviorSubject<Participant[]>([]);
  private localStreamSubject = new BehaviorSubject<MediaStream | null>(null);

  constructor() {}

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
      // Convert HTTP URL to WebSocket URL
      const wsUrl =
        serverUrl.replace(/^http/, 'ws') +
        (serverUrl.endsWith('/') ? '' : '/') +
        `?roomId=${roomId}&peerId=${Math.random().toString(36).substr(2, 9)}`;

      // Create protoo WebSocket transport
      this.protooTransport = new protooClient.WebSocketTransport(wsUrl);
      this.peer = new protooClient.Peer(this.protooTransport);

      await this.setupProtooListeners();

      // Wait for connection
      await new Promise<void>((resolve, reject) => {
        this.peer.on('open', () => resolve());
        this.peer.on('failed', reject);
        this.peer.on('disconnected', reject);
      });

      // Initialize device để có rtpCapabilities và sctpCapabilities
      await this.initializeDevice();

      // Tham gia room theo requirements.md format
      const joinData = {
        displayName,
        device: {
          name: navigator.userAgent,
          version: '1.0.0',
        },
        rtpCapabilities: this.device.rtpCapabilities,
        sctpCapabilities: this.device.sctpCapabilities,
      };

      await this.peer.request('join', joinData);

      this.updateState({ isConnected: true, error: null });
    } catch (error) {
      console.error('Lỗi kết nối:', error);
      this.updateState({ error: 'Không thể kết nối tới server' });
      throw error;
    }
  }

  async initializeDevice(): Promise<void> {
    try {
      this.device = new mediasoupClient.Device();

      // Lấy RTP capabilities từ server thông qua protoo
      const routerRtpCapabilities = await this.peer.request('getRouterRtpCapabilities');

      await this.device.load({ routerRtpCapabilities });

      console.log('Device initialized:', this.device.loaded);
    } catch (error) {
      console.error('Lỗi khởi tạo device:', error);
      throw error;
    }
  }

  async createTransports(): Promise<void> {
    try {
      // Tạo send transport theo requirements.md
      const sendTransportInfo = await this.peer.request('createWebRtcTransport', {
        forceTcp: false,
        producing: true,
        consuming: false,
        sctpCapabilities: this.device.sctpCapabilities,
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

      // Tạo receive transport theo requirements.md
      const recvTransportInfo = await this.peer.request('createWebRtcTransport', {
        forceTcp: false,
        producing: false,
        consuming: true,
        sctpCapabilities: this.device.sctpCapabilities,
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
    } catch (error) {
      console.error('Lỗi tạo transports:', error);
      throw error;
    }
  }

  async startProducing(enableVideo = true, enableAudio = true): Promise<MediaStream> {
    try {
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
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            }
          : false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.localStreamSubject.next(stream);

      // Produce video
      if (enableVideo && stream.getVideoTracks().length > 0) {
        const videoTrack = stream.getVideoTracks()[0];
        this.videoProducer = await this.sendTransport.produce({
          track: videoTrack,
          codecOptions: {
            videoGoogleStartBitrate: 1000,
          },
        });

        this.videoProducer.on('trackended', () => {
          console.log('Video track ended');
        });
      }

      // Produce audio
      if (enableAudio && stream.getAudioTracks().length > 0) {
        const audioTrack = stream.getAudioTracks()[0];
        this.audioProducer = await this.sendTransport.produce({
          track: audioTrack,
        });

        this.audioProducer.on('trackended', () => {
          console.log('Audio track ended');
        });
      }

      this.updateState({ isProducing: true });
      return stream;
    } catch (error) {
      console.error('Lỗi bắt đầu producing:', error);
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
      const consumer = await this.recvTransport.consume({
        id: consumerInfo.id,
        producerId: consumerInfo.producerId,
        kind: consumerInfo.kind,
        rtpParameters: consumerInfo.rtpParameters,
      });

      this.consumers.set(consumer.id, consumer);

      // Resume consumer để bắt đầu nhận media
      await this.peer.request('resumeConsumer', { consumerId: consumer.id });

      consumer.on('trackended', () => {
        console.log('Consumer track ended');
      });

      consumer.on('transportclose', () => {
        console.log('Consumer transport closed');
      });

      return consumer;
    } catch (error) {
      console.error('Lỗi tạo consumer:', error);
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
    } catch (error) {
      console.error('Lỗi disconnect:', error);
    }
  }

  private setupProtooListeners(): void {
    // Handle connection events
    this.peer.on('open', () => {
      console.log('Protoo peer connected');
    });

    this.peer.on('disconnected', () => {
      console.log('Protoo peer disconnected');
      this.updateState({ isConnected: false });
    });

    this.peer.on('close', () => {
      console.log('Protoo peer closed');
      this.updateState({ isConnected: false });
    });

    this.peer.on('failed', (error: any) => {
      console.error('Protoo peer failed:', error);
      this.updateState({ error: 'Connection failed' });
    });

    // Handle notifications from server
    this.peer.on('notification', (notification: any) => {
      console.log('Received notification:', notification.method, notification.data);

      switch (notification.method) {
        case 'newPeer':
          this.handleNewPeer(notification.data);
          break;
        case 'peerClosed':
          this.handlePeerClosed(notification.data);
          break;
        case 'newConsumer':
          this.handleNewConsumer(notification.data);
          break;
        case 'consumerClosed':
          this.handleConsumerClosed(notification.data);
          break;
        case 'consumerPaused':
          this.handleConsumerPaused(notification.data);
          break;
        case 'consumerResumed':
          this.handleConsumerResumed(notification.data);
          break;
        case 'activeSpeaker':
          this.handleActiveSpeaker(notification.data);
          break;
        default:
          console.log('Unknown notification:', notification.method);
      }
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
      console.log('New consumer available:', consumerInfo);
      const consumer = await this.consume(consumerInfo);

      // Update participant media status
      this.updateParticipantMedia(consumerInfo.peerId, consumerInfo.kind, true);
      this.updateParticipants();
    } catch (error) {
      console.error('Lỗi xử lý newConsumer:', error);
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
