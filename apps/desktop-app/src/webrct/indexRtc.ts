export class WebRTCClient {
    private connection: RTCPeerConnection | null = null;
    private dataChannel: RTCDataChannel | null = null;
    private ws: WebSocket | null = null;
    private clientId: string;
    private onMessageCallback: (data: any) => void;
    private fileTransfers: Map<string, {
      chunks: Array<ArrayBuffer>,
      metadata: any,
      receivedChunks: number
    }> = new Map();
    private pendingFiles: Array<{file: File, index: number}> = [];
    private isConnected: boolean = false;
  
    constructor(clientId: string, onMessage: (data: any) => void) {
      this.clientId = clientId;
      this.onMessageCallback = onMessage;
    }
  
    connect(serverUrl: string = 'ws://localhost:3001') {
      this.ws = new WebSocket(serverUrl);
      
      this.ws.onopen = () => {
        this.register();
        console.log('Connected to signaling server');
      };
      
      this.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        switch (data.type) {
          case 'offer':
            this.handleOffer(data.from, data.payload);
            break;
          case 'answer':
            this.handleAnswer(data.payload);
            break;
          case 'candidate':
            this.handleCandidate(data.payload);
            break;
          default:
            console.log('Unknown message type:', data.type);
        }
      };
      
      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
      
      this.ws.onclose = () => {
        console.log('WebSocket connection closed');
      };
    }
    
    private register() {
      if (this.ws) {
        this.ws.send(JSON.stringify({
          type: 'register',
          from: this.clientId
        }));
      }
    }
    
    createOffer(targetId: string) {
      this.connection = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
      
      this.setupPeerConnectionListeners(targetId);
      
      this.dataChannel = this.connection.createDataChannel('audioSync');
      this.setupDataChannel();
      
      this.connection.createOffer()
        .then(offer => this.connection!.setLocalDescription(offer))
        .then(() => {
          if (this.ws && this.connection?.localDescription) {
            this.ws.send(JSON.stringify({
              type: 'offer',
              from: this.clientId,
              to: targetId,
              payload: this.connection.localDescription
            }));
          }
        })
        .catch(error => console.error('Error creating offer:', error));
    }
    
    private handleOffer(fromId: string, offer: RTCSessionDescriptionInit) {
      this.connection = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
      
      this.setupPeerConnectionListeners(fromId);
      
      this.connection.ondatachannel = (event) => {
        this.dataChannel = event.channel;
        this.setupDataChannel();
      };
      
      this.connection.setRemoteDescription(new RTCSessionDescription(offer))
        .then(() => this.connection!.createAnswer())
        .then(answer => this.connection!.setLocalDescription(answer))
        .then(() => {
          if (this.ws && this.connection?.localDescription) {
            this.ws.send(JSON.stringify({
              type: 'answer',
              from: this.clientId,
              to: fromId,
              payload: this.connection.localDescription
            }));
          }
        })
        .catch(error => console.error('Error handling offer:', error));
    }
    
    private handleAnswer(answer: RTCSessionDescriptionInit) {
      if (this.connection) {
        this.connection.setRemoteDescription(new RTCSessionDescription(answer))
          .catch(error => console.error('Error setting remote description:', error));
      }
    }
    
    private handleCandidate(candidate: RTCIceCandidateInit) {
      if (this.connection) {
        this.connection.addIceCandidate(new RTCIceCandidate(candidate))
          .catch(error => console.error('Error adding ICE candidate:', error));
      }
    }
    
    private setupPeerConnectionListeners(peerId: string) {
      if (!this.connection) return;
      
      this.connection.onicecandidate = (event) => {
        if (event.candidate && this.ws) {
          this.ws.send(JSON.stringify({
            type: 'candidate',
            from: this.clientId,
            to: peerId,
            payload: event.candidate
          }));
        }
      };
      
      this.connection.onconnectionstatechange = () => {
        console.log('Connection state:', this.connection?.connectionState);
      };
      
      this.connection.oniceconnectionstatechange = () => {
        console.log('ICE connection state:', this.connection?.iceConnectionState);
      };
    }
    
    private setupDataChannel() {
      if (!this.dataChannel) return;
      
      this.dataChannel.binaryType = 'arraybuffer';
      
      this.dataChannel.onopen = () => {
        console.log('Data channel opened');
        this.isConnected = true;
        
        // Process any pending files
        if (this.pendingFiles.length > 0) {
          console.log(`Processing ${this.pendingFiles.length} pending files`);
          const filesToSend = [...this.pendingFiles];
          this.pendingFiles = [];
          
          // Send each file with a small delay between them
          filesToSend.forEach((item, idx) => {
            setTimeout(() => {
              this.sendFileNow(item.file, item.index);
            }, idx * 100);
          });
        }
      };
      
      this.dataChannel.onclose = () => {
        console.log('Data channel closed');
        this.isConnected = false;
      };
      
      this.dataChannel.onmessage = (event) => {
        if (typeof event.data === 'string') {
          try {
            const data = JSON.parse(event.data);
            console.log('Received message type:', data.type);
            
            switch (data.type) {
              case 'file-start':
                console.log('Receiving file:', data.name, 'size:', data.size);
                this.fileTransfers.set(data.id, {
                  chunks: [],
                  metadata: {
                    name: data.name,
                    type: data.mimeType,
                    size: data.size,
                    totalChunks: data.totalChunks,
                    index: data.index
                  },
                  receivedChunks: 0
                });
                break;
                
              case 'file-chunk':
                if (this.fileTransfers.has(data.id)) {
                  const transfer = this.fileTransfers.get(data.id)!;
                  
                  // The next chunk will be a binary message
                  this.dataChannel!.onmessage = (binEvent) => {
                    // Add the chunk to our array
                    transfer.chunks.push(binEvent.data);
                    transfer.receivedChunks++;
                    
                    console.log(`Received chunk ${transfer.receivedChunks}/${transfer.metadata.totalChunks}`);
                    
                    // Reset the message handler
                    this.setupDataChannel();
                    
                    // If we've received all chunks, create the file
                    if (transfer.receivedChunks === transfer.metadata.totalChunks) {
                      this.createFileFromChunks(data.id);
                    }
                  };
                }
                break;
                
              case 'file-end':
                // A safety check, but usually not needed with our approach
                if (this.fileTransfers.has(data.id)) {
                  this.createFileFromChunks(data.id);
                }
                break;
                
              default:
                // All other messages get passed to the callback
                this.onMessageCallback(data);
            }
          } catch (error) {
            console.error('Error parsing message:', error, event.data);
          }
        }
      };
    }
    
    private createFileFromChunks(fileId: string) {
      const transfer = this.fileTransfers.get(fileId);
      if (!transfer) return;
      
      try {
        console.log(`Creating file from ${transfer.chunks.length} chunks`);
        const blob = new Blob(transfer.chunks, { type: transfer.metadata.type });
        const file = new File([blob], transfer.metadata.name, { type: transfer.metadata.type });
        
        console.log('File created:', file.name, 'size:', file.size);
        
        // Clean up
        this.fileTransfers.delete(fileId);
        
        // Notify the application
        this.onMessageCallback({
          type: 'file-received',
          file: file,
          index: transfer.metadata.index
        });
      } catch (error) {
        console.error('Error creating file:', error);
      }
    }
    
    sendMessage(data: any) {
      if (this.dataChannel && this.dataChannel.readyState === 'open') {
        try {
          this.dataChannel.send(JSON.stringify(data));
        } catch (error) {
          console.error('Error sending message:', error);
        }
      } else {
        console.error('Data channel not open');
      }
    }
    
    sendFile(file: File, index: number) {
      // If not connected, queue the file
      if (!this.isConnected || !this.dataChannel || this.dataChannel.readyState !== 'open') {
        console.log('Connection not ready, queuing file:', file.name);
        this.pendingFiles.push({ file, index });
        return;
      }
      
      // If connected, send immediately
      this.sendFileNow(file, index);
    }
    
    private sendFileNow(file: File, index: number) {
      console.log('Starting to send file now:', file.name, 'size:', file.size);
      
      try {
        // Generate a unique ID for this file transfer
        const fileId = crypto.randomUUID();
        const chunkSize = 16384; // 16KB chunks
        const totalChunks = Math.ceil(file.size / chunkSize);
        
        // First, send metadata
        this.sendMessage({
          type: 'file-start',
          id: fileId,
          name: file.name,
          mimeType: file.type,
          size: file.size,
          totalChunks: totalChunks,
          index: index
        });
        
        // Wait a bit for the receiver to process the metadata
        setTimeout(() => {
          this.sendFileChunks(file, fileId, chunkSize, totalChunks, 0);
        }, 500);
      } catch (error) {
        console.error('Error initiating file transfer:', error);
      }
    }
    
    private sendFileChunks(file: File, fileId: string, chunkSize: number, totalChunks: number, currentChunk: number) {
      if (currentChunk >= totalChunks) {
        // All chunks sent
        this.sendMessage({
          type: 'file-end',
          id: fileId
        });
        console.log('File transfer complete:', file.name);
        return;
      }
      
      const start = currentChunk * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunk = file.slice(start, end);
      
      try {
        // First, send info about the chunk
        this.sendMessage({
          type: 'file-chunk',
          id: fileId,
          chunkIndex: currentChunk
        });
        
        // Wait briefly for the receiver to prepare
        setTimeout(() => {
          // Then send the binary data
          chunk.arrayBuffer().then(buffer => {
            if (this.dataChannel && this.dataChannel.readyState === 'open') {
              this.dataChannel.send(buffer);
              
              // Move to the next chunk after a short delay
              setTimeout(() => {
                this.sendFileChunks(file, fileId, chunkSize, totalChunks, currentChunk + 1);
              }, 10);
            }
          });
        }, 10);
      } catch (error) {
        console.error('Error sending chunk:', error);
        // Try again after a delay
        setTimeout(() => {
          this.sendFileChunks(file, fileId, chunkSize, totalChunks, currentChunk);
        }, 500);
      }
    }
    
    disconnect() {
      if (this.dataChannel) {
        this.dataChannel.close();
      }
      
      if (this.connection) {
        this.connection.close();
      }
      
      if (this.ws) {
        this.ws.close();
      }
    }
    
    isDataChannelOpen() {
      return this.isConnected && this.dataChannel && this.dataChannel.readyState === 'open';
    }
  }