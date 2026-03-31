import { describe, it, expect, vi, beforeEach } from 'vitest';
import { component } from '../../src/js/core/component.js';

beforeEach(() => {
    component.clearCache();
    component.configureCache({
        maxSize: 3,
        maxMemory: 5 * 1024 * 1024,
        ttl: 60000,
    });
});


describe('component cache — no infinite loop on oversized payload', () => {
    it('does not loop when a single fetch exceeds maxMemory', async () => {
        component.configure({ maxMemory: 10, maxSize: 20 }); // tiny 10-byte limit

        // Mock fetch to return a large HTML string
        const bigHtml = '<div>' + 'x'.repeat(100) + '</div>'; // 100 bytes, > 10
        global.fetch = vi.fn().mockResolvedValue({
            ok:   true,
            text: () => Promise.resolve(bigHtml),
        });

        // Should complete, not hang
        const result = await Promise.race([
            component.load('test://big-component.html'),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 500)),
        ]);

        expect(result).toBe(bigHtml);
    });

    it('keeps totalBytes non-negative after eviction', async () => {
        global.fetch = vi.fn()
            .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('<div>A</div>') })
            .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('<div>B</div>') });

        await component.load('test://a.html');
        await component.load('test://b.html');
        component.clearCache();

        const stats = component.cacheStats();
        expect(stats.totalBytes).toBeGreaterThanOrEqual(0);
    });
});