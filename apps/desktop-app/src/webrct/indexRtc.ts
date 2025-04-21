export class WebRTCClient {
    private connection: RTCPeerConnection | null = null;
    private dataChannel: RTCDataChannel | null = null;
    private ws: WebSocket | null = null;
    private clientId: string;
    private onMessageCallback: (data: any) => void;
  
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
      
      this.dataChannel.onopen = () => {
        console.log('Data channel opened');
      };
      
      this.dataChannel.onclose = () => {
        console.log('Data channel closed');
      };
      
      this.dataChannel.onmessage = (event) => {
        const data = JSON.parse(event.data);
        this.onMessageCallback(data);
      };
    }
    
    sendMessage(data: any) {
      if (this.dataChannel && this.dataChannel.readyState === 'open') {
        this.dataChannel.send(JSON.stringify(data));
      } else {
        console.error('Data channel not open');
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
  }