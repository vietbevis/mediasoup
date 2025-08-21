import { CommonModule, NgIf } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  inject,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import * as mediasoupClient from 'mediasoup-client';
import { Subject, takeUntil } from 'rxjs';
import { MediaSoupState, Participant, VideoCallService } from '../video-call-service';

@Component({
  selector: 'app-video-call',
  imports: [NgIf, CommonModule],
  templateUrl: './video-call.html',
  styleUrl: './video-call.css',
})
export class VideoCall implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('localVideo') localVideoRef!: ElementRef<HTMLVideoElement>;

  serverUrl = 'https://media.kolla.click/';
  roomId = '4';
  displayName = 'User';
  joining = false;

  state: MediaSoupState = {
    isConnected: false,
    isProducing: false,
    participants: [],
    error: null,
  };

  participants: Participant[] = [];
  remoteConsumers = new Map<string, mediasoupClient.types.Consumer>();
  localVideoEnabled = true;
  localAudioEnabled = true;
  activeSpeaker: { peerId: string; volume: number } | null = null;

  private destroy$ = new Subject<void>();
  private mediaSoupService = inject(VideoCallService);

  ngOnInit() {
    // Subscribe to service state changes
    this.mediaSoupService.state$.pipe(takeUntil(this.destroy$)).subscribe((state) => {
      this.state = state;
      this.activeSpeaker = state.activeSpeaker || null;
    });

    // Subscribe to participants changes
    this.mediaSoupService.participants$.pipe(takeUntil(this.destroy$)).subscribe((participants) => {
      this.participants = participants;
    });

    // Subscribe to local stream changes
    this.mediaSoupService.localStream$.pipe(takeUntil(this.destroy$)).subscribe((stream) => {
      if (stream && this.localVideoRef) {
        this.localVideoRef.nativeElement.srcObject = stream;
      }
    });

    // Monitor consumers for remote media
    this.monitorConsumers();
  }

  ngAfterViewInit() {
    // Setup local video when view is ready
    const localStream = this.mediaSoupService.getLocalStream();
    if (localStream && this.localVideoRef) {
      this.localVideoRef.nativeElement.srcObject = localStream;
      // Ensure local video is muted to prevent hearing own voice
      this.localVideoRef.nativeElement.muted = true;
      this.localVideoRef.nativeElement.volume = 0;

      console.log('📺 [ngAfterViewInit] Local video setup:', {
        hasStream: !!localStream,
        muted: this.localVideoRef.nativeElement.muted,
        volume: this.localVideoRef.nativeElement.volume,
        videoTracks: localStream.getVideoTracks().length,
        audioTracks: localStream.getAudioTracks().length,
      });
    }
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    this.mediaSoupService.disconnect();
  }

  async joinRoom() {
    if (!this.serverUrl || !this.displayName) {
      alert('Vui lòng điền đầy đủ thông tin');
      return;
    }

    console.log('🚀 Starting join room process...', {
      serverUrl: this.serverUrl,
      displayName: this.displayName,
      roomId: this.roomId,
    });

    this.joining = true;

    try {
      // 1. Connect to server with retry mechanism
      console.log('🔌 Attempting to connect...');
      await this.mediaSoupService.connectWithRetry(this.serverUrl, this.displayName, this.roomId);

      // 2. Create transports
      console.log('🚚 Creating transports...');
      await this.mediaSoupService.createTransports();

      // 3. Auto-start media production
      console.log('🎥 Auto-starting media production...');
      await this.startMedia();

      console.log('✅ Successfully joined room and started media!');
    } catch (error) {
      console.error('❌ Failed to join room:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      alert('Không thể tham gia phòng: ' + errorMessage);
    } finally {
      this.joining = false;
    }
  }

  async startMedia() {
    try {
      console.log('🎥 Starting media production...');
      const stream = await this.mediaSoupService.startProducing(true, true);

      if (this.localVideoRef) {
        this.localVideoRef.nativeElement.srcObject = stream;
        // CRITICAL: Ensure local video is always muted to prevent hearing own voice
        this.localVideoRef.nativeElement.muted = true;
        this.localVideoRef.nativeElement.volume = 0;
        console.log('📺 Local video attached and muted:', {
          muted: this.localVideoRef.nativeElement.muted,
          volume: this.localVideoRef.nativeElement.volume,
        });
      }

      this.localVideoEnabled = this.mediaSoupService.isVideoEnabled();
      this.localAudioEnabled = this.mediaSoupService.isAudioEnabled();

      console.log('✅ Media started successfully', {
        videoEnabled: this.localVideoEnabled,
        audioEnabled: this.localAudioEnabled,
      });

      // Start monitoring for remote streams
      this.startRemoteStreamMonitoring();
    } catch (error) {
      console.error('❌ Failed to start media:', error);
      alert('Không thể bắt đầu camera/microphone: ' + (error as Error).message);
    }
  }

  async toggleVideo() {
    try {
      if (this.localVideoEnabled) {
        await this.mediaSoupService.pauseProducer('video');
      } else {
        await this.mediaSoupService.resumeProducer('video');
      }
      this.localVideoEnabled = this.mediaSoupService.isVideoEnabled();
    } catch (error) {
      console.error('Failed to toggle video:', error);
    }
  }

  async toggleAudio() {
    try {
      console.log('🎤 Toggling audio, current state:', this.localAudioEnabled);

      if (this.localAudioEnabled) {
        await this.mediaSoupService.pauseProducer('audio');
        console.log('🔇 Audio muted');
      } else {
        await this.mediaSoupService.resumeProducer('audio');
        console.log('🎤 Audio unmuted');
      }

      this.localAudioEnabled = this.mediaSoupService.isAudioEnabled();

      // Also mute/unmute local video element audio (extra protection against echo)
      if (this.localVideoRef) {
        this.localVideoRef.nativeElement.muted = true; // Always keep local muted
      }
    } catch (error) {
      console.error('❌ Failed to toggle audio:', error);
    }
  }

  leaveRoom() {
    this.mediaSoupService.disconnect();
    // Reset form data if needed
    this.localVideoEnabled = true;
    this.localAudioEnabled = true;
    this.remoteConsumers.clear();
  }

  trackByConsumerId(index: number, item: any): string {
    return item.key;
  }

  private startRemoteStreamMonitoring() {
    console.log('🔍 Starting remote stream monitoring...');

    // Monitor for new consumers (remote media) every 500ms
    setInterval(() => {
      this.updateRemoteStreams();
    }, 500);
  }

  private updateRemoteStreams() {
    const consumers = this.mediaSoupService.getConsumers();
    let hasNewConsumers = false;

    consumers.forEach((consumer, consumerId) => {
      if (!this.remoteConsumers.has(consumerId)) {
        console.log('🎆 New remote consumer detected:', {
          id: consumerId,
          kind: consumer.kind,
          peerId: (consumer as any).peerId,
        });

        this.remoteConsumers.set(consumerId, consumer);
        hasNewConsumers = true;

        // Attach consumer track to video element
        setTimeout(() => {
          this.attachConsumerToElement(consumer, consumerId);
        }, 100);
      }
    });

    // Remove closed consumers
    this.remoteConsumers.forEach((consumer, consumerId) => {
      if (!consumers.has(consumerId)) {
        console.log('🗑️ Removing closed consumer:', consumerId);
        this.remoteConsumers.delete(consumerId);
      }
    });

    if (hasNewConsumers) {
      console.log('📊 Updated remote consumers count:', this.remoteConsumers.size);
    }
  }

  private attachConsumerToElement(consumer: any, consumerId: string) {
    const videoElement = document.getElementById(`remote-${consumerId}`) as HTMLVideoElement;

    if (videoElement && consumer.track) {
      const stream = new MediaStream([consumer.track]);
      videoElement.srcObject = stream;

      // Important: Set proper mute settings to prevent echo
      if (consumer.kind === 'video') {
        videoElement.muted = true; // Video should be muted (no audio)
      } else if (consumer.kind === 'audio') {
        videoElement.muted = false; // Audio should NOT be muted (we want to hear it)
      }

      console.log('📺 Attached remote stream to element:', {
        consumerId,
        kind: consumer.kind,
        elementId: `remote-${consumerId}`,
        muted: videoElement.muted,
        peerId: consumer.peerId,
      });

      // Play the video/audio
      videoElement.play().catch((error) => {
        console.error('❌ Error playing remote media:', error);
      });
    } else {
      console.warn('⚠️ Could not attach consumer - element or track missing:', {
        consumerId,
        hasElement: !!videoElement,
        hasTrack: !!consumer.track,
      });
    }
  }

  private monitorConsumers() {
    // Legacy method - replaced by startRemoteStreamMonitoring
    this.startRemoteStreamMonitoring();
  }

  // Debug methods
  checkLocalVideoSettings() {
    console.log('🔍 [DEBUG] Local video element settings:', {
      element: !!this.localVideoRef,
      srcObject: !!this.localVideoRef?.nativeElement.srcObject,
      muted: this.localVideoRef?.nativeElement.muted,
      volume: this.localVideoRef?.nativeElement.volume,
      autoplay: this.localVideoRef?.nativeElement.autoplay,
      paused: this.localVideoRef?.nativeElement.paused,
    });

    const stream = this.localVideoRef?.nativeElement.srcObject as MediaStream;
    if (stream) {
      console.log('🔍 [DEBUG] Local stream details:', {
        id: stream.id,
        active: stream.active,
        videoTracks: stream.getVideoTracks().length,
        audioTracks: stream.getAudioTracks().length,
        audioTrackEnabled: stream.getAudioTracks()[0]?.enabled,
        videoTrackEnabled: stream.getVideoTracks()[0]?.enabled,
      });
    }
  }

  forceLocalVideoMute() {
    if (this.localVideoRef) {
      this.localVideoRef.nativeElement.muted = true;
      this.localVideoRef.nativeElement.volume = 0;
      console.log('✅ [DEBUG] Forced local video mute');
    }
  }
}
