export class WebRTCClient {
    private connections: Map<string, RTCPeerConnection> = new Map();
    private dataChannels: Map<string, RTCDataChannel> = new Map();
    private ws: WebSocket | null = null;
    private clientId: string = '';
    private roomCode: string = '';
    private roomMembers: string[] = [];
    private onMessageCallback: (data: any) => void;
    private onRoomCallback: (data: any) => void;
    private fileTransfers: Map<string, {
      chunks: Array<ArrayBuffer>,
      metadata: any,
      receivedChunks: number
    }> = new Map();
    private pendingFiles: Array<{file: File, index: number}> = [];
    // private isConnected: boolean = false;
  
    constructor(onMessage: (data: any) => void, onRoom: (data: any) => void) {
      this.onMessageCallback = onMessage;
      this.onRoomCallback = onRoom;
    }
  
    connect(serverUrl: string = 'ws://localhost:3001') {
      this.ws = new WebSocket(serverUrl);
      
      this.ws.onopen = () => {
        console.log('Connected to signaling server');
      };
      
      this.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        switch (data.type) {
          case 'client-id':
            this.clientId = data.id;
            console.log('Assigned client ID:', this.clientId);
            this.onRoomCallback({
              type: 'connected',
              clientId: this.clientId
            });
            break;
            
          case 'room-created':
            this.roomCode = data.roomCode;
            console.log('Room created:', this.roomCode);
            this.onRoomCallback({
              type: 'room-created',
              roomCode: this.roomCode
            });
            break;
            
          case 'room-joined':
            this.roomCode = data.roomCode;
            this.roomMembers = data.members;
            console.log('Joined room:', this.roomCode);
            console.log('Room members:', this.roomMembers);
            
            // Initiate connections to all existing members (except self)
            this.roomMembers.forEach(memberId => {
              if (memberId !== this.clientId) {
                this.createOffer(memberId);
              }
            });
            
            this.onRoomCallback({
              type: 'room-joined',
              roomCode: this.roomCode,
              members: this.roomMembers
            });
            break;
            
          case 'user-joined':
            console.log('User joined:', data.clientId);
            this.roomMembers.push(data.clientId);
            
            // If we're the host, initiate connection with the new user
            if (this.isHost()) {
              this.createOffer(data.clientId);
            }
            
            this.onRoomCallback({
              type: 'user-joined',
              clientId: data.clientId
            });
            break;
            
          case 'user-left':
            console.log('User left:', data.clientId);
            // Remove from room members
            this.roomMembers = this.roomMembers.filter(id => id !== data.clientId);
            
            // Clean up connection
            this.closeConnection(data.clientId);
            
            this.onRoomCallback({
              type: 'user-left',
              clientId: data.clientId
            });
            break;
            
          case 'offer':
            this.handleOffer(data.from, data.payload);
            break;
            
          case 'answer':
            this.handleAnswer(data.from, data.payload);
            break;
            
          case 'candidate':
            this.handleCandidate(data.from, data.payload);
            break;
            
          case 'broadcast':
            // Handle broadcast messages from other clients
            this.onMessageCallback({
              ...data.payload,
              fromClient: data.from
            });
            break;
            
          case 'error':
            console.error('Server error:', data.message);
            this.onRoomCallback({
              type: 'error',
              message: data.message
            });
            break;
        }
      };
      
      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
      
      this.ws.onclose = () => {
        console.log('WebSocket connection closed');
      };
    }
    
    createRoom() {
      if (this.ws) {
        this.ws.send(JSON.stringify({
          type: 'create-room'
        }));
      }
    }
    
    joinRoom(roomCode: string) {
      if (this.ws) {
        this.ws.send(JSON.stringify({
          type: 'join-room',
          roomCode: roomCode
        }));
      }
    }
    
    createOffer(targetId: string) {
      const connection = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
      
      this.connections.set(targetId, connection);
      this.setupPeerConnectionListeners(targetId, connection);
      
      // Configure data channel for low-latency audio streaming
      const dataChannel = connection.createDataChannel('audioSync', {
        ordered: true,          // Keep packets in order
        maxRetransmits: 0,      // Don't retransmit lost packets - just move on
        // priority: 'high'        // Prioritize audio data
      });
      
      this.dataChannels.set(targetId, dataChannel);
      this.setupDataChannel(targetId, dataChannel);
      
      connection.createOffer()
        .then(offer => connection.setLocalDescription(offer))
        .then(() => {
          if (this.ws && connection.localDescription) {
            this.ws.send(JSON.stringify({
              type: 'offer',
              to: targetId,
              payload: connection.localDescription
            }));
          }
        })
        .catch(error => console.error('Error creating offer:', error));
    }
    
    private handleOffer(fromId: string, offer: RTCSessionDescriptionInit) {
      const connection = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
      
      this.connections.set(fromId, connection);
      this.setupPeerConnectionListeners(fromId, connection);
      
      connection.ondatachannel = (event) => {
        this.dataChannels.set(fromId, event.channel);
        this.setupDataChannel(fromId, event.channel);
      };
      
      connection.setRemoteDescription(new RTCSessionDescription(offer))
        .then(() => connection.createAnswer())
        .then(answer => connection.setLocalDescription(answer))
        .then(() => {
          if (this.ws && connection.localDescription) {
            this.ws.send(JSON.stringify({
              type: 'answer',
              to: fromId,
              payload: connection.localDescription
            }));
          }
        })
        .catch(error => console.error('Error handling offer:', error));
    }
    
    private handleAnswer(fromId: string, answer: RTCSessionDescriptionInit) {
      const connection = this.connections.get(fromId);
      if (connection) {
        connection.setRemoteDescription(new RTCSessionDescription(answer))
          .catch(error => console.error('Error setting remote description:', error));
      }
    }
    
    private handleCandidate(fromId: string, candidate: RTCIceCandidateInit) {
      const connection = this.connections.get(fromId);
      if (connection) {
        connection.addIceCandidate(new RTCIceCandidate(candidate))
          .catch(error => console.error('Error adding ICE candidate:', error));
      }
    }
    
    private setupPeerConnectionListeners(peerId: string, connection: RTCPeerConnection) {
      connection.onicecandidate = (event) => {
        if (event.candidate && this.ws) {
          this.ws.send(JSON.stringify({
            type: 'candidate',
            to: peerId,
            payload: event.candidate
          }));
        }
      };
      
      connection.onconnectionstatechange = () => {
        console.log(`Connection state with ${peerId}:`, connection.connectionState);
      };
      
      connection.oniceconnectionstatechange = () => {
        console.log(`ICE connection state with ${peerId}:`, connection.iceConnectionState);
      };
    }
    
    private setupDataChannel(peerId: string, dataChannel: RTCDataChannel) {
      dataChannel.binaryType = 'arraybuffer';
      
      // Configure for low latency - Using proper RTCDataChannelInit options
      // Note: You can't modify these properties after channel creation,
      // so we'll make sure we're not attempting to do that
      
      // Instead of trying to set these properties directly (which causes errors),
      // log the current configuration for debugging purposes
      console.log(`DataChannel with ${peerId} config:`, {
        ordered: dataChannel.ordered,
        maxPacketLifeTime: dataChannel.maxPacketLifeTime,
        maxRetransmits: dataChannel.maxRetransmits,
        protocol: dataChannel.protocol,
        negotiated: dataChannel.negotiated
      });
      
      dataChannel.onopen = () => {
        console.log(`Data channel opened with ${peerId}`);
        
        // Process any pending files if this is the first connection
        if (this.isHost() && this.pendingFiles.length > 0) {
          console.log(`Processing ${this.pendingFiles.length} pending files`);
          const filesToSend = [...this.pendingFiles];
          this.pendingFiles = [];
          
          // Send each file with a small delay between them
          filesToSend.forEach((item, idx) => {
            setTimeout(() => {
              this.broadcastFile(item.file, item.index);
            }, idx * 100);
          });
        }
      };
      
      dataChannel.onclose = () => {
        console.log(`Data channel closed with ${peerId}`);
      };
      
      let expectingBinary = false;
      let pendingMetadata:any = null;
      
      dataChannel.onmessage = (event) => {
        if (expectingBinary && event.data instanceof ArrayBuffer) {
          // Handle binary message with the pending metadata
          expectingBinary = false;
          
          // Calculate network latency
          const latency = Date.now() - (pendingMetadata.sentAt || 0);
          if (pendingMetadata.sentAt) {
            console.log(`Audio chunk ${pendingMetadata.sequence} received with ${latency}ms latency`);
          }
          
          // Convert ArrayBuffer to Blob - use WAV for audio chunks for compatibility
          const mimeType = pendingMetadata.format === 'wav' ? 'audio/wav' : 'audio/webm';
          const blob = new Blob([event.data], { type: mimeType });
          
          // Call the message callback with both metadata and binary data
          this.onMessageCallback({
            ...pendingMetadata,
            blob: blob, // Use blob property for consistency
            binary: blob, // Keep binary for backward compatibility
            fromClient: peerId,
            receivedAt: Date.now()
          });
          
          pendingMetadata = null;
        } else if (typeof event.data === 'string') {
          try {
            const data = JSON.parse(event.data);
            
            // Check if this message indicates binary data will follow
            if (data.binaryFollowing) {
              expectingBinary = true;
              pendingMetadata = data;
              
              // Log that we're waiting for binary data
              console.log(`Expecting binary data for ${data.type}, sequence: ${data.sequence}`);
              return; // Wait for binary data
            }
            
            switch (data.type) {
              case 'file-start':
                console.log(`Receiving file from ${peerId}:`, data.name, 'size:', data.size);
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
                  const originalHandler = dataChannel.onmessage;
                  dataChannel.onmessage = (binEvent) => {
                    // Add the chunk to our array
                    transfer.chunks.push(binEvent.data);
                    transfer.receivedChunks++;
                    
                    // Reset the message handler
                    dataChannel.onmessage = originalHandler;
                    
                    // If we've received all chunks, create the file
                    if (transfer.receivedChunks === transfer.metadata.totalChunks) {
                      this.createFileFromChunks(data.id);
                    }
                  };
                }
                break;
                
              default:
                // All other messages get passed to the callback
                this.onMessageCallback({
                  ...data,
                  fromClient: peerId,
                  receivedAt: Date.now()
                });
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
    
    broadcastMessage(data: any) {
      // If connected to signaling server, use broadcast
      if (this.ws) {
        this.ws.send(JSON.stringify({
          type: 'broadcast',
          payload: data
        }));
      }
    }
    
    sendMessage(peerId: string, data: any) {
      const dataChannel = this.dataChannels.get(peerId);
      if (dataChannel && dataChannel.readyState === 'open') {
        try {
          dataChannel.send(JSON.stringify(data));
        } catch (error) {
          console.error(`Error sending message to ${peerId}:`, error);
        }
      } else {
        console.error(`Data channel to ${peerId} not open`);
      }
    }
    
    broadcastFile(file: File, index: number) {
      // If no connections, queue the file
      if (this.dataChannels.size === 0) {
        console.log('No connections yet, queuing file:', file.name);
        this.pendingFiles.push({ file, index });
        return;
      }
      
      // Otherwise send to all peers
      for (const peerId of this.dataChannels.keys()) {
        this.sendFileToClient(peerId, file, index);
      }
    }
    
    private sendFileToClient(peerId: string, file: File, index: number) {
      const dataChannel = this.dataChannels.get(peerId);
      if (!dataChannel || dataChannel.readyState !== 'open') {
        console.log(`Connection to ${peerId} not ready`);
        return;
      }
      
      console.log(`Starting to send file to ${peerId}:`, file.name, 'size:', file.size);
      
      try {
        // Generate a unique ID for this file transfer
        const fileId = crypto.randomUUID();
        const chunkSize = 16384; // 16KB chunks
        const totalChunks = Math.ceil(file.size / chunkSize);
        
        // First, send metadata
        this.sendMessage(peerId, {
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
          this.sendFileChunks(peerId, file, fileId, chunkSize, totalChunks, 0);
        }, 500);
      } catch (error) {
        console.error(`Error initiating file transfer to ${peerId}:`, error);
      }
    }
    
    private sendFileChunks(peerId: string, file: File, fileId: string, chunkSize: number, totalChunks: number, currentChunk: number) {
      if (currentChunk >= totalChunks) {
        // All chunks sent
        this.sendMessage(peerId, {
          type: 'file-end',
          id: fileId
        });
        console.log(`File transfer complete to ${peerId}:`, file.name);
        return;
      }
      
      const dataChannel = this.dataChannels.get(peerId);
      if (!dataChannel || dataChannel.readyState !== 'open') {
        console.log(`Connection to ${peerId} lost during file transfer`);
        return;
      }
      
      const start = currentChunk * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunk = file.slice(start, end);
      
      try {
        // First, send info about the chunk
        this.sendMessage(peerId, {
          type: 'file-chunk',
          id: fileId,
          chunkIndex: currentChunk
        });
        
        // Wait briefly for the receiver to prepare
        setTimeout(() => {
          // Then send the binary data
          chunk.arrayBuffer().then(buffer => {
            if (dataChannel && dataChannel.readyState === 'open') {
              dataChannel.send(buffer);
              
              // Move to the next chunk after a short delay
              setTimeout(() => {
                this.sendFileChunks(peerId, file, fileId, chunkSize, totalChunks, currentChunk + 1);
              }, 10);
            }
          });
        }, 10);
      } catch (error) {
        console.error(`Error sending chunk to ${peerId}:`, error);
        // Try again after a delay
        setTimeout(() => {
          this.sendFileChunks(peerId, file, fileId, chunkSize, totalChunks, currentChunk);
        }, 500);
      }
    }
    
    broadcastBinary(data: Blob, metadata: any) {
      // For real-time audio streaming, we need to optimize for low latency
      // Set a maximum chunk size to avoid buffer overflows (300KB)
      if (data.size > 300000) {
        console.warn(`Chunk too large (${data.size} bytes), may cause issues`);
      }
      
      // Send to all connected peers
      for (const peerId of this.dataChannels.keys()) {
        this.sendBinaryToClient(peerId, data, metadata);
      }
    }
    
    private sendBinaryToClient(peerId: string, data: Blob, metadata: any) {
      const dataChannel = this.dataChannels.get(peerId);
      if (!dataChannel || dataChannel.readyState !== 'open') {
        return; // Skip if connection not ready
      }
      
      // Check if the data channel is congested
      if (dataChannel.bufferedAmount > 1024*1024) {
        console.warn(`Data channel to ${peerId} is congested, skipping chunk`);
        return; // Skip this chunk if the channel is congested
      }
      
      // Send metadata with high priority
      this.sendMessage(peerId, {
        ...metadata,
        binaryFollowing: true,
        binarySize: data.size,
        sentAt: Date.now() // Add timestamp for latency measurement
      });
      
      // Send binary data immediately after metadata
      data.arrayBuffer().then(buffer => {
        if (dataChannel && dataChannel.readyState === 'open') {
          try {
            dataChannel.send(buffer);
          } catch (e) {
            console.error(`Failed to send binary data to ${peerId}:`, e);
          }
        }
      });
    }
    
    disconnect() {
      // Close all data channels
      for (const [peerId, dataChannel] of this.dataChannels.entries()) {
        dataChannel.close();
      }
      
      // Close all connections
      for (const [peerId, connection] of this.connections.entries()) {
        connection.close();
      }
      
      // Clear maps
      this.dataChannels.clear();
      this.connections.clear();
      
      if (this.ws) {
        this.ws.close();
      }
    }
    
    isHost() {
      // The first client in the room member list is considered the host
      return this.roomMembers.length > 0 && this.roomMembers[0] === this.clientId;
    }
    
    isConnected() {
      return this.dataChannels.size > 0;
    }
    
    getRoomInfo() {
      return {
        roomCode: this.roomCode,
        clientId: this.clientId,
        members: this.roomMembers,
        isHost: this.isHost()
      };
    }
    
    private closeConnection(peerId: string) {
      // Close data channel
      const dataChannel = this.dataChannels.get(peerId);
      if (dataChannel) {
        dataChannel.close();
        this.dataChannels.delete(peerId);
      }
      
      // Close connection
      const connection = this.connections.get(peerId);
      if (connection) {
        connection.close();
        this.connections.delete(peerId);
      }
    }
}