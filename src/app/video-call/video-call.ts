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

    this.joining = true;

    try {
      // 1. Connect to server (device initialization is now inside connect)
      await this.mediaSoupService.connect(this.serverUrl, this.displayName, this.roomId);

      // 2. Create transports
      await this.mediaSoupService.createTransports();

      console.log('Successfully joined room');
    } catch (error) {
      console.error('Failed to join room:', error);
      alert('Không thể tham gia phòng: ' + (error as Error).message);
    } finally {
      this.joining = false;
    }
  }

  async startMedia() {
    try {
      const stream = await this.mediaSoupService.startProducing(true, true);

      if (this.localVideoRef) {
        this.localVideoRef.nativeElement.srcObject = stream;
      }

      this.localVideoEnabled = this.mediaSoupService.isVideoEnabled();
      this.localAudioEnabled = this.mediaSoupService.isAudioEnabled();
    } catch (error) {
      console.error('Failed to start media:', error);
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
      if (this.localAudioEnabled) {
        await this.mediaSoupService.pauseProducer('audio');
      } else {
        await this.mediaSoupService.resumeProducer('audio');
      }
      this.localAudioEnabled = this.mediaSoupService.isAudioEnabled();
    } catch (error) {
      console.error('Failed to toggle audio:', error);
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

  private monitorConsumers() {
    // Monitor for new consumers (remote media)
    setInterval(() => {
      const consumers = this.mediaSoupService.getConsumers();

      consumers.forEach((consumer, consumerId) => {
        if (!this.remoteConsumers.has(consumerId)) {
          this.remoteConsumers.set(consumerId, consumer);

          // Attach consumer track to video element
          setTimeout(() => {
            const videoElement = document.getElementById(
              `remote-${consumerId}`
            ) as HTMLVideoElement;
            if (videoElement && consumer.track) {
              const stream = new MediaStream([consumer.track]);
              videoElement.srcObject = stream;

              // Play the video/audio
              videoElement.play().catch((error) => {
                console.error('Error playing remote media:', error);
              });
            }
          }, 100);
        }
      });

      // Remove closed consumers
      this.remoteConsumers.forEach((consumer, consumerId) => {
        if (!consumers.has(consumerId)) {
          this.remoteConsumers.delete(consumerId);
        }
      });
    }, 1000);
  }
}
