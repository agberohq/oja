/**
 * oja/presence.js
 * Multi-user presence — who is online, what are they viewing, where is
 * their cursor. Built on Socket; requires a server that broadcasts
 * presence messages to all connected clients in the same room.
 *
 * ─── Setup ────────────────────────────────────────────────────────────────────
 *
 *   import { Presence } from '../ext/presence.js';
 *
 *   const presence = new Presence('wss://api.example.com/presence', {
 *       room:  'doc-42',
 *       user:  { id: auth.session.user().sub, name: 'Ade', color: '#0a84ff' },
 *   });
 *
 *   presence.join();
 *
 * ─── Reactive state ───────────────────────────────────────────────────────────
 *
 *   // peers() is a reactive signal — use inside effect() or Out.to().bind()
 *   effect(() => {
 *       const online = presence.peers();
 *       renderAvatarStack(online);
 *   });
 *
 *   // Check a specific peer
 *   presence.peer('user-123');    // → { id, name, color, view, cursor, joinedAt }
 *   presence.count();             // → number of peers (excludes self)
 *
 * ─── Broadcast your state ─────────────────────────────────────────────────────
 *
 *   // Tell peers what you're looking at
 *   presence.setView('/notes/42');
 *
 *   // Broadcast cursor position (e.g. in an editor)
 *   editor.on('mousemove', (e) => {
 *       presence.setCursor({ x: e.clientX, y: e.clientY });
 *   });
 *
 *   // Broadcast arbitrary state (selection range, scroll position, etc.)
 *   presence.setState({ selection: { line: 10, col: 3 } });
 *
 * ─── Cursor rendering ─────────────────────────────────────────────────────────
 *
 *   // Automatically render remote cursors inside a container element
 *   presence.renderCursors('#editor', {
 *       template: (peer) => `<div class="cursor-label">${peer.name}</div>`
 *   });
 *
 * ─── Events ───────────────────────────────────────────────────────────────────
 *
 *   presence.on('join',   (peer) => notify.info(`${peer.name} joined`));
 *   presence.on('leave',  (peer) => notify.info(`${peer.name} left`));
 *   presence.on('update', (peer) => rerenderPeer(peer));
 *   presence.on('cursor', (peer) => moveCursor(peer));
 *
 * ─── Lifecycle ────────────────────────────────────────────────────────────────
 *
 *   presence.join();     // connect and announce
 *   presence.leave();    // broadcast leave then close socket
 *   presence.destroy();  // close socket without broadcasting
 *
 * ─── Server protocol ──────────────────────────────────────────────────────────
 *
 *   Client → Server messages (all include { type, room, userId }):
 *     { type: 'join',   room, user: { id, name, color } }
 *     { type: 'leave',  room, userId }
 *     { type: 'update', room, userId, view?, cursor?, state? }
 *     { type: 'ping',   room, userId }
 *
 *   Server → Client messages:
 *     { type: 'join',   peer: PeerObject }
 *     { type: 'leave',  userId }
 *     { type: 'update', userId, view?, cursor?, state? }
 *     { type: 'roster', peers: PeerObject[] }   — sent on join to catch up
 *
 *   PeerObject: { id, name, color, view, cursor, state, joinedAt, seenAt }
 *
 * ─── Options ──────────────────────────────────────────────────────────────────
 *
 *   room         : string     — room identifier (required)
 *   user         : Object     — { id, name, color } (required)
 *   heartbeat    : number     — ms between keep-alive pings (default: 15000)
 *   timeout      : number     — ms before peer considered offline (default: 45000)
 *   throttleCursor: number    — ms to throttle cursor broadcasts (default: 50)
 */

import { Socket }  from './socket.js';
import { state }      from '../core/reactive.js';

export class Presence {
    /**
     * @param {string} url     — WebSocket URL
     * @param {Object} options
     */
    constructor(url, options = {}) {
        const {
            room,
            user,
            heartbeat      = 15_000,
            timeout        = 45_000,
            throttleCursor = 50,
        } = options;

        if (!room) throw new Error('[oja/presence] options.room is required');
        if (!user?.id) throw new Error('[oja/presence] options.user.id is required');

        this._url           = url;
        this._room          = room;
        this._user          = { id: user.id, name: user.name || 'Anonymous', color: user.color || '#888' };
        this._heartbeat     = heartbeat;
        this._timeout       = timeout;
        this._throttleCursor= throttleCursor;

        // Reactive peer map: userId → peerObject
        const [_peers, _setPeers] = state({});
        this._peers    = _peers;
        this._setPeers = _setPeers;

        // Local mutable state for current session
        this._view   = null;
        this._cursor = null;
        this._state  = {};

        // Event handlers
        this._handlers = new Map();

        // Internal
        this._socket        = null;
        this._heartbeatTimer= null;
        this._timeoutTimers = new Map(); // userId → timer
        this._cursorThrottle= null;
        this._joined        = false;

        // Cursor rendering cleanup
        this._cursorEls   = new Map(); // userId → DOM element
        this._cursorRoot  = null;
        this._cursorTpl   = null;
        this._cursorUnsub = null;
    }

    // Lifecycle

    /**
     * Connect to the WebSocket and announce presence to the room.
     * @returns {this}
     */
    join() {
        if (this._joined) return this;
        this._joined = true;

        this._socket = new Socket(this._url, {
            reconnect: true,
            pingInterval: 0, // we manage our own heartbeat
        });

        this._socket.on('connect', () => {
            this._send({ type: 'join', user: this._user });
            this._startHeartbeat();
        });

        this._socket.on('disconnect', () => {
            this._stopHeartbeat();
        });

        this._socket.on('message', (msg) => this._handleMessage(msg));

        return this;
    }

    /**
     * Broadcast a leave message then close the connection.
     */
    leave() {
        if (!this._joined) return;
        this._send({ type: 'leave' });
        this.destroy();
    }

    /**
     * Close the connection without broadcasting.
     */
    destroy() {
        this._joined = false;
        this._stopHeartbeat();
        for (const t of this._timeoutTimers.values()) clearTimeout(t);
        this._timeoutTimers.clear();
        this._socket?.close();
        this._socket = null;
        this._cleanupCursors();
    }

    // Broadcasting

    /**
     * Tell peers what route / document you are currently viewing.
     * @param {string} view  — e.g. '/notes/42' or a document id
     */
    setView(view) {
        this._view = view;
        this._send({ type: 'update', view });
    }

    /**
     * Broadcast your cursor position.
     * Throttled to `throttleCursor` ms to avoid flooding.
     *
     * @param {{ x: number, y: number }|null} cursor
     */
    setCursor(cursor) {
        this._cursor = cursor;
        if (this._cursorThrottle <= 0) {
            this._send({ type: 'update', cursor });
            return;
        }
        if (this._cursorThrottle !== null && this._cursorTimer) return;
        this._cursorTimer = setTimeout(() => {
            this._cursorTimer = null;
            this._send({ type: 'update', cursor: this._cursor });
        }, this._throttleCursor);
    }

    /**
     * Broadcast arbitrary state (e.g. selection range, scroll position).
     * Merged with existing state on the server and other clients.
     *
     * @param {Object} partial
     */
    setState(partial) {
        this._state = { ...this._state, ...partial };
        this._send({ type: 'update', state: partial });
    }

    // Reading peers

    /**
     * Reactive signal returning all current peers (excludes self).
     * Call inside effect() or Out.to().bind() to re-run on changes.
     *
     *   effect(() => {
     *       const online = presence.peers();
     *       // re-renders whenever anyone joins, leaves, or updates
     *   });
     *
     * @returns {Object[]} array of peer objects sorted by joinedAt
     */
    peers() {
        return Object.values(this._peers()).sort((a, b) => a.joinedAt - b.joinedAt);
    }

    /**
     * Get a single peer by userId.
     * @param {string} userId
     * @returns {Object|null}
     */
    peer(userId) {
        return this._peers()[userId] || null;
    }

    /** Number of peers currently online (excludes self). */
    count() {
        return Object.keys(this._peers()).length;
    }

    // Cursor rendering

    /**
     * Automatically render and update remote cursors as DOM elements
     * inside a container element. Cleans up when peers leave.
     *
     *   presence.renderCursors('#editor', {
     *       template: (peer) => `<span style="color:${peer.color}">${peer.name}</span>`,
     *       offsetX: 0,
     *       offsetY: -20,
     *   });
     *
     * @param {string|Element} container
     * @param {Object} [options]
     * @param {Function} [options.template]  — fn(peer) → HTML string
     * @param {number}   [options.offsetX]   — px offset from cursor x (default: 0)
     * @param {number}   [options.offsetY]   — px offset from cursor y (default: -20)
     */
    renderCursors(container, options = {}) {
        const root = typeof container === 'string'
            ? document.querySelector(container)
            : container;
        if (!root) return;

        const {
            template = (peer) => `<div class="oja-cursor-label" style="background:${peer.color}">${peer.name}</div>`,
            offsetX  = 0,
            offsetY  = -20,
        } = options;

        root.style.position = root.style.position || 'relative';
        this._cursorRoot = root;
        this._cursorTpl  = template;

        // React to cursor updates
        this._cursorUnsub = this.on('cursor', (peer) => {
            if (!peer.cursor) {
                this._removeCursorEl(peer.id);
                return;
            }
            let el = this._cursorEls.get(peer.id);
            if (!el) {
                el = document.createElement('div');
                el.className = 'oja-cursor';
                el.style.cssText = `
                    position: absolute;
                    pointer-events: none;
                    z-index: 9999;
                    transition: left 80ms linear, top 80ms linear;
                `;
                el.innerHTML = template(peer);
                root.appendChild(el);
                this._cursorEls.set(peer.id, el);
            }
            const bounds  = root.getBoundingClientRect();
            el.style.left = (peer.cursor.x - bounds.left + offsetX) + 'px';
            el.style.top  = (peer.cursor.y - bounds.top  + offsetY) + 'px';
        });

        // Remove cursor when peer leaves
        this.on('leave', (peer) => this._removeCursorEl(peer.id));
    }

    // Events

    /**
     * Subscribe to a presence event.
     *
     *   Events: 'join' | 'leave' | 'update' | 'cursor'
     *
     * @param {string}   event
     * @param {Function} fn
     * @returns {Function} unsubscribe
     */
    on(event, fn) {
        if (!this._handlers.has(event)) this._handlers.set(event, new Set());
        this._handlers.get(event).add(fn);
        return () => this._handlers.get(event)?.delete(fn);
    }

    // Internal — message handling

    _handleMessage(msg) {
        if (!msg?.type) return;

        switch (msg.type) {
            case 'roster':
                // Full peer list sent by server on connect — replace entire map
                if (Array.isArray(msg.peers)) {
                    const map = {};
                    for (const peer of msg.peers) {
                        if (peer.id !== this._user.id) map[peer.id] = peer;
                    }
                    this._setPeers(map);
                }
                break;

            case 'join': {
                const peer = msg.peer;
                if (!peer || peer.id === this._user.id) break;
                this._setPeers({ ...this._peers(), [peer.id]: peer });
                this._resetTimeout(peer.id);
                this._emit('join', peer);
                break;
            }

            case 'leave': {
                const userId = msg.userId;
                if (!userId || userId === this._user.id) break;
                const peer = this._peers()[userId];
                const next = { ...this._peers() };
                delete next[userId];
                this._setPeers(next);
                this._clearTimeout(userId);
                this._removeCursorEl(userId);
                if (peer) this._emit('leave', peer);
                break;
            }

            case 'update': {
                const userId = msg.userId;
                if (!userId || userId === this._user.id) break;
                const existing = this._peers()[userId];
                if (!existing) break;
                const updated = {
                    ...existing,
                    seenAt: Date.now(),
                    ...(msg.view   !== undefined && { view:   msg.view   }),
                    ...(msg.cursor !== undefined && { cursor: msg.cursor }),
                    ...(msg.state  !== undefined && { state:  { ...existing.state, ...msg.state } }),
                };
                this._setPeers({ ...this._peers(), [userId]: updated });
                this._resetTimeout(userId);
                this._emit('update', updated);
                if (msg.cursor !== undefined) this._emit('cursor', updated);
                break;
            }
        }
    }

    // Internal — heartbeat

    _startHeartbeat() {
        this._stopHeartbeat();
        if (this._heartbeat <= 0) return;
        this._heartbeatTimer = setInterval(() => {
            this._send({ type: 'ping' });
        }, this._heartbeat);
    }

    _stopHeartbeat() {
        clearInterval(this._heartbeatTimer);
        this._heartbeatTimer = null;
    }

    // Internal — peer timeout

    _resetTimeout(userId) {
        this._clearTimeout(userId);
        if (this._timeout <= 0) return;
        const t = setTimeout(() => {
            // Peer has not been seen — treat as leave
            const peer = this._peers()[userId];
            if (!peer) return;
            const next = { ...this._peers() };
            delete next[userId];
            this._setPeers(next);
            this._removeCursorEl(userId);
            this._emit('leave', peer);
        }, this._timeout);
        this._timeoutTimers.set(userId, t);
    }

    _clearTimeout(userId) {
        clearTimeout(this._timeoutTimers.get(userId));
        this._timeoutTimers.delete(userId);
    }

    // Internal — send

    _send(payload) {
        this._socket?.send({ ...payload, room: this._room, userId: this._user.id });
    }

    // Internal — emit

    _emit(event, data) {
        const handlers = this._handlers.get(event);
        if (handlers) for (const fn of handlers) { try { fn(data); } catch {} }
    }

    // Internal — cursor DOM cleanup

    _removeCursorEl(userId) {
        const el = this._cursorEls.get(userId);
        if (el) { el.remove(); this._cursorEls.delete(userId); }
    }

    _cleanupCursors() {
        for (const el of this._cursorEls.values()) el.remove();
        this._cursorEls.clear();
        this._cursorUnsub?.();
        this._cursorUnsub = null;
    }
}
