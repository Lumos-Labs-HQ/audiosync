export class AudioSync {
    private audio: HTMLAudioElement | null = null;
    private webrtc: any;
    private syncTimer: number | null = null;
    private timeOffset: number = 0;
    private isPeerInitiator: boolean = false;
  
    constructor(webrtc: any, isPeerInitiator: boolean = false) {
      this.webrtc = webrtc;
      this.isPeerInitiator = isPeerInitiator;
      this.audio = new Audio();
    }
  
    loadLocalAudio(file: File) {
      const url = URL.createObjectURL(file);
      this.audio!.src = url;
      this.audio!.load();
      
      // Setup audio element listeners
      this.setupAudioListeners();
      
      // If initiator, send the file info to peer
      if (this.isPeerInitiator) {
        this.webrtc.sendMessage({
          type: 'file-info',
          name: file.name,
          size: file.size
        });
      }
    }
    
    private setupAudioListeners() {
      if (!this.audio) return;
      
      this.audio.onplay = () => {
        this.webrtc.sendMessage({
          type: 'control',
          action: 'play',
          time: this.audio!.currentTime
        });
        
        // Start sending sync messages every second
        this.startSyncTimer();
      };
      
      this.audio.onpause = () => {
        this.webrtc.sendMessage({
          type: 'control',
          action: 'pause',
          time: this.audio!.currentTime
        });
        
        // Stop sync timer when paused
        this.stopSyncTimer();
      };
      
      this.audio.onseeked = () => {
        this.webrtc.sendMessage({
          type: 'control',
          action: 'seek',
          time: this.audio!.currentTime
        });
      };
    }
    
    handlePeerMessage(data: any) {
      switch (data.type) {
        case 'file-info':
          console.log('Peer is playing:', data.name);
          break;
          
        case 'control':
          this.handleControlMessage(data);
          break;
          
        case 'sync':
          this.handleSyncMessage(data);
          break;
      }
    }
    
    private handleControlMessage(data: any) {
      if (!this.audio) return;
      
      switch (data.action) {
        case 'play':
          // Adjust time before playing
          if (Math.abs(this.audio.currentTime - data.time) > 0.5) {
            this.audio.currentTime = data.time;
          }
          this.audio.play();
          break;
          
        case 'pause':
          this.audio.pause();
          break;
          
        case 'seek':
          this.audio.currentTime = data.time;
          break;
      }
    }
    
    private handleSyncMessage(data: any) {
      if (!this.audio) return;
      
      // Calculate time difference and adjust if needed
      const localTime = this.audio.currentTime;
      const peerTime = data.time;
      const diff = localTime - peerTime;
      
      // If difference is significant (more than 0.3 seconds)
      if (Math.abs(diff) > 0.3) {
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
        if (this.audio && !this.audio.paused) {
          this.webrtc.sendMessage({
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
    
    dispose() {
      this.stopSyncTimer();
      if (this.audio) {
        this.audio.pause();
        this.audio.src = '';
      }
    }
  }