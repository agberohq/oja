/**
 * oja/webrtc.js
 * WebRTC utilities for real-time communication.
 * Provides simple API for peer connections, data channels, and media streams.
 *
 * ─── Basic usage ──────────────────────────────────────────────────────────────
 *
 *   import { webrtc } from '../oja/webrtc.js';
 *
 *   // Get user media (camera/microphone)
 *   const stream = await webrtc.getUserMedia({ video: true, audio: true });
 *   videoElement.srcObject = stream;
 *
 *   // Create a peer connection
 *   const peer = webrtc.createPeer({
 *       onIceCandidate: (candidate) => sendToServer(candidate),
 *       onTrack: (track, stream) => addTrackToVideo(track),
 *   });
 *
 *   // Add local stream
 *   peer.addStream(localStream);
 *
 *   // Create offer (caller)
 *   const offer = await peer.createOffer();
 *   await peer.setLocalDescription(offer);
 *   sendToServer(offer);
 *
 *   // Answer (callee)
 *   await peer.setRemoteDescription(offer);
 *   const answer = await peer.createAnswer();
 *   await peer.setLocalDescription(answer);
 *   sendToServer(answer);
 *
 * ─── Data channels ────────────────────────────────────────────────────────────
 *
 *   // Create data channel
 *   const channel = webrtc.createDataChannel(peer, 'chat', {
 *       onOpen: () => console.log('Channel open'),
 *       onMessage: (data) => displayMessage(data),
 *   });
 *
 *   // Send data
 *   channel.send('Hello peer!');
 *   channel.send(new Uint8Array([1,2,3]));
 *
 * ─── Screen sharing ───────────────────────────────────────────────────────────
 *
 *   const screenStream = await webrtc.getDisplayMedia({ video: true });
 *   peer.addStream(screenStream);
 *
 * ─── One-liner connections ────────────────────────────────────────────────────
 *
 *   // Simple peer-to-peer connection
 *   const connection = await webrtc.connect(otherPeerId, {
 *       onMessage: (data) => handleMessage(data),
 *   });
 *
 *   connection.send('Hello via WebRTC!');
 *
 * ─── Signaling server integration ─────────────────────────────────────────────
 *
 *   const signaling = new WebSocket('wss://signaling.example.com');
 *
 *   webrtc.onSignal(async (data) => {
 *       signaling.send(JSON.stringify(data));
 *   });
 *
 *   signaling.onmessage = (e) => {
 *       webrtc.handleSignal(JSON.parse(e.data));
 *   };
 */


const _peers = new Map(); // peerId -> RTCPeerConnection
const _channels = new Map(); // channelId -> RTCDataChannel
const _streams = new Map(); // streamId -> MediaStream
const _signalHandlers = new Set();

let _nextPeerId = 0;

// Default configuration
const DEFAULT_CONFIG = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
    ],
    iceCandidatePoolSize: 10,
};


export const webrtc = {
    /**
     * Check if WebRTC is supported
     */
    get supported() {
        return !!(navigator.mediaDevices?.getUserMedia ||
            navigator.getUserMedia ||
            navigator.webkitGetUserMedia ||
            navigator.mozGetUserMedia);
    },

    /**
     * Get user media (camera/microphone)
     */
    async getUserMedia(constraints = { video: true, audio: true }) {
        try {
            if (!navigator.mediaDevices?.getUserMedia) {
                throw new Error('getUserMedia not supported');
            }
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            return stream;
        } catch (err) {
            console.error('[oja/webrtc] Failed to get user media:', err);
            throw err;
        }
    },

    /**
     * Get display media (screen sharing)
     */
    async getDisplayMedia(constraints = { video: true }) {
        try {
            if (!navigator.mediaDevices?.getDisplayMedia) {
                throw new Error('getDisplayMedia not supported');
            }
            const stream = await navigator.mediaDevices.getDisplayMedia(constraints);
            return stream;
        } catch (err) {
            console.error('[oja/webrtc] Failed to get display media:', err);
            throw err;
        }
    },

    /**
     * Create a new peer connection
     */
    createPeer(options = {}) {
        const {
            config = DEFAULT_CONFIG,
            onIceCandidate = null,
            onIceGatheringChange = null,
            onIceConnectionChange = null,
            onConnectionStateChange = null,
            onSignalingChange = null,
            onTrack = null,
            onDataChannel = null,
            onNegotiationNeeded = null,
            id = `peer-${_nextPeerId++}`,
        } = options;

        const peer = new RTCPeerConnection(config);

        // Store peer
        _peers.set(id, peer);
        peer._ojaId = id;

        // Set up event handlers
        if (onIceCandidate) {
            peer.onicecandidate = (e) => {
                if (e.candidate) {
                    onIceCandidate(e.candidate, id, peer);
                }
            };
        }

        if (onIceGatheringChange) {
            peer.onicegatheringstatechange = () => {
                onIceGatheringChange(peer.iceGatheringState, id, peer);
            };
        }

        if (onIceConnectionChange) {
            peer.oniceconnectionstatechange = () => {
                onIceConnectionChange(peer.iceConnectionState, id, peer);
            };
        }

        if (onConnectionStateChange) {
            peer.onconnectionstatechange = () => {
                onConnectionStateChange(peer.connectionState, id, peer);
            };
        }

        if (onSignalingChange) {
            peer.onsignalingstatechange = () => {
                onSignalingChange(peer.signalingState, id, peer);
            };
        }

        if (onTrack) {
            peer.ontrack = (e) => {
                onTrack(e.track, e.streams[0], id, peer);
            };
        }

        if (onDataChannel) {
            peer.ondatachannel = (e) => {
                const channel = e.channel;
                _channels.set(channel.label, channel);
                onDataChannel(channel, id, peer);
            };
        }

        if (onNegotiationNeeded) {
            peer.onnegotiationneeded = () => {
                onNegotiationNeeded(id, peer);
            };
        }

        return peer;
    },

    /**
     * Get peer by id
     */
    getPeer(id) {
        return _peers.get(id);
    },

    /**
     * Close and remove peer
     */
    closePeer(id) {
        const peer = _peers.get(id);
        if (peer) {
            peer.close();
            _peers.delete(id);
        }
        return this;
    },

    /**
     * Create a data channel
     */
    createDataChannel(peer, label, options = {}) {
        const {
            onOpen = null,
            onClose = null,
            onMessage = null,
            onError = null,
            ordered = true,
            maxRetransmits = null,
            maxPacketLifeTime = null,
            protocol = '',
            negotiated = false,
            id = null,
        } = options;

        const config = {};
        if (ordered !== undefined) config.ordered = ordered;
        if (maxRetransmits !== null) config.maxRetransmits = maxRetransmits;
        if (maxPacketLifeTime !== null) config.maxPacketLifeTime = maxPacketLifeTime;
        if (protocol) config.protocol = protocol;
        if (negotiated) config.negotiated = negotiated;
        if (id !== null) config.id = id;

        const channel = peer.createDataChannel(label, config);
        _channels.set(label, channel);

        if (onOpen) channel.onopen = () => onOpen(channel);
        if (onClose) channel.onclose = () => onClose(channel);
        if (onError) channel.onerror = (e) => onError(e, channel);
        if (onMessage) {
            channel.onmessage = (e) => {
                let data = e.data;
                // Try to parse JSON
                if (typeof data === 'string') {
                    try {
                        data = JSON.parse(data);
                    } catch {}
                }
                onMessage(data, channel);
            };
        }

        return channel;
    },

    /**
     * Get channel by label
     */
    getChannel(label) {
        return _channels.get(label);
    },

    /**
     * Close channel
     */
    closeChannel(label) {
        const channel = _channels.get(label);
        if (channel) {
            channel.close();
            _channels.delete(label);
        }
        return this;
    },

    /**
     * Create an offer
     */
    async createOffer(peer, options = {}) {
        const { iceRestart = false, offerToReceiveAudio = true, offerToReceiveVideo = true } = options;

        try {
            const offer = await peer.createOffer({
                iceRestart,
                offerToReceiveAudio,
                offerToReceiveVideo,
            });
            return offer;
        } catch (err) {
            console.error('[oja/webrtc] Failed to create offer:', err);
            throw err;
        }
    },

    /**
     * Create an answer
     */
    async createAnswer(peer, options = {}) {
        try {
            const answer = await peer.createAnswer(options);
            return answer;
        } catch (err) {
            console.error('[oja/webrtc] Failed to create answer:', err);
            throw err;
        }
    },

    /**
     * Set local description
     */
    async setLocalDescription(peer, description) {
        try {
            await peer.setLocalDescription(description);
            return peer.localDescription;
        } catch (err) {
            console.error('[oja/webrtc] Failed to set local description:', err);
            throw err;
        }
    },

    /**
     * Set remote description
     */
    async setRemoteDescription(peer, description) {
        try {
            await peer.setRemoteDescription(description);
            return peer.remoteDescription;
        } catch (err) {
            console.error('[oja/webrtc] Failed to set remote description:', err);
            throw err;
        }
    },

    /**
     * Add ICE candidate
     */
    async addIceCandidate(peer, candidate) {
        try {
            await peer.addIceCandidate(candidate);
            return true;
        } catch (err) {
            console.error('[oja/webrtc] Failed to add ICE candidate:', err);
            return false;
        }
    },

    /**
     * Add stream to peer
     */
    addStream(peer, stream) {
        stream.getTracks().forEach(track => {
            peer.addTrack(track, stream);
        });
        return this;
    },

    /**
     * Remove stream from peer
     */
    removeStream(peer, stream) {
        const senders = peer.getSenders();
        senders.forEach(sender => {
            if (sender.track && stream.getTracks().includes(sender.track)) {
                peer.removeTrack(sender);
            }
        });
        return this;
    },

    /**
     * Convenience wrapper for a full peer-to-peer connection.
     * Not implemented — WebRTC signaling is application-specific and cannot
     * be abstracted without knowing your transport (WebSocket, HTTP, etc.).
     * Use createPeer(), createOffer()/createAnswer(), and setLocalDescription()
     * / setRemoteDescription() directly with your own signaling transport.
     */
    async connect(targetId, options = {}) {
        console.warn('[oja/webrtc] connect() is not implemented — WebRTC requires a signaling server. Use createPeer(), createOffer(), and setLocalDescription() with your own signaling transport instead.');
        return {
            send:  ()  => console.warn('[oja/webrtc] connect() stub — not implemented'),
            close: ()  => {},
        };
    },

    /**
     * Register signal handler
     */
    onSignal(handler) {
        _signalHandlers.add(handler);
        return () => _signalHandlers.delete(handler);
    },

    /**
     * Handle incoming signal
     */
    async handleSignal(data) {
        for (const handler of _signalHandlers) {
            try {
                await handler(data);
            } catch (e) {
                console.warn('[oja/webrtc] Signal handler error:', e);
            }
        }
    },

    /**
     * Get all peers
     */
    getPeers() {
        return Array.from(_peers.entries()).map(([id, peer]) => ({
            id,
            connectionState: peer.connectionState,
            iceConnectionState: peer.iceConnectionState,
            signalingState: peer.signalingState,
        }));
    },

    /**
     * Get all channels
     */
    getChannels() {
        return Array.from(_channels.entries()).map(([label, channel]) => ({
            label,
            readyState: channel.readyState,
            ordered: channel.ordered,
            maxRetransmits: channel.maxRetransmits,
            protocol: channel.protocol,
        }));
    },
};