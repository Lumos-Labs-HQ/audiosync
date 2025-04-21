export class WebRTCClient {
    private connection: RTCPeerConnection | null = null;
    private dataChannel: RTCDataChannel | null = null;
    private ws: WebSocket | null = null;
    private clientId: string;
    private onMessageCallback: (data: any) => void;
    private fileChunks: Map<string, Array<ArrayBuffer>> = new Map();
    private fileMetadata: Map<string, any> = new Map();
  
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
      };
      
      this.dataChannel.onclose = () => {
        console.log('Data channel closed');
      };
      
      this.dataChannel.onmessage = (event) => {
        if (typeof event.data === 'string') {
          const data = JSON.parse(event.data);
          
          if (data.type === 'file-start') {
            // Initialize file receiving
            this.fileChunks.set(data.fileId, []);
            this.fileMetadata.set(data.fileId, {
              name: data.name,
              type: data.type,
              size: data.size,
              totalChunks: data.totalChunks
            });
            return;
          }
          
          if (data.type === 'file-end') {
            // All chunks received, combine them into a file
            const chunks = this.fileChunks.get(data.fileId) || [];
            const metadata = this.fileMetadata.get(data.fileId);
            
            if (!chunks.length || !metadata) return;
            
            const fileBlob = new Blob(chunks, { type: metadata.type });
            const file = new File([fileBlob], metadata.name, { type: metadata.type });
            
            // Clean up
            this.fileChunks.delete(data.fileId);
            this.fileMetadata.delete(data.fileId);
            
            // Notify with completed file
            this.onMessageCallback({
              type: 'file-received',
              file: file,
              index: data.index
            });
            return;
          }
          
          // For non-file messages
          this.onMessageCallback(data);
        } else {
          // Binary data (file chunk)
          const data = event.data;
          const header = new Uint8Array(data, 0, 36);
          const fileId = new TextDecoder().decode(header.slice(0, 36));
          const chunk = data.slice(36);
          
          // Add chunk to file
          const chunks = this.fileChunks.get(fileId);
          if (chunks) {
            chunks.push(chunk);
          }
        }
      };
    }
    
    sendMessage(data: any) {
      if (this.dataChannel && this.dataChannel.readyState === 'open') {
        this.dataChannel.send(JSON.stringify(data));
      } else {
        console.error('Data channel not open');
      }
    }
    
    sendFile(file: File, index: number) {
      if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
        console.error('Data channel not open');
        return;
      }
      
      const fileId = crypto.randomUUID();
      const chunkSize = 16384; // 16KB chunks
      const totalChunks = Math.ceil(file.size / chunkSize);
      
      // Send file metadata first
      this.sendMessage({
        type: 'file-start',
        fileId: fileId,
        name: file.name,
        fileType: file.type,
        size: file.size,
        totalChunks: totalChunks,
        index: index
        });
      
      let offset = 0;
      
      // Function to send a chunk
      const sendChunk = async () => {
        if (offset >= file.size) {
          // All chunks sent
          this.sendMessage({
            type: 'file-end',
            fileId: fileId,
            index: index
          });
          return;
        }
        
        const chunk = file.slice(offset, offset + chunkSize);
        const buffer = await chunk.arrayBuffer();
        
        // Create a header with the fileId
        const headerBytes = new TextEncoder().encode(fileId);
        
        // Combine header and chunk
        const combined = new Uint8Array(headerBytes.length + buffer.byteLength);
        combined.set(headerBytes, 0);
        combined.set(new Uint8Array(buffer), headerBytes.length);
        
        this.dataChannel!.send(combined.buffer);
        
        offset += chunkSize;
        
        // Wait a bit to prevent flooding the channel
        setTimeout(sendChunk, 0);
      };
      
      // Start sending chunks
      sendChunk();
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
  }