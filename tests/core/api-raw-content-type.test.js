import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Api } from '../../src/js/core/api.js';

// ---------------------------------------------------------------------------
// raw: true must not strip a caller-supplied Content-Type.
//
// Regression: `post(url, body, { raw: true, headers: { 'Content-Type': '…' } })`
// used to delete the header, so a plain-text/HCL upload arrived with no
// Content-Type at all. Servers that pick a decoder from that header then
// defaulted to JSON and rejected the body (agbero's host-config create).
// ---------------------------------------------------------------------------
describe('Api raw bodies keep an explicit Content-Type', () => {
    let fetchSpy;

    function okResponse() {
        return new Response(JSON.stringify({ status: 'ok' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    beforeEach(() => {
        fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => okResponse());
    });

    afterEach(() => {
        fetchSpy.mockRestore();
    });

    it('sends the Content-Type the caller provided', async () => {
        const api = new Api({ base: 'http://localhost' });
        await api.post('/hosts', 'domains = ["a.example"]', {
            raw: true,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });

        const [, opts] = fetchSpy.mock.calls[0];
        expect(opts.headers['Content-Type']).toBe('text/plain; charset=utf-8');
        expect(opts.body).toBe('domains = ["a.example"]');
    });

    it('does not add a codec Content-Type for raw bodies without one', async () => {
        const api = new Api({ base: 'http://localhost' });
        await api.post('/hosts', 'raw-payload', { raw: true });

        const [, opts] = fetchSpy.mock.calls[0];
        expect(opts.headers['Content-Type']).toBeUndefined();
    });

    it('json bodies still get the codec Content-Type', async () => {
        const api = new Api({ base: 'http://localhost' });
        await api.post('/hosts', { a: 1 });

        const [, opts] = fetchSpy.mock.calls[0];
        expect(opts.headers['Content-Type']).toContain('json');
    });

    it('FormData keeps the browser-generated boundary', async () => {
        const api = new Api({ base: 'http://localhost' });
        const fd = new FormData();
        fd.append('f', 'v');
        await api.post('/upload', fd, { raw: true });

        const [, opts] = fetchSpy.mock.calls[0];
        expect(opts.headers['Content-Type']).toBeUndefined();
        expect(opts.body).toBe(fd);
    });
});
