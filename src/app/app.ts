import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';
import { VideoCall } from './video-call/video-call';

@Component({
  selector: 'app-root',
  imports: [CommonModule, VideoCall],
  standalone: true,
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly title = signal('mediasoup');
}
