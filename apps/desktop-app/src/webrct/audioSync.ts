import { io, Socket } from 'socket.io-client';

export class AudioSync {
    private socket: Socket;
    private audioContext: AudioContext | null = null;
    private audioBufferSource: AudioBufferSourceNode | null = null;
    private currentRoomId: string | null = null;
    private audioChunks: ArrayBuffer[] = [];
    private audioQueue: ArrayBuffer[] = [];
    private isPlaying: boolean = false;
    private chunkSize: number = 65536; // 64KB chunks for better playback
    private onAudioAvailableCallback: (() => void) | null = null;
    private audioElement: HTMLAudioElement | null = null;
    private mediaSource: MediaSource | null = null;
    private sourceBuffer: SourceBuffer | null = null;
    private pendingChunks: ArrayBuffer[] = [];
    private isSourceBufferReady: boolean = false;
    private isSender: boolean = false;
    private baseTimestamp: number | null = null;
    private startTime: number | null = null;
    private audioStartOffset: number = 0;
    private lastSyncTime: number = 0;
    private syncInterval: number = 5000; // Re-sync every 5 seconds
    private bufferAheadTime: number = 0.5; // Buffer ahead time in seconds
    private recalibrationCount: number = 0;
    private maxBufferSize: number = 5 * 1024 * 1024; // 5MB max buffer size
    
    constructor(signalingServer: string) {
        console.log("Creating AudioSync with server:", signalingServer);
        this.socket = io(signalingServer);
        this.setupSocketListeners();
        this.setupMediaSource();
    }

    private setupMediaSource(): void {
        // Check if MediaSource is supported
        if ('MediaSource' in window) {
            this.audioElement = new Audio();
            this.audioElement.autoplay = true;
            
            this.mediaSource = new MediaSource();
            const mediaSourceUrl = URL.createObjectURL(this.mediaSource);
            this.audioElement.src = mediaSourceUrl;
            
            // Increase buffer size for more stability
            if (this.mediaSource && this.mediaSource.readyState === 'open') {
                this.mediaSource.duration = 3600; // Set a long duration (1 hour)
            }
            
            this.mediaSource.addEventListener('sourceopen', () => {
                console.log('MediaSource opened');
                try {
                    // Set a long duration for buffering
                    if (this.mediaSource) {
                        this.mediaSource.duration = 3600; // 1 hour in seconds
                    }
                    
                    // Try different MIME types based on browser support
                    const mimeTypes = [
                        'audio/mpeg', // MP3
                        'audio/mp4; codecs="mp4a.40.2"', // AAC
                        'audio/webm; codecs="opus"' // WebM/Opus
                    ];
                    
                    let mimeTypeSupported = false;
                    
                    for (const mimeType of mimeTypes) {
                        if (MediaSource.isTypeSupported(mimeType)) {
                            if (this.mediaSource) {
                                this.sourceBuffer = this.mediaSource.addSourceBuffer(mimeType);
                                this.isSourceBufferReady = true;
                                mimeTypeSupported = true;
                                console.log(`Using MIME type: ${mimeType}`);
                                break;
                            }
                        }
                    }
                    
                    if (!mimeTypeSupported) {
                        console.warn('No supported MIME types found for MediaSource');
                        this.isSourceBufferReady = false;
                        return;
                    }
                    
                    if (this.sourceBuffer) {
                        // Set to sequence mode for better streaming support
                        this.sourceBuffer.mode = 'sequence';
                        
                        // Handle buffer full conditions
                        this.mediaSource?.addEventListener('error', (e) => {
                            console.error('MediaSource error:', e);
                            this.handleMediaError();
                        });
                        
                        this.sourceBuffer.addEventListener('error', (e) => {
                            console.error('SourceBuffer error:', e);
                            this.handleMediaError();
                        });
                        
                        this.sourceBuffer.addEventListener('updateend', () => {
                            this.appendNextChunk();
                            
                            // Check if we need to manage the buffer
                            this.manageBufferSize();
                        });
                        
                        // Start appending any chunks that arrived before the source buffer was ready
                        this.appendNextChunk();
                    }
                } catch (e) {
                    console.error('Error creating source buffer:', e);
                    // Fallback to the old method if we can't create a source buffer
                    this.isSourceBufferReady = false;
                }
            });
            
            // Set up audio element error handling
            if (this.audioElement) {
                this.audioElement.addEventListener('error', (e) => {
                    console.error('Audio element error:', e);
                    this.handleMediaError();
                });
                
                // Keep track of stalled and waiting events
                this.audioElement.addEventListener('stalled', () => {
                    console.warn('Audio playback stalled');
                    this.handleStalled();
                });
                
                this.audioElement.addEventListener('waiting', () => {
                    console.warn('Audio playback waiting for data');
                });
                
                // Monitor ended to handle potential restart
                this.audioElement.addEventListener('ended', () => {
                    console.log('Audio playback ended');
                    if (this.pendingChunks.length > 0) {
                        console.log('More chunks available, restarting playback');
                        this.audioElement?.play().catch(e => console.error('Error restarting audio:', e));
                    }
                });
            }
        }
    }
    
    private handleMediaError(): void {
        console.log('Handling media error, attempting recovery');
        
        if (this.mediaSource && this.sourceBuffer && this.mediaSource.readyState === 'open') {
            try {
                // Clear the buffer and try again
                if (!this.sourceBuffer.updating) {
                    this.sourceBuffer.remove(0, this.mediaSource.duration);
                    
                    // Reset our pending chunks to the most recent few
                    if (this.pendingChunks.length > 10) {
                        console.log('Trimming pending chunks queue for recovery');
                        this.pendingChunks = this.pendingChunks.slice(-10);
                    }
                }
            } catch (e) {
                console.error('Error during recovery:', e);
            }
        }
        
        // If we're using the audio element, try to recover
        if (this.audioElement) {
            try {
                // Try to play after a small delay
                setTimeout(() => {
                    this.audioElement?.play().catch(e => console.error('Error recovering audio playback:', e));
                }, 500);
            } catch (e) {
                console.error('Error recovering audio element:', e);
            }
        }
    }
    
    private handleStalled(): void {
        if (this.audioElement && this.audioElement.paused) {
            setTimeout(() => {
                console.log('Attempting to resume stalled playback');
                this.audioElement?.play().catch(e => console.error('Error resuming stalled playback:', e));
            }, 200);
        }
    }
    
    private manageBufferSize(): void {
        if (!this.sourceBuffer || this.sourceBuffer.updating) return;
        
        try {
            // If the buffer gets too large, remove some from the beginning
            if (this.sourceBuffer.buffered.length > 0) {
                const bufferStart = this.sourceBuffer.buffered.start(0);
                const bufferEnd = this.sourceBuffer.buffered.end(0);
                const bufferLength = bufferEnd - bufferStart;
                
                // If buffer is over 30 seconds and not currently playing from the beginning
                if (bufferLength > 30 && this.audioElement && 
                    this.audioElement.currentTime > bufferStart + 5) {
                    
                    const removeEnd = Math.min(
                        this.audioElement.currentTime - 2, // Keep 2 seconds before current position
                        bufferStart + (bufferLength / 2)   // Or remove half the buffer
                    );
                    
                    if (removeEnd > bufferStart) {
                        console.log(`Trimming buffer: ${bufferStart.toFixed(2)}s to ${removeEnd.toFixed(2)}s`);
                        this.sourceBuffer.remove(bufferStart, removeEnd);
                    }
                }
            }
        } catch (e) {
            console.error('Error managing buffer size:', e);
        }
    }

    private setupSocketListeners() {
        this.socket.on('connect', () => {
            console.log('Connected to signaling server, socket ID:', this.socket.id);
        });

        this.socket.on('room-joined', (roomId: string) => {
            console.log('Joined room:', roomId);
        });

        this.socket.on('user-joined', (userId: string) => {
            console.log('User joined:', userId);
        });

        this.socket.on('user-left', (userId: string) => {
            console.log('User left:', userId);
        });

        this.socket.on('audio-chunk', (data: { chunk: ArrayBuffer, timestamp: number }) => {
            if (!data || !data.chunk) {
                console.warn('Received invalid audio chunk');
                return;
            }
            
            console.log(`Received audio chunk, size: ${data.chunk.byteLength}, timestamp: ${data.timestamp}`);
            this.audioChunks.push(data.chunk);
            
            // Store the first timestamp as our base
            if (this.baseTimestamp === null && data.timestamp) {
                this.baseTimestamp = data.timestamp;
                this.startTime = Date.now();
                console.log(`Set base timestamp: ${this.baseTimestamp}`);
            }
            
            // Periodically perform full resynchronization
            if (Date.now() - this.lastSyncTime > this.syncInterval) {
                this.performFullSync(data.timestamp);
            }
            
            // If we're using the MediaSource API
            if (this.isSourceBufferReady && this.sourceBuffer && this.mediaSource) {
                this.pendingChunks.push(data.chunk);
                
                // Only append if buffer isn't updating
                if (!this.sourceBuffer.updating) {
                    this.appendNextChunk();
                }
                
                // Synchronize playback speed if needed
                if (this.audioElement && !this.isSender && this.baseTimestamp !== null) {
                    this.synchronizePlayback(data.timestamp);
                }
            } else {
                // Fallback to old method
                this.audioQueue.push(data.chunk);
                
                // Start playing if not already
                if (!this.isPlaying) {
                    this.playNextChunk();
                }
            }
            
            // Notify that audio is available
            if (this.onAudioAvailableCallback) {
                this.onAudioAvailableCallback();
            }
        });

        this.socket.on('disconnect', () => {
            console.log('Disconnected from signaling server');
        });

        this.socket.on('error', (error: any) => {
            console.error('Socket error:', error);
        });
    }
    
    private performFullSync(currentTimestamp: number): void {
        if (!this.audioElement || !this.baseTimestamp || !this.startTime) return;
        
        this.lastSyncTime = Date.now();
        
        // Every 5 minutes, do a full recalibration of base values
        if (++this.recalibrationCount >= 60) { // 60 * 5 seconds = 5 minutes
            this.recalibrationCount = 0;
            this.baseTimestamp = currentTimestamp;
            this.startTime = Date.now();
            console.log(`💫 Full recalibration - new base timestamp: ${this.baseTimestamp}`);
            return;
        }
        
        const expectedElapsedTime = currentTimestamp - this.baseTimestamp;
        const actualElapsedTime = Date.now() - this.startTime;
        const timeDiff = expectedElapsedTime - actualElapsedTime;
        
        // If more than 1 second out of sync, do a hard reset of playback position
        if (Math.abs(timeDiff) > 1000) {
            console.log(`🔄 Major sync issue detected: ${timeDiff}ms difference`);
            
            if (this.audioElement && this.sourceBuffer && this.sourceBuffer.buffered.length > 0) {
                // Calculate where we should be in the audio
                const estimatedCurrentTime = this.audioElement.currentTime + (timeDiff / 1000);
                
                // Check if the time we want to jump to is buffered
                const bufferedStart = this.sourceBuffer.buffered.start(0);
                const bufferedEnd = this.sourceBuffer.buffered.end(0);
                
                if (estimatedCurrentTime >= bufferedStart && estimatedCurrentTime <= bufferedEnd) {
                    console.log(`🎯 Performing hard sync - jumping from ${this.audioElement.currentTime.toFixed(2)}s to ${estimatedCurrentTime.toFixed(2)}s`);
                    this.audioElement.currentTime = estimatedCurrentTime;
                    
                    // Reset our sync base after a jump
                    this.baseTimestamp = currentTimestamp;
                    this.startTime = Date.now();
                } else {
                    console.log(`⚠️ Cannot jump to ${estimatedCurrentTime.toFixed(2)}s - outside buffered range ${bufferedStart.toFixed(2)}s - ${bufferedEnd.toFixed(2)}s`);
                    
                    // Still update our base to prevent further drift
                    this.baseTimestamp = currentTimestamp;
                    this.startTime = Date.now();
                }
            }
        }
    }
    
    // Synchronize playback speed
    private synchronizePlayback(currentTimestamp: number): void {
        if (!this.audioElement || !this.baseTimestamp || !this.startTime) return;
        
        const expectedElapsedTime = currentTimestamp - this.baseTimestamp;
        const actualElapsedTime = Date.now() - this.startTime;
        const timeDiff = expectedElapsedTime - actualElapsedTime;
        
        // If more than 50ms out of sync, adjust playback rate
        if (Math.abs(timeDiff) > 50) {
            // Calculate an appropriate playback rate with increasing sensitivity
            let newRate = 1.0;
            
            if (timeDiff > 0) {
                // We're behind, need to speed up (up to 1.25x)
                // More aggressive adjustment for larger differences
                const adjustment = Math.min(0.25, Math.abs(timeDiff) / 2000);
                newRate = 1.0 + adjustment;
            } else {
                // We're ahead, need to slow down (down to 0.8x)
                const adjustment = Math.min(0.20, Math.abs(timeDiff) / 2500);
                newRate = 1.0 - adjustment;
            }
            
            // Smoothly adjust rate for more natural sound (weighted average)
            const currentRate = this.audioElement.playbackRate || 1.0;
            
            // More aggressive smoothing for smaller differences
            const smoothFactor = Math.min(0.3, Math.abs(timeDiff) / 1000);
            const smoothedRate = (currentRate * (1 - smoothFactor)) + (newRate * smoothFactor);
            
            // Only update if there's a meaningful change
            if (Math.abs(smoothedRate - currentRate) > 0.01) {
                this.audioElement.playbackRate = smoothedRate;
                console.log(`⏩ Adjusting playback rate to ${smoothedRate.toFixed(3)} (time diff: ${timeDiff}ms)`);
            }
        }
    }
    
    private appendNextChunk(): void {
        if (!this.isSourceBufferReady || !this.sourceBuffer || this.pendingChunks.length === 0 || 
            this.sourceBuffer.updating) {
            return;
        }
        
        try {
            const chunk = this.pendingChunks.shift();
            if (chunk) {
                this.sourceBuffer.appendBuffer(chunk);
                
                // Try to play the audio element if it's not already playing
                if (this.audioElement && this.audioElement.paused) {
                    this.audioElement.play().catch(e => {
                        console.error('Error playing audio:', e);
                        // Try again after a short delay
                        setTimeout(() => {
                            this.audioElement?.play().catch(e2 => 
                                console.error('Retry play failed:', e2));
                        }, 300);
                    });
                }
            }
        } catch (e) {
            console.error('Error appending buffer:', e);
            
            // Check if it's a QuotaExceededError
            if (e instanceof DOMException && e.name === 'QuotaExceededError') {
                console.warn('Buffer full, removing older content');
                this.removeOldContent();
            } else {
                // For other errors, try the next chunk
                setTimeout(() => {
                    this.appendNextChunk();
                }, 100);
            }
        }
    }
    
    private removeOldContent(): void {
        if (!this.sourceBuffer || this.sourceBuffer.updating || !this.audioElement) return;
        
        try {
            if (this.sourceBuffer.buffered.length > 0) {
                const currentTime = this.audioElement.currentTime;
                const bufferStart = this.sourceBuffer.buffered.start(0);
                
                // If we have at least 5 seconds before the current time, remove some
                if (currentTime - bufferStart > 5) {
                    // Remove everything from the start to 2 seconds before current time
                    const removeEnd = currentTime - 2;
                    console.log(`🗑️ Removing buffer from ${bufferStart}s to ${removeEnd}s`);
                    this.sourceBuffer.remove(bufferStart, removeEnd);
                } else {
                    // We're close to the start, just remove a smaller portion
                    if (bufferStart < currentTime - 1) {
                        this.sourceBuffer.remove(bufferStart, currentTime - 1);
                    }
                }
            }
        } catch (e) {
            console.error('Error removing old content:', e);
        }
    }

    public async joinRoom(roomId: string): Promise<void> {
        this.currentRoomId = roomId;
        this.socket.emit('join-room', roomId);
        
        // Create audio context when joining a room
        if (!this.audioContext) {
            this.audioContext = new AudioContext();
        }
        
        // Reset sync variables
        this.baseTimestamp = null;
        this.startTime = null;
        this.lastSyncTime = 0;
        this.recalibrationCount = 0;
        
        return new Promise<void>((resolve) => {
            this.socket.once('room-joined', () => {
                console.log('Room join confirmed');
                resolve();
            });
        });
    }

    public async startStreamingAudioFile(file: File): Promise<void> {
        if (!this.currentRoomId) {
            throw new Error('Must join a room first');
        }

        this.isSender = true;
        
        // Create an audio element for the sender to hear the audio too
        const senderAudio = new Audio();
        senderAudio.src = URL.createObjectURL(file);
        senderAudio.loop = false;
        senderAudio.volume = 0.5; // Lower volume for sender
        
        // Wait for the audio to be loaded before playing
        try {
            await new Promise<void>((resolve, reject) => {
                senderAudio.oncanplaythrough = () => resolve();
                senderAudio.onerror = () => reject(new Error('Failed to load audio'));
                senderAudio.load();
            });
            
            // Start playing on the sender side
            await senderAudio.play();
            console.log('Playing audio locally on sender side');
            
            // Function to extract and send audio data
            const processFile = async () => {
                try {
                    const arrayBuffer = await this.readFileAsArrayBuffer(file);
                    const chunkSize = this.chunkSize;
                    const totalChunks = Math.ceil(arrayBuffer.byteLength / chunkSize);
                    console.log(`Processing file: ${file.name}, size: ${arrayBuffer.byteLength}, chunks: ${totalChunks}`);
                    
                    // Get the audio duration to calculate sending rate
                    const audioDuration = senderAudio.duration;
                    const bytesPerSecond = arrayBuffer.byteLength / audioDuration;
                    const chunkDuration = chunkSize / bytesPerSecond;
                    
                    // Send at real-time rate (no longer 0.9x)
                    const sendInterval = chunkDuration * 1000;
                    
                    console.log(`Audio duration: ${audioDuration}s, bytes/sec: ${bytesPerSecond}, chunk duration: ${chunkDuration}s, send interval: ${sendInterval}ms`);
                    
                    // Set the base timestamp for the first chunk
                    const startTimestamp = Date.now();
                    
                    // Process the file in chunks - add backpressure handling
                    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
                        const start = chunkIndex * chunkSize;
                        const end = Math.min(start + chunkSize, arrayBuffer.byteLength);
                        
                        // Get the chunk
                        const chunk = arrayBuffer.slice(start, end);
                        
                        // Calculate precise timestamp for this chunk based on position and start time
                        const chunkTimestamp = startTimestamp + (chunkIndex * chunkDuration * 1000);
                        
                        // Send the chunk with a timestamp
                        this.socket.emit('audio-chunk', {
                            roomId: this.currentRoomId,
                            chunk: chunk,
                            timestamp: chunkTimestamp
                        });
                        
                        // Wait before sending the next chunk - match exact audio timing
                        // Make sure we're not drifting by recalculating each time
                        const elapsedActual = Date.now() - startTimestamp;
                        const expectedTime = chunkIndex * chunkDuration * 1000;
                        const adjustedDelay = Math.max(0, sendInterval - (elapsedActual - expectedTime));
                        
                        if (chunkIndex % 10 === 0) {
                            console.log(`Chunk ${chunkIndex}/${totalChunks}, delay: ${adjustedDelay.toFixed(0)}ms`);
                        }
                        
                        await this.delay(adjustedDelay);
                    }
                    
                    console.log('Finished streaming audio file');
                } catch (error) {
                    console.error('Error processing audio file:', error);
                    throw error;
                }
            };
            
            // Start processing the file
            processFile();
            
        } catch (error) {
            console.error('Error streaming audio file:', error);
            throw error;
        }
    }

    private async readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = (event) => {
                if (event.target && event.target.result) {
                    resolve(event.target.result as ArrayBuffer);
                } else {
                    reject(new Error('Failed to read file'));
                }
            };
            
            reader.onerror = (error) => {
                reject(error);
            };
            
            reader.readAsArrayBuffer(file);
        });
    }

    private async playNextChunk(): Promise<void> {
        if (!this.audioContext) {
            console.warn('No audio context available');
            return;
        }

        // If there are no chunks to play, return
        if (this.audioQueue.length === 0) {
            this.isPlaying = false;
            return;
        }

        this.isPlaying = true;
        
        try {
            // Get the next chunk
            const chunk = this.audioQueue.shift()!;
            
            // Decode the audio data
            const audioBuffer = await this.audioContext.decodeAudioData(chunk);
            
            // Create a buffer source
            const source = this.audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(this.audioContext.destination);
            
            // When this chunk is done, play the next one
            source.onended = () => {
                this.playNextChunk();
            };
            
            // Start playing
            source.start(0);
            this.audioBufferSource = source;
        } catch (error) {
            console.error('Error playing audio chunk:', error);
            
            // Try the next chunk if there was an error
            this.playNextChunk();
        }
    }

    public onAudioAvailable(callback: () => void): void {
        this.onAudioAvailableCallback = callback;
    }

    public getAudioChunks(): ArrayBuffer[] {
        return this.audioChunks;
    }

    public getAudioElement(): HTMLAudioElement | null {
        return this.audioElement;
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    public disconnect(): void {
        // Stop any ongoing playback
        if (this.audioBufferSource) {
            try {
                this.audioBufferSource.stop();
                this.audioBufferSource.disconnect();
            } catch (e) {
                // Ignore errors on cleanup
            }
            this.audioBufferSource = null;
        }
        
        // Clean up audio element
        if (this.audioElement) {
            this.audioElement.pause();
            this.audioElement.src = '';
            this.audioElement = null;
        }
        
        // Clean up MediaSource
        if (this.mediaSource && this.mediaSource.readyState === 'open') {
            try {
                this.mediaSource.endOfStream();
            } catch (e) {
                // Ignore errors on cleanup
            }
        }
        this.mediaSource = null;
        this.sourceBuffer = null;
        
        // Close audio context
        if (this.audioContext) {
            try {
                this.audioContext.close();
            } catch (e) {
                // Ignore errors on cleanup
            }
            this.audioContext = null;
        }
        
        // Clear audio data
        this.audioChunks = [];
        this.audioQueue = [];
        this.pendingChunks = [];
        this.isPlaying = false;
        this.isSourceBufferReady = false;
        this.baseTimestamp = null;
        this.startTime = null;
        this.lastSyncTime = 0;
        this.recalibrationCount = 0;
        
        // Disconnect socket
        if (this.socket) {
            this.socket.disconnect();
        }
    }
}


