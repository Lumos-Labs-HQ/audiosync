export class AudioSync {
    private webrtc: any;
    private isHostUser: boolean = false;
    
    // Audio resources
    private audioContext: AudioContext | null = null;
    private audioBuffer: AudioBuffer | null = null;
    private sourceNode: AudioBufferSourceNode | null = null;
    private gainNode: GainNode | null = null;
    private analyserNode: AnalyserNode | null = null;
    
    // Audio file and streaming state
    private currentFile: File | null = null;
    private isPlaying: boolean = false;
    private startTime: number = 0;
    private pausedAt: number = 0;
    
    // Streaming configuration
    private readonly chunkDuration: number = 250; // ms per chunk
    private readonly preBufferCount: number = 5; // Number of chunks to buffer before playing
    private readonly syncInterval: number = 1000; // Sync timing every 1 second (reduced from 2s)
    private syncTimer: number | null = null;
    
    // Chunking and buffering
    private audioChunks: Map<number, AudioBuffer> = new Map();
    private receivedChunks: Map<number, ArrayBuffer> = new Map();
    private nextChunkToPlay: number = 0;
    private chunkSequence: number = 0;
    private scheduledChunks: Set<number> = new Set();
    
    // Sync state
    private hostStartTimestamp: number = 0;
    private hostStartPosition: number = 0;
    private autoPlayAfterSyncReceived: boolean = true;
    
    // Improved chunk handling on the receiver side
    private waitingForChunk: number | null = null;
    private lastChunkEndTime: number = 0;
    
    // Pre-generated chunks
    private preprocessedChunks: Map<number, AudioBuffer> | null = null;
    
    // Track the highest chunk sequence number received
    private highestReceivedChunk: number = -1;
    
    // Set up inactive timer to detect when streaming has stopped
    private inactiveTimer: any = null;
    private inactiveTimeout: number = 5000; // 5 seconds (reduced from 10s)
    
    // Track if initial sync has been performed
    private hasDoneInitialSync: boolean = false;
    
    // Sync tolerance threshold - if diff is greater than this, we resync completely
    private syncTolerance: number = 0.3; // 300ms tolerance
    
    constructor(webrtc: any) {
      this.webrtc = webrtc;
      this.initAudioContext();
    }
    
    private initAudioContext() {
      try {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
          latencyHint: 'interactive',
          sampleRate: 44100
        });
        
        this.gainNode = this.audioContext.createGain();
        this.gainNode.gain.value = 1.0;
        
        this.analyserNode = this.audioContext.createAnalyser();
        this.analyserNode.fftSize = 2048;
        
        this.gainNode.connect(this.analyserNode);
        this.analyserNode.connect(this.audioContext.destination);
        
        if (this.audioContext.state === 'suspended') {
          const silentBuffer = this.audioContext.createBuffer(1, 1, 22050);
          const silentSource = this.audioContext.createBufferSource();
          silentSource.buffer = silentBuffer;
          silentSource.connect(this.audioContext.destination);
          silentSource.start();
          
          this.audioContext.resume().catch(err => {
            console.warn("Couldn't resume audio context:", err);
          });
        }
      } catch(e) {
        console.error("AudioContext could not be created:", e);
      }
    }
    
    async loadLocalAudio(file: File) {
      if (!this.audioContext) return;
      
      try {
        if (this.audioContext.state === 'suspended') {
          await this.audioContext.resume();
        }
        
        this.currentFile = file;
        this.resetStreamingState();
        
        const arrayBuffer = await file.arrayBuffer();
        this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
        
        if (this.isHostUser) {
          this.webrtc.broadcastMessage({
            type: 'stream-info',
            name: file.name,
            duration: this.audioBuffer.duration,
            chunkDuration: this.chunkDuration,
            sampleRate: this.audioBuffer.sampleRate,
            channels: this.audioBuffer.numberOfChannels
          });
          
          this.preprocessAudioChunks();
        }
      } catch (error) {
        console.error('Error loading audio file:', error);
      }
    }
    
    private preprocessAudioChunks() {
      if (!this.audioBuffer || !this.isHostUser) return;
      
      if (this.preprocessedChunks) return;
      
      const totalDuration = this.audioBuffer.duration;
      const secondsPerChunk = this.chunkDuration / 1000;
      const totalChunks = Math.ceil(totalDuration / secondsPerChunk);
      
      this.preprocessedChunks = new Map();
      
      for (let i = 0; i < totalChunks; i++) {
        const position = i * secondsPerChunk;
        const chunk = this.createAudioChunk(position, secondsPerChunk);
        if (chunk) {
          this.preprocessedChunks.set(i, chunk);
        }
      }
    }
    
    private resetStreamingState() {
      this.stopPlayback();
      
      if (this.isHostUser) {
        this.audioChunks.clear();
        this.receivedChunks.clear();
      }
      
      this.nextChunkToPlay = 0;
      this.chunkSequence = 0;
      this.scheduledChunks.clear();
      this.startTime = 0;
      this.pausedAt = 0;
      this.waitingForChunk = null;
      this.lastChunkEndTime = 0;
      this.hasDoneInitialSync = false;
      
      if (this.inactiveTimer) {
        clearTimeout(this.inactiveTimer);
        this.inactiveTimer = null;
      }
    }
    
    play() {
      if (!this.audioContext || !this.audioBuffer || this.isPlaying) return;
      
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }
      
      this.isPlaying = true;
      
      if (this.isHostUser) {
        if (this.pausedAt > 0) {
          this.startTime = this.audioContext.currentTime - this.pausedAt;
        } else {
          this.startTime = this.audioContext.currentTime;
        }
        
        this.webrtc.broadcastMessage({
          type: 'control',
          action: 'play',
          startTime: Date.now(),
          position: this.pausedAt,
          sampleRate: this.audioBuffer.sampleRate,
          duration: this.audioBuffer.duration
        });
        
        this.playAudioFromBuffer(this.audioBuffer, this.pausedAt);
        this.startStreamingChunks();
        this.startSyncTimer();
      } else {
        if (this.audioChunks.size >= this.preBufferCount) {
          this.startClientPlayback(Math.min(...Array.from(this.audioChunks.keys())));
        } else {
          this.autoPlayAfterSyncReceived = true;
        }
      }
    }
    
    private startSyncTimer() {
      if (!this.isHostUser || this.syncTimer) return;
      
      this.sendSyncInfo();
      
      this.syncTimer = window.setInterval(() => {
        this.sendSyncInfo();
      }, this.syncInterval);
    }
    
    private sendSyncInfo() {
      if (!this.isPlaying || !this.audioContext) return;
      
      const currentPosition = this.pausedAt + (this.audioContext.currentTime - this.startTime);
      const secondsPerChunk = this.chunkDuration / 1000;
      const currentChunk = Math.floor(currentPosition / secondsPerChunk);
      
      this.webrtc.broadcastMessage({
        type: 'control',
        action: 'sync',
        position: currentPosition,
        chunk: currentChunk,
        timestamp: Date.now(),
        playbackRate: 1.0
      });
    }
    
    private startStreamingChunks() {
      if (!this.audioContext || !this.audioBuffer || !this.isHostUser || !this.isPlaying) {
        return;
      }
      
      this.preprocessAudioChunks();
      
      const totalDuration = this.audioBuffer.duration;
      const secondsPerChunk = this.chunkDuration / 1000;
      
      let position = this.pausedAt;
      
      const sendNextChunk = () => {
        if (!this.isPlaying) return;
        
        if (position < totalDuration) {
          const sequence = Math.floor(position / secondsPerChunk);
          
          if (this.preprocessedChunks && this.preprocessedChunks.has(sequence)) {
            const chunk = this.preprocessedChunks.get(sequence)!;
            this.sendAudioChunk(chunk, sequence, position);
          } else {
            const chunk = this.createAudioChunk(position, secondsPerChunk);
            if (chunk) {
              this.sendAudioChunk(chunk, sequence, position);
            }
          }
          
          position += secondsPerChunk;
          
          setTimeout(sendNextChunk, this.chunkDuration / 2);
        } else {
          this.webrtc.broadcastMessage({
            type: 'stream-end'
          });
        }
      };
      
      // Send initial chunks more rapidly to build buffer
      for (let i = 0; i < this.preBufferCount; i++) {
        if (position < totalDuration) {
          const sequence = Math.floor(position / secondsPerChunk);
          
          if (this.preprocessedChunks && this.preprocessedChunks.has(sequence)) {
            const chunk = this.preprocessedChunks.get(sequence)!;
            this.sendAudioChunk(chunk, sequence, position);
          } else {
            const chunk = this.createAudioChunk(position, secondsPerChunk);
            if (chunk) {
              this.sendAudioChunk(chunk, sequence, position);
            }
          }
          
          position += secondsPerChunk;
        }
      }
      
      setTimeout(sendNextChunk, this.chunkDuration / 2);
    }
    
    private createAudioChunk(startPosition: number, duration: number): AudioBuffer | null {
      if (!this.audioContext || !this.audioBuffer) return null;
      
      const sampleRate = this.audioBuffer.sampleRate;
      const startSample = Math.floor(startPosition * sampleRate);
      const chunkSamples = Math.min(
        Math.ceil(duration * sampleRate),
        this.audioBuffer.length - startSample
      );
      
      if (chunkSamples <= 0) return null;
      
      try {
        const chunkBuffer = this.audioContext.createBuffer(
          this.audioBuffer.numberOfChannels,
          chunkSamples,
          sampleRate
        );
        
        for (let channel = 0; channel < this.audioBuffer.numberOfChannels; channel++) {
          const channelData = this.audioBuffer.getChannelData(channel);
          const chunkChannelData = chunkBuffer.getChannelData(channel);
          
          for (let i = 0; i < chunkSamples; i++) {
            if (startSample + i < channelData.length) {
              chunkChannelData[i] = channelData[startSample + i];
            }
          }
        }
        
        return chunkBuffer;
      } catch (e) {
        console.error("Error creating audio chunk:", e);
        return null;
      }
    }
    
    private sendAudioChunk(audioBuffer: AudioBuffer, sequence: number, position: number) {
      this.audioBufferToWav(audioBuffer).then(blob => {
        this.webrtc.broadcastBinary(blob, {
          type: 'audio-chunk',
          sequence: sequence,
          position: position,
          duration: audioBuffer.duration,
          sampleRate: audioBuffer.sampleRate,
          format: 'wav',
          timestamp: Date.now()
        });
      });
    }
    
    private async audioBufferToWav(audioBuffer: AudioBuffer): Promise<Blob> {
      return new Promise((resolve) => {
        const numberOfChannels = audioBuffer.numberOfChannels;
        const length = audioBuffer.length * numberOfChannels * 2;
        const sampleRate = audioBuffer.sampleRate;
        
        const wavHeader = new ArrayBuffer(44);
        const view = new DataView(wavHeader);
        
        this.writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + length, true);
        this.writeString(view, 8, 'WAVE');
        this.writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, numberOfChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * numberOfChannels * 2, true);
        view.setUint16(32, numberOfChannels * 2, true);
        view.setUint16(34, 16, true);
        this.writeString(view, 36, 'data');
        view.setUint32(40, length, true);
        
        const audioData = new ArrayBuffer(length);
        const audioView = new DataView(audioData);
        let offset = 0;
        
        for (let i = 0; i < audioBuffer.length; i++) {
          for (let channel = 0; channel < numberOfChannels; channel++) {
            const sample = audioBuffer.getChannelData(channel)[i];
            const sample16bit = Math.max(-1, Math.min(1, sample)) * 0x7FFF;
            audioView.setInt16(offset, sample16bit, true);
            offset += 2;
          }
        }
        
        const wavBuffer = new Uint8Array(wavHeader.byteLength + audioData.byteLength);
        wavBuffer.set(new Uint8Array(wavHeader), 0);
        wavBuffer.set(new Uint8Array(audioData), wavHeader.byteLength);
        
        resolve(new Blob([wavBuffer], { type: 'audio/wav' }));
      });
    }
    
    private writeString(view: DataView, offset: number, string: string) {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    }
    
    private playAudioFromBuffer(buffer: AudioBuffer, offset: number = 0) {
      if (!this.audioContext) return;
      
      try {
        if (this.sourceNode) {
          this.sourceNode.stop();
          this.sourceNode.disconnect();
          this.sourceNode = null;
        }
        
        this.sourceNode = this.audioContext.createBufferSource();
        this.sourceNode.buffer = buffer;
        this.sourceNode.playbackRate.value = 1.0;
        
        if (this.gainNode) {
          this.sourceNode.connect(this.gainNode);
        } else {
          this.sourceNode.connect(this.audioContext.destination);
        }
        
        this.sourceNode.onended = () => {
          this.isPlaying = false;
          this.pausedAt = 0;
          this.sourceNode = null;
          
          if (this.preprocessedChunks) {
            this.preprocessedChunks.clear();
            this.preprocessedChunks = null;
          }
        };
        
        const duration = buffer.duration - offset;
        this.sourceNode.start(0, offset, duration);
      } catch (err) {
        console.error("Error playing audio:", err);
      }
    }
    
    handleAudioChunk(blob: Blob, metadata: any) {
      if (!metadata || !blob) return;
      
      this.resetInactiveTimer();
      
      blob.arrayBuffer().then(arrayBuffer => {
        this.receivedChunks.set(metadata.sequence, arrayBuffer);
        
        if (metadata.sequence > this.highestReceivedChunk) {
          this.highestReceivedChunk = metadata.sequence;
        }
        
        if (this.audioContext) {
          this.audioContext.decodeAudioData(arrayBuffer)
            .then(audioBuffer => {
              this.audioChunks.set(metadata.sequence, audioBuffer);
              
              if (!this.isPlaying && this.autoPlayAfterSyncReceived && 
                  this.audioChunks.size >= this.preBufferCount) {
                const firstChunk = Math.min(...Array.from(this.audioChunks.keys()));
                this.startClientPlayback(firstChunk);
              }
              
              if (this.isPlaying && this.waitingForChunk === metadata.sequence) {
                this.waitingForChunk = null;
                this.scheduleChunksAhead(5);
              }
            })
            .catch(err => {
              console.error(`Error decoding chunk ${metadata.sequence}:`, err);
            });
        }
      }).catch(err => {
        console.error("Error processing audio chunk:", err);
      });
    }
    
    private resetInactiveTimer() {
      if (this.inactiveTimer) {
        clearTimeout(this.inactiveTimer);
        this.inactiveTimer = null;
      }
      
      if (!this.isHostUser && this.isPlaying) {
        this.inactiveTimer = setTimeout(() => {
          // Request any missing chunks we need soon
          for (let i = 0; i < 10; i++) {
            const sequence = this.nextChunkToPlay + i;
            if (!this.audioChunks.has(sequence) && sequence <= this.highestReceivedChunk) {
              this.requestChunk(sequence);
            }
          }
          
          if (this.nextChunkToPlay > this.highestReceivedChunk) {
            setTimeout(() => {
              if (this.isPlaying && this.nextChunkToPlay > this.highestReceivedChunk) {
                this.isPlaying = false;
                if (this.sourceNode) {
                  try {
                    this.sourceNode.stop();
                    this.sourceNode.disconnect();
                  } catch (e) {
                  }
                  this.sourceNode = null;
                }
              }
            }, 2000);
          }
          
          this.inactiveTimer = null;
          this.resetInactiveTimer();
        }, this.inactiveTimeout);
      }
    }
    
    private requestChunk(sequence: number) {
      if (!this.isPlaying) return;
      
      this.webrtc.broadcastMessage({
        type: 'request-chunk',
        sequence: sequence,
        timestamp: Date.now()
      });
    }
    
    private createSilentChunk(duration: number): AudioBuffer | null {
      if (!this.audioContext || !this.audioBuffer) return null;
      const sampleRate = this.audioBuffer.sampleRate;
      const chunkSamples = Math.ceil(duration * sampleRate);
      try {
        const silentBuffer = this.audioContext.createBuffer(
          this.audioBuffer.numberOfChannels,
          chunkSamples,
          sampleRate
        );
        return silentBuffer;
      } catch (e) {
        console.error("Error creating silent chunk:", e);
        return null;
      }
    }
    
    private startClientPlayback(startSequence: number) {
      if (!this.audioContext) return;
      if (this.isPlaying) {
        this.stopPlayback();
      }
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(err => {
          console.error("Failed to resume audio context:", err);
        });
      }
      this.isPlaying = true;
      this.nextChunkToPlay = startSequence;
      this.scheduledChunks.clear();
      this.waitingForChunk = null;
      this.lastChunkEndTime = 0;
      this.hasDoneInitialSync = false;
      this.resetInactiveTimer();
      this.scheduleChunksAhead(5);
      this.setupSyncCheck();
    }

    private scheduleChunksAhead(count: number) {
      if (!this.audioContext || !this.isPlaying) return;
      const secondsPerChunk = this.chunkDuration / 1000;
      let scheduleTime = Math.max(this.audioContext.currentTime, this.lastChunkEndTime);
      
      for (let i = 0; i < count; i++) {
        const seq = this.nextChunkToPlay + i;
        if (this.scheduledChunks.has(seq)) continue;
        
        let chunk: AudioBuffer | undefined = this.audioChunks.get(seq);
        if (!chunk) {
          chunk = this.createSilentChunk(secondsPerChunk) || undefined;
          this.requestChunk(seq);
          this.waitingForChunk = seq;
        }
        
        if (chunk) {
          const source = this.audioContext.createBufferSource();
          source.buffer = chunk;
          source.playbackRate.value = 1.0;
          
          if (this.gainNode) {
            source.connect(this.gainNode);
          } else {
            source.connect(this.audioContext.destination);
          }
          
          source.start(scheduleTime);
          
          const currentSeq = seq;
          source.onended = () => {
            this.scheduledChunks.delete(currentSeq);
            if (currentSeq === this.nextChunkToPlay) {
              this.nextChunkToPlay++;
              this.scheduleChunksAhead(1);
            }
            
            // Clean up old chunks to save memory
            const minChunkToKeep = Math.max(0, currentSeq - 3);
            for (const s of Array.from(this.audioChunks.keys())) {
              if (s < minChunkToKeep) {
                this.audioChunks.delete(s);
                this.receivedChunks.delete(s);
              }
            }
            
            this.resetInactiveTimer();
          };
          
          this.scheduledChunks.add(seq);
          scheduleTime += chunk.duration;
          this.lastChunkEndTime = scheduleTime;
        }
      }
    }
    
    private setupSyncCheck() {
      if (this.isHostUser || !this.isPlaying) return;
      
      // More frequent sync checks - now every 1 second instead of 2
      const checkInterval = 1000; 
      
      const checkSync = () => {
        if (!this.isPlaying) return;
        
        this.webrtc.broadcastMessage({
          type: 'sync-request',
          clientTime: Date.now()
        });
        
        setTimeout(checkSync, checkInterval);
      };
      
      setTimeout(checkSync, checkInterval);
    }
    
    handleControlMessage(data: any) {
      if (!data || !data.action) return;
      
      switch (data.action) {
        case 'play':
          this.hostStartTimestamp = data.startTime;
          this.hostStartPosition = data.position || 0;
          
          if (this.isHostUser) {
            if (!this.isPlaying) {
              this.play();
            }
          } else {
            if (this.audioChunks.size >= this.preBufferCount) {
              this.startClientPlayback(Math.min(...Array.from(this.audioChunks.keys())));
            } else {
              this.autoPlayAfterSyncReceived = true;
            }
          }
          break;
          
        case 'pause':
          this.pause();
          break;
          
        case 'sync':
          if (!this.isHostUser && this.isPlaying && this.audioContext) {
            const hostPosition = data.position;
            const hostChunk = data.chunk;
            const hostTimestamp = data.timestamp;
            
            // Calculate time passed since host sent sync message
            const timeSinceSync = (Date.now() - hostTimestamp) / 1000;
            // Adjust host position based on time elapsed since the message was sent
            const adjustedHostPosition = hostPosition + timeSinceSync;
            // Get current client playback position
            const clientPosition = this.getCurrentPosition();
            // Calculate difference between host and client positions
            const positionDiff = adjustedHostPosition - clientPosition;
            
            // Check if we're out of sync beyond our tolerance threshold
            if (Math.abs(positionDiff) > this.syncTolerance) {
              console.log(`Out of sync: ${positionDiff.toFixed(3)}s, resetting playback to match host`);
              
              // Calculate the target chunk based on host's current position
              const secondsPerChunk = this.chunkDuration / 1000;
              const targetChunk = Math.floor(adjustedHostPosition / secondsPerChunk);
              
              // Completely stop current playback and reset
              this.stopPlayback();
              this.isPlaying = true;
              this.nextChunkToPlay = targetChunk;
              this.waitingForChunk = null;
              this.lastChunkEndTime = 0;
              this.scheduledChunks.clear();
              
              // Schedule new chunks from the correct position
              this.scheduleChunksAhead(10);
              this.hasDoneInitialSync = true;
            } 
            // If we're just slightly off, adjust playback rate to catch up/slow down
            else if (Math.abs(positionDiff) > 0.05 && this.sourceNode) {
              if (positionDiff > 0) {
                // Client is behind, speed up to catch up (at most 5% faster)
                this.sourceNode.playbackRate.value = 1.0 + Math.min(0.05, positionDiff);
              } else {
                // Client is ahead, slow down (at most 5% slower)
                this.sourceNode.playbackRate.value = 1.0 - Math.min(0.05, Math.abs(positionDiff));
              }
              
              // Reset to normal speed after adjustment
              setTimeout(() => {
                if (this.sourceNode) this.sourceNode.playbackRate.value = 1.0;
              }, 1000);
            } 
            // If we're very close to sync, ensure normal playback rate
            else if (this.sourceNode && this.sourceNode.playbackRate.value !== 1.0) {
              this.sourceNode.playbackRate.value = 1.0;
            }
          }
          break;
          
        case 'seek':
          this.pause();
          if (this.audioChunks.size > 0) {
            const secondsPerChunk = this.chunkDuration / 1000;
            const targetChunk = Math.floor(data.position / secondsPerChunk);
            const availableChunks = Array.from(this.audioChunks.keys());
            const closestChunk = availableChunks.reduce((prev, curr) => 
              Math.abs(curr - targetChunk) < Math.abs(prev - targetChunk) ? curr : prev
            );
            this.startClientPlayback(closestChunk);
          }
          break;
      }
    }
    
    handlePeerMessage(data: any) {
      if (!data || !data.type) return;
      
      switch (data.type) {
        case 'stream-info':
          this.resetStreamingState();
          
          if (!this.isHostUser) {
            this.autoPlayAfterSyncReceived = true;
            this.highestReceivedChunk = -1;
          }
          break;
          
        case 'control':
          this.handleControlMessage(data);
          break;
          
        case 'audio-chunk':
          if (!this.isHostUser) {
            if (data.blob) {
              this.handleAudioChunk(data.blob, data);
            } else if (data.binary) {
              this.handleAudioChunk(data.binary, data);
            }
          }
          break;
          
        case 'request-chunk':
          if (this.isHostUser && this.audioBuffer) {
            const sequence = data.sequence;
            const secondsPerChunk = this.chunkDuration / 1000;
            const position = sequence * secondsPerChunk;
            
            if (position < this.audioBuffer.duration) {
              if (this.preprocessedChunks && this.preprocessedChunks.has(sequence)) {
                const chunk = this.preprocessedChunks.get(sequence)!;
                this.sendAudioChunk(chunk, sequence, position);
              } else {
                const chunk = this.createAudioChunk(position, secondsPerChunk);
                if (chunk) {
                  this.sendAudioChunk(chunk, sequence, position);
                }
              }
            } else {
              this.webrtc.broadcastMessage({
                type: 'stream-end',
                finalChunk: Math.ceil(this.audioBuffer.duration / (this.chunkDuration / 1000)) - 1
              });
            }
          }
          break;
          
        case 'chunk-unavailable':
          if (!this.isHostUser && this.isPlaying) {
            if (this.waitingForChunk === data.sequence) {
              this.waitingForChunk = null;
              this.nextChunkToPlay = data.sequence + 1;
              this.scheduleChunksAhead(5);
            }
          }
          break;
          
        case 'sync-request':
          if (this.isHostUser && this.isPlaying && this.audioContext) {
            const currentPosition = this.pausedAt + (this.audioContext.currentTime - this.startTime);
            const secondsPerChunk = this.chunkDuration / 1000;
            const currentChunk = Math.floor(currentPosition / secondsPerChunk);
            
            this.webrtc.broadcastMessage({
              type: 'sync-response',
              requestTime: data.clientTime,
              responseTime: Date.now(),
              position: currentPosition,
              chunk: currentChunk
            });
          }
          break;
          
        case 'sync-response':
          if (!this.isHostUser && this.isPlaying && this.audioContext) {
            const hostPosition = data.position;
            const hostChunk = data.chunk;
            
            // Calculate round-trip time and estimate one-way latency
            const rtt = Date.now() - data.requestTime;
            // Adjust host position to compensate for network latency (half RTT)
            const adjustedHostPosition = hostPosition + (rtt / 2000);
            const clientPosition = this.getCurrentPosition();
            const positionDiff = adjustedHostPosition - clientPosition;
            
            // If we're significantly out of sync (more than 0.3 seconds), reset playback completely
            if (Math.abs(positionDiff) > this.syncTolerance) {
              console.log(`Out of sync by ${positionDiff.toFixed(3)}s, jumping to host position`);
              
              const secondsPerChunk = this.chunkDuration / 1000;
              const targetChunk = Math.floor(adjustedHostPosition / secondsPerChunk);
              
              this.stopPlayback();
              this.isPlaying = true;
              this.nextChunkToPlay = targetChunk;
              this.waitingForChunk = null;
              this.lastChunkEndTime = 0;
              
              // Schedule more chunks to ensure smooth playback
              this.scheduleChunksAhead(10);
            }
          }
          break;
          
        case 'stream-end':
          if (data.finalChunk !== undefined && data.finalChunk > this.highestReceivedChunk) {
            this.highestReceivedChunk = data.finalChunk;
          }
          
          if (!this.isHostUser) {
            if (this.nextChunkToPlay > this.highestReceivedChunk) {
              this.stopPlayback();
            }
          }
          break;
      }
    }
    
    setIsHost(isHost: boolean) {
      this.isHostUser = isHost;
    }
    
    getCurrentPosition(): number {
      if (!this.audioContext || !this.isPlaying) return this.pausedAt;
      
      if (this.isHostUser) {
        return this.pausedAt + (this.audioContext.currentTime - this.startTime);
      } else {
        const secondsPerChunk = this.chunkDuration / 1000;
        return this.nextChunkToPlay * secondsPerChunk;
      }
    }
    
    private stopPlayback() {
      if (this.sourceNode) {
        try {
          this.sourceNode.stop();
          this.sourceNode.disconnect();
        } catch (e) {
        }
        this.sourceNode = null;
      }
      
      if (this.audioContext) {
        try {
          this.gainNode?.disconnect();
          setTimeout(() => {
            if (this.gainNode && this.analyserNode && this.audioContext) {
              this.gainNode.connect(this.analyserNode);
              this.analyserNode.connect(this.audioContext.destination);
            }
          }, 10);
        } catch (e) {
          console.error("Error stopping audio:", e);
        }
      }
      
      this.isPlaying = false;
      this.scheduledChunks.clear();
      
      if (this.syncTimer) {
        clearInterval(this.syncTimer);
        this.syncTimer = null;
      }
      
      if (this.audioContext) {
        this.pausedAt = this.pausedAt + (this.audioContext.currentTime - this.startTime);
      }
    }
    
    dispose() {
      this.stopPlayback();
      
      if (this.sourceNode) {
        this.sourceNode.disconnect();
        this.sourceNode = null;
      }
      
      if (this.gainNode) {
        this.gainNode.disconnect();
        this.gainNode = null;
      }
      
      if (this.analyserNode) {
        this.analyserNode.disconnect();
        this.analyserNode = null;
      }
      
      if (this.audioContext && this.audioContext.state !== 'closed') {
        this.audioContext.close().catch(e => console.error("Error closing AudioContext:", e));
        this.audioContext = null;
      }
      
      this.audioChunks.clear();
      this.receivedChunks.clear();
      this.scheduledChunks.clear();
      this.currentFile = null;
      this.audioBuffer = null;
    }
    
    pause() {
      if (!this.isPlaying) return;
      
      if (this.sourceNode) {
        try {
          this.sourceNode.stop();
          this.sourceNode.disconnect();
        } catch (e) {
        }
        this.sourceNode = null;
      }
      
      this.isPlaying = false;
      
      if (this.syncTimer) {
        clearInterval(this.syncTimer);
        this.syncTimer = null;
      }
      
      if (this.isHostUser) {
        this.webrtc.broadcastMessage({
          type: 'control',
          action: 'pause',
          position: this.pausedAt
        });
      }
    }
    
    seek(position: number) {
      if (!this.audioContext || !this.audioBuffer) return;
      
      const wasPlaying = this.isPlaying;
      
      if (this.sourceNode) {
        try {
          this.sourceNode.stop();
          this.sourceNode.disconnect();
        } catch (e) {
        }
        this.sourceNode = null;
      }
      
      this.pausedAt = Math.max(0, Math.min(position, this.audioBuffer.duration));
      
      if (this.isHostUser) {
        this.resetStreamingState();
        this.pausedAt = position;
        
        this.webrtc.broadcastMessage({
          type: 'control',
          action: 'seek',
          position: position
        });
        
        if (wasPlaying) {
          this.play();
        }
      }
    }
}