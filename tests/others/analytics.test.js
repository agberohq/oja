import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OjaAnalytics } from '../../src/js/ext/analytics.js';
import { emit } from '../../src/js/core/events.js';

describe('OjaAnalytics', () => {
    let mockFetch;
    let mockSendBeacon;
    let instances = [];

    // Helper: create and register instance for cleanup
    function makeAnalytics(opts) {
        const a = new OjaAnalytics(opts);
        instances.push(a);
        return a;
    }

    beforeEach(() => {
        vi.useFakeTimers();
        instances = [];

        mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
        vi.stubGlobal('fetch', mockFetch);

        mockSendBeacon = vi.fn().mockReturnValue(true);
        Object.defineProperty(navigator, 'sendBeacon', {
            value: mockSendBeacon,
            configurable: true
        });

        // Clear local storage to avoid test bleed
        localStorage.clear();
    });

    afterEach(() => {
        // Destroy all instances to remove their visibilitychange listeners
        instances.forEach(a => a.destroy());
        instances = [];
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('initializes and sets up a session ID', () => {
        const analytics = makeAnalytics();
        analytics.init();
        expect(analytics._getSessionId()).toContain('sess_');
    });

    it('tracks an event and queues it', () => {
        const analytics = makeAnalytics();
        analytics.init({ batchSize: 5 });

        analytics.track('button_clicked', { id: 'save' });
        const q = analytics.getQueue();

        expect(q.length).toBe(1);
        expect(q[0].event).toBe('button_clicked');
        expect(q[0].data.id).toBe('save');
    });

    it('flushes automatically when batchSize is reached', async () => {
        const analytics = makeAnalytics();
        analytics.init({ batchSize: 2 });

        analytics.track('event1');
        expect(mockFetch).not.toHaveBeenCalled();

        analytics.track('event2'); // Hits batch limit

        await Promise.resolve(); // Let fetch resolve

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(requestBody.batch.length).toBe(2);

        expect(analytics.getQueue().length).toBe(0);
    });

    it('identifies users and attaches traits to subsequent events', () => {
        const analytics = makeAnalytics();
        analytics.init({ batchSize: 5 });

        analytics.identify('u123', { plan: 'pro' });
        analytics.track('purchase');

        const q = analytics.getQueue();
        expect(q.length).toBe(2); // 'user_identified' + 'purchase'

        expect(q[1].userId).toBe('u123');
        expect(q[1].plan).toBe('pro');
    });

    it('auto-tracks page views if configured', () => {
        const analytics = makeAnalytics();
        analytics.init({ autoTrackPages: true, batchSize: 5 });

        emit('oja:navigate:end', { path: '/settings', params: { id: 1 } });

        const q = analytics.getQueue();
        expect(q[0].event).toBe('page_view');
        expect(q[0].data.path).toBe('/settings');
    });

    it('drops batch if server returns 413 Payload Too Large', async () => {
        mockFetch.mockResolvedValue({ ok: false, status: 413 });

        const analytics = makeAnalytics();
        analytics.init({ batchSize: 1 });

        analytics.track('giant_payload');
        await Promise.resolve();

        expect(analytics.getQueue().length).toBe(0);
    });

    it('uses sendBeacon on visibilitychange to hidden', () => {
        const analytics = makeAnalytics();
        analytics.init({ batchSize: 10 });

        analytics.track('final_event');
        expect(mockSendBeacon).not.toHaveBeenCalled();

        // Simulate tab close / hide
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));

        expect(mockSendBeacon).toHaveBeenCalledTimes(1);
        expect(analytics.getQueue().length).toBe(0);
    });
});
