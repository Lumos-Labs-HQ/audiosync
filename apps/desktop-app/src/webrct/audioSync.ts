export class AudioSync {
    private audio: HTMLAudioElement | null = null;
    private webrtc: any;
    private syncTimer: number | null = null;
    private timeOffset: number = 0;
    private isHostUser: boolean = false;
  
    constructor(webrtc: any) {
      this.webrtc = webrtc;
      this.audio = new Audio();
      this.setupAudioListeners();
    }
  
    loadLocalAudio(file: File) {
      const url = URL.createObjectURL(file);
      this.audio!.src = url;
      this.audio!.load();
      
      // If host, send the file info to all peers
      if (this.isHostUser) {
        this.webrtc.broadcastMessage({
          type: 'file-info',
          name: file.name,
          size: file.size
        });
      }
    }
    
    private setupAudioListeners() {
      if (!this.audio) return;
      
      this.audio.onplay = () => {
        if (this.isHostUser) {
          console.log('Broadcasting play event');
          this.webrtc.broadcastMessage({
            type: 'control',
            action: 'play',
            time: this.audio!.currentTime
          });
          
          // Start sending sync messages every second
          this.startSyncTimer();
        }
      };
      
      this.audio.onpause = () => {
        if (this.isHostUser) {
          console.log('Broadcasting pause event');
          this.webrtc.broadcastMessage({
            type: 'control',
            action: 'pause',
            time: this.audio!.currentTime
          });
          
          // Stop sync timer when paused
          this.stopSyncTimer();
        }
      };
      
      this.audio.onseeked = () => {
        if (this.isHostUser) {
          console.log('Broadcasting seek event');
          this.webrtc.broadcastMessage({
            type: 'control',
            action: 'seek',
            time: this.audio!.currentTime
          });
        }
      };
    }
    
    handlePeerMessage(data: any) {
      const fromClient = data.fromClient || 'unknown';
      
      switch (data.type) {
        case 'file-info':
          console.log(`Peer ${fromClient} is playing: ${data.name}`);
          break;
          
        case 'control':
          console.log(`Received control from ${fromClient}: ${data.action}`);
          this.handleControlMessage(data);
          break;
          
        case 'sync':
          this.handleSyncMessage(data);
          break;
      }
    }
    
    private handleControlMessage(data: any) {
      if (!this.audio || this.isHostUser) return;
      
      switch (data.action) {
        case 'play':
          console.log('Following play command');
          // Adjust time before playing
          if (Math.abs(this.audio.currentTime - data.time) > 0.5) {
            this.audio.currentTime = data.time;
          }
          this.audio.play();
          break;
          
        case 'pause':
          console.log('Following pause command');
          this.audio.pause();
          break;
          
        case 'seek':
          console.log(`Following seek command to ${data.time}`);
          this.audio.currentTime = data.time;
          break;
      }
    }
    
    private handleSyncMessage(data: any) {
      if (!this.audio || this.isHostUser) return;
      
      // Calculate time difference and adjust if needed
      const localTime = this.audio.currentTime;
      const peerTime = data.time;
      const diff = localTime - peerTime;
      
      // If difference is significant (more than 0.3 seconds)
      if (Math.abs(diff) > 0.3) {
        console.log(`Time drift detected: ${diff.toFixed(2)}s. Adjusting playback.`);
        
        // Adjust playback rate temporarily to catch up/slow down
        if (diff > 0) {
          // We're ahead, slow down
          this.audio.playbackRate = 0.95;
        } else {
          // We're behind, speed up
          this.audio.playbackRate = 1.05;
        }
        
        setTimeout(() => {
          if (this.audio) this.audio.playbackRate = 1.0;
        }, 2000);
      } else {
        // Reset to normal playback rate
        this.audio.playbackRate = 1.0;
      }
    }
    
    private startSyncTimer() {
      this.stopSyncTimer();
      
      this.syncTimer = window.setInterval(() => {
        if (this.audio && !this.audio.paused && this.isHostUser) {
          this.webrtc.broadcastMessage({
            type: 'sync',
            time: this.audio.currentTime
          });
        }
      }, 1000);
    }
    
    private stopSyncTimer() {
      if (this.syncTimer) {
        clearInterval(this.syncTimer);
        this.syncTimer = null;
      }
    }
    
    play() {
      if (this.audio) this.audio.play();
    }
    
    pause() {
      if (this.audio) this.audio.pause();
    }
    
    seek(time: number) {
      if (this.audio) this.audio.currentTime = time;
    }
    
    getAudioElement() {
      return this.audio;
    }
    
    setIsHost(isHost: boolean) {
      this.isHostUser = isHost;
      console.log(`User is now ${isHost ? 'HOST' : 'CLIENT'}`);
      
      // Start sync timer if host and audio is playing
      if (isHost && this.audio && !this.audio.paused) {
        this.startSyncTimer();
      } else if (!isHost) {
        this.stopSyncTimer();
      }
    }
    
    dispose() {
      this.stopSyncTimer();
      if (this.audio) {
        this.audio.pause();
        this.audio.src = '';
      }
    }
}