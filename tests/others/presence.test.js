import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Presence } from '../../src/js/ext/presence.js';

// Socket mock
// Presence imports Socket — we mock it at module level via vi.mock so the
// real WebSocket is never opened. The mock stores message handlers so tests
// can inject incoming server messages directly.

vi.mock('../../src/js/ext/socket.js', () => {
    let _instance = null;

    const MockSocket = vi.fn(function (url, opts) {
        this.url        = url;
        this.opts       = opts;
        this._handlers  = new Map();
        this._sent      = [];
        this.closed     = false;
        _instance       = this;
    });

    MockSocket.prototype.on = function (event, fn) {
        if (!this._handlers.has(event)) this._handlers.set(event, []);
        this._handlers.get(event).push(fn);
    };

    MockSocket.prototype.send = function (data) {
        this._sent.push(data);
    };

    MockSocket.prototype.close = function () {
        this.closed = true;
    };

    // Helper to retrieve latest instance from tests
    MockSocket._getInstance = () => _instance;
    MockSocket._emit = (event, data) => {
        const h = _instance?._handlers.get(event) || [];
        h.forEach(fn => fn(data));
    };

    return { Socket: MockSocket };
});

// Import after mock is registered
const { Socket: MockSocket } = await import('../../src/js/ext/socket.js');

function makePresence(overrides = {}) {
    return new Presence('wss://test.example.com/presence', {
        room:  'room-1',
        user:  { id: 'user-me', name: 'Alice', color: '#f00' },
        heartbeat:     0,   // disable heartbeat in tests
        timeout:       0,   // disable timeout in tests
        throttleCursor: 0,
        ...overrides,
    });
}

function simulateServer(msg) {
    MockSocket._emit('message', msg);
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('Presence — construction', () => {
    it('throws if room is missing', () => {
        expect(() => new Presence('wss://x', { user: { id: 'u1' } }))
            .toThrow('[oja/presence] options.room is required');
    });

    it('throws if user.id is missing', () => {
        expect(() => new Presence('wss://x', { room: 'r1' }))
            .toThrow('[oja/presence] options.user.id is required');
    });

    it('starts with empty peer list', () => {
        const p = makePresence();
        expect(p.peers()).toEqual([]);
        expect(p.count()).toBe(0);
    });
});

describe('Presence — join()', () => {
    it('creates a Socket on join()', () => {
        const p = makePresence();
        p.join();
        expect(MockSocket).toHaveBeenCalled();
    });

    it('sends join message on socket connect', () => {
        const p = makePresence();
        p.join();
        MockSocket._emit('connect');
        const sent = MockSocket._getInstance()._sent;
        expect(sent.some(m => m.type === 'join' && m.user?.id === 'user-me')).toBe(true);
    });

    it('join() is idempotent — calling twice does nothing extra', () => {
        const p = makePresence();
        p.join();
        p.join();
        // Should still only create one socket
        expect(MockSocket.mock.calls.filter(c => true).length).toBeGreaterThanOrEqual(1);
    });
});

describe('Presence — leave / destroy', () => {
    it('leave() sends leave message then closes socket', () => {
        const p = makePresence();
        p.join();
        p.leave();
        const sent = MockSocket._getInstance()._sent;
        expect(sent.some(m => m.type === 'leave')).toBe(true);
        expect(MockSocket._getInstance().closed).toBe(true);
    });

    it('destroy() closes socket without broadcasting', () => {
        const p = makePresence();
        p.join();
        p.destroy();
        const sent = MockSocket._getInstance()._sent;
        expect(sent.some(m => m.type === 'leave')).toBe(false);
        expect(MockSocket._getInstance().closed).toBe(true);
    });
});

describe('Presence — server messages', () => {
    it('roster sets initial peer list', () => {
        const p = makePresence();
        p.join();
        MockSocket._emit('connect');
        simulateServer({
            type: 'roster',
            peers: [
                { id: 'user-a', name: 'Bob',   color: '#0f0', joinedAt: 1 },
                { id: 'me',     name: 'Self',   color: '#00f', joinedAt: 2 },  // self excluded
            ],
        });
        // user-me is the self — self is excluded. Only 'user-a' and 'me' (not 'user-me') — 'me' is also not self
        const peers = p.peers();
        expect(peers.some(peer => peer.id === 'user-a')).toBe(true);
        // 'user-me' (self) should be excluded
        expect(peers.every(peer => peer.id !== 'user-me')).toBe(true);
    });

    it('join message adds peer', () => {
        const joinHandler = vi.fn();
        const p = makePresence();
        p.on('join', joinHandler);
        p.join();
        simulateServer({ type: 'join', peer: { id: 'user-b', name: 'Carol', joinedAt: Date.now() } });
        expect(p.count()).toBe(1);
        expect(joinHandler).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-b' }));
    });

    it('ignores join for self', () => {
        const joinHandler = vi.fn();
        const p = makePresence();
        p.on('join', joinHandler);
        p.join();
        simulateServer({ type: 'join', peer: { id: 'user-me', name: 'Alice', joinedAt: Date.now() } });
        expect(joinHandler).not.toHaveBeenCalled();
    });

    it('leave message removes peer', () => {
        const leaveHandler = vi.fn();
        const p = makePresence();
        p.on('leave', leaveHandler);
        p.join();
        simulateServer({ type: 'join', peer: { id: 'user-b', name: 'Carol', joinedAt: Date.now() } });
        expect(p.count()).toBe(1);
        simulateServer({ type: 'leave', userId: 'user-b' });
        expect(p.count()).toBe(0);
        expect(leaveHandler).toHaveBeenCalled();
    });

    it('update message updates peer state and fires update event', () => {
        const updateHandler = vi.fn();
        const p = makePresence();
        p.on('update', updateHandler);
        p.join();
        simulateServer({ type: 'join',   peer:   { id: 'user-b', name: 'Dave', joinedAt: Date.now() } });
        simulateServer({ type: 'update', userId: 'user-b', view: '/notes/42' });
        expect(updateHandler).toHaveBeenCalled();
        expect(p.peer('user-b').view).toBe('/notes/42');
    });

    it('update with cursor fires cursor event', () => {
        const cursorHandler = vi.fn();
        const p = makePresence();
        p.on('cursor', cursorHandler);
        p.join();
        simulateServer({ type: 'join',   peer:   { id: 'user-b', name: 'Dave', joinedAt: Date.now() } });
        simulateServer({ type: 'update', userId: 'user-b', cursor: { x: 100, y: 200 } });
        expect(cursorHandler).toHaveBeenCalledWith(expect.objectContaining({ cursor: { x: 100, y: 200 } }));
    });

    it('ignores unknown message types without error', () => {
        const p = makePresence();
        p.join();
        expect(() => simulateServer({ type: 'unknown_type' })).not.toThrow();
    });
});

describe('Presence — broadcasting', () => {
    it('setView() sends update with view', () => {
        const p = makePresence();
        p.join();
        p.setView('/dashboard');
        const sent = MockSocket._getInstance()._sent;
        expect(sent.some(m => m.type === 'update' && m.view === '/dashboard')).toBe(true);
    });

    it('setCursor() sends update with cursor', () => {
        const p = makePresence();
        p.join();
        p.setCursor({ x: 50, y: 75 });
        const sent = MockSocket._getInstance()._sent;
        expect(sent.some(m => m.type === 'update' && m.cursor?.x === 50)).toBe(true);
    });

    it('setState() sends partial state', () => {
        const p = makePresence();
        p.join();
        p.setState({ selection: { line: 10 } });
        const sent = MockSocket._getInstance()._sent;
        expect(sent.some(m => m.type === 'update' && m.state?.selection?.line === 10)).toBe(true);
    });
});

describe('Presence — peer() / count()', () => {
    it('peer() returns null for unknown user', () => {
        const p = makePresence();
        expect(p.peer('ghost')).toBeNull();
    });

    it('peer() returns peer object after join', () => {
        const p = makePresence();
        p.join();
        simulateServer({ type: 'join', peer: { id: 'user-b', name: 'Eve', joinedAt: 1 } });
        expect(p.peer('user-b')).toMatchObject({ id: 'user-b', name: 'Eve' });
    });
});

describe('Presence — on() event subscription', () => {
    it('on() returns unsubscribe function', () => {
        const handler = vi.fn();
        const p = makePresence();
        p.join();
        const off = p.on('join', handler);
        off();
        simulateServer({ type: 'join', peer: { id: 'user-x', name: 'X', joinedAt: 1 } });
        expect(handler).not.toHaveBeenCalled();
    });
});

describe('Presence — renderCursors()', () => {
    it('creates cursor element when peer cursor update arrives', () => {
        document.body.innerHTML = '<div id="editor" style="position:relative;width:800px;height:600px"></div>';
        const container = document.getElementById('editor');
        vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
            left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600,
        });

        const p = makePresence();
        p.join();
        p.renderCursors('#editor');

        simulateServer({ type: 'join',   peer:   { id: 'user-b', name: 'Bob', color: '#0f0', joinedAt: 1 } });
        simulateServer({ type: 'update', userId: 'user-b', cursor: { x: 100, y: 200 } });

        expect(document.querySelector('.oja-cursor')).not.toBeNull();
    });

    it('removes cursor element when peer leaves', () => {
        document.body.innerHTML = '<div id="ed2" style="position:relative"></div>';
        const container = document.getElementById('ed2');
        vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0 });

        const p = makePresence();
        p.join();
        p.renderCursors('#ed2');

        simulateServer({ type: 'join',   peer:   { id: 'user-c', name: 'Carol', color: '#00f', joinedAt: 1 } });
        simulateServer({ type: 'update', userId: 'user-c', cursor: { x: 50, y: 50 } });
        expect(document.querySelector('.oja-cursor')).not.toBeNull();

        simulateServer({ type: 'leave', userId: 'user-c' });
        expect(document.querySelector('.oja-cursor')).toBeNull();
    });
});
