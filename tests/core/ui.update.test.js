import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { find, findAll, query, queryAll, make } from '../../src/js/core/ui.js';
import { state } from '../../src/js/core/reactive.js';

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { document.body.innerHTML = ''; });


describe('make() — element creation', () => {
    it('creates an element with the given tag', () => {
        expect(make('div').tagName).toBe('DIV');
    });

    it('applies id', () => {
        expect(make('div', { id: 'myid' }).id).toBe('myid');
    });

    it('applies class string', () => {
        expect(make('div', { class: 'card active' }).className).toBe('card active');
    });

    it('applies class array', () => {
        const el = make('div', { class: ['card', 'elevated'] });
        expect(el.classList.contains('card')).toBe(true);
        expect(el.classList.contains('elevated')).toBe(true);
    });

    it('applies style object', () => {
        const el = make('div', { style: { color: 'red', fontSize: '14px' } });
        expect(el.style.color).toBe('red');
        expect(el.style.fontSize).toBe('14px');
    });

    it('applies attrs', () => {
        const el = make('input', { attrs: { type: 'email', placeholder: 'Email' } });
        expect(el.getAttribute('type')).toBe('email');
        expect(el.getAttribute('placeholder')).toBe('Email');
    });

    it('applies data attributes', () => {
        const el = make('div', { data: { id: '42', status: 'alive' } });
        expect(el.dataset.id).toBe('42');
        expect(el.dataset.status).toBe('alive');
    });

    it('applies on listeners', () => {
        const fn = vi.fn();
        const el = make('button', { on: { click: fn } }, 'Click');
        el.click();
        expect(fn).toHaveBeenCalledOnce();
    });

    it('applies text option', () => {
        expect(make('p', { text: 'Hello' }).textContent).toBe('Hello');
    });

    it('applies html option', () => {
        expect(make('div', { html: '<strong>Bold</strong>' }).innerHTML)
            .toBe('<strong>Bold</strong>');
    });

    it('appends string children as text nodes', () => {
        expect(make('p', 'Hello world').textContent).toBe('Hello world');
    });

    it('appends number children', () => {
        expect(make('span', 42).textContent).toBe('42');
    });

    it('appends Element children', () => {
        const span = document.createElement('span');
        span.textContent = 'child';
        expect(make('div', span).querySelector('span')?.textContent).toBe('child');
    });

    it('appends array of children', () => {
        const items = ['a', 'b', 'c'].map(t => make('li', t));
        expect(make('ul', items).querySelectorAll('li').length).toBe(3);
    });

    it('options is optional — first arg can be a string child', () => {
        expect(make('p', 'Direct text').textContent).toBe('Direct text');
    });

    it('multiple children', () => {
        const el = make('div', make('span', 'A'), make('span', 'B'));
        expect(el.querySelectorAll('span').length).toBe(2);
    });

    it('nested make calls', () => {
        const el = make('ul', { class: 'list' },
            make('li', { data: { id: '1' } }, 'Item 1'),
            make('li', { data: { id: '2' } }, 'Item 2'),
        );
        expect(el.querySelectorAll('li').length).toBe(2);
        expect(el.querySelector('[data-id="2"]')?.textContent).toBe('Item 2');
    });

    it('make(existingElement) enhances and returns it', () => {
        const raw = document.createElement('div');
        const enhanced = make(raw);
        expect(enhanced).toBe(raw);
        expect(typeof enhanced.update).toBe('function');
    });

    it('returned element is enhanced with update/list/render', () => {
        const el = make('div');
        expect(typeof el.update).toBe('function');
        expect(typeof el.list).toBe('function');
        expect(typeof el.render).toBe('function');
    });
});


describe('make shorthand factories', () => {
    it('make.div creates a DIV', () => {
        expect(make.div().tagName).toBe('DIV');
    });

    it('make.span creates a SPAN', () => {
        expect(make.span().tagName).toBe('SPAN');
    });

    it('make.button with options and text', () => {
        const btn = make.button({ class: 'btn' }, 'Save');
        expect(btn.tagName).toBe('BUTTON');
        expect(btn.textContent).toBe('Save');
        expect(btn.classList.contains('btn')).toBe(true);
    });

    it('make.ul with make.li children', () => {
        const ul = make.ul({}, make.li({}, 'A'), make.li({}, 'B'));
        expect(ul.querySelectorAll('li').length).toBe(2);
    });

    it('make.a with href', () => {
        const a = make.a({ attrs: { href: '#/hosts' } }, 'Hosts');
        expect(a.getAttribute('href')).toBe('#/hosts');
    });

    it('make.input with type', () => {
        expect(make.input({ attrs: { type: 'email' } }).getAttribute('type')).toBe('email');
    });

    it('h1–h6 shortcuts all work', () => {
        ['h1','h2','h3','h4','h5','h6'].forEach(tag => {
            expect(make[tag]('Title').tagName).toBe(tag.toUpperCase());
        });
    });

    it('make.table/thead/tbody/tr/td work', () => {
        const table = make.table({},
            make.thead({}, make.tr({}, make.th({}, 'Name'))),
            make.tbody({}, make.tr({}, make.td({}, 'Alice'))),
        );
        expect(table.querySelector('th')?.textContent).toBe('Name');
        expect(table.querySelector('td')?.textContent).toBe('Alice');
    });
});


describe('placement methods', () => {
    it('appendTo() appends inside target selector', () => {
        document.body.innerHTML = '<div id="container"></div>';
        make.span('child').appendTo('#container');
        expect(document.querySelector('#container span')?.textContent).toBe('child');
    });

    it('appendTo() accepts an Element', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        make.span('hi').appendTo(container);
        expect(container.querySelector('span')?.textContent).toBe('hi');
    });

    it('prependTo() inserts as first child', () => {
        document.body.innerHTML = '<div id="box"><span>existing</span></div>';
        make.span('first').prependTo('#box');
        expect(document.querySelector('#box').firstChild?.textContent).toBe('first');
    });

    it('insertAfter() inserts as next sibling', () => {
        document.body.innerHTML = '<div id="a"></div><div id="c"></div>';
        make.div({ id: 'b' }).insertAfter('#a');
        const children = Array.from(document.body.children);
        expect(children[0].id).toBe('a');
        expect(children[1].id).toBe('b');
        expect(children[2].id).toBe('c');
    });

    it('insertBefore() inserts as previous sibling', () => {
        document.body.innerHTML = '<div id="b"></div>';
        make.div({ id: 'a' }).insertBefore('#b');
        const children = Array.from(document.body.children);
        expect(children[0].id).toBe('a');
        expect(children[1].id).toBe('b');
    });

    it('replace() replaces the target', () => {
        document.body.innerHTML = '<div id="old">old</div>';
        make.div({ id: 'new' }, 'new').replace('#old');
        expect(document.querySelector('#old')).toBeNull();
        expect(document.querySelector('#new')?.textContent).toBe('new');
    });

    it('all placement methods return the element for chaining', () => {
        document.body.innerHTML = '<div id="container"></div>';
        const el = make.span('hi');
        expect(el.appendTo('#container')).toBe(el);
    });

    it('chains placement → update', () => {
        document.body.innerHTML = '<div id="container"></div>';
        make.div({ class: 'badge' }, 'Loading')
            .appendTo('#container')
            .update({ text: 'Ready', class: { add: 'loaded' } });
        const badge = document.querySelector('.badge');
        expect(badge?.textContent).toBe('Ready');
        expect(badge?.classList.contains('loaded')).toBe(true);
    });

    it('full chain: make → appendTo → update → list', async () => {
        const { Out } = await import('../../src/js/core/out.js');
        document.body.innerHTML = '<div id="app"></div>';
        make.div({ class: 'host-list' })
            .appendTo('#app')
            .list([{ id: 1, name: 'api' }, { id: 2, name: 'web' }], {
                key:    h => h.id,
                render: h => Out.html(`<div class="row">${h.name}</div>`),
            });
        await new Promise(r => setTimeout(r, 20));
        expect(document.querySelectorAll('.row').length).toBe(2);
    });
});


describe('el.update() — static', () => {
    it('text', () => {
        document.body.innerHTML = '<div id="el"></div>';
        find('#el').update({ text: 'Hello' });
        expect(find('#el').textContent).toBe('Hello');
    });

    it('html', () => {
        document.body.innerHTML = '<div id="el"></div>';
        find('#el').update({ html: '<strong>Bold</strong>' });
        expect(find('#el').innerHTML).toBe('<strong>Bold</strong>');
    });

    it('class add / remove / toggle', () => {
        document.body.innerHTML = '<div id="el" class="active"></div>';
        find('#el').update({ class: { remove: 'active', add: 'done' } });
        expect(find('#el').classList.contains('done')).toBe(true);
        expect(find('#el').classList.contains('active')).toBe(false);
    });

    it('attr set and remove null', () => {
        document.body.innerHTML = '<div id="el" data-old="yes"></div>';
        find('#el').update({ attr: { 'data-state': 'ready', 'data-old': null } });
        expect(find('#el').getAttribute('data-state')).toBe('ready');
        expect(find('#el').hasAttribute('data-old')).toBe(false);
    });

    it('style', () => {
        document.body.innerHTML = '<div id="el"></div>';
        find('#el').update({ style: { color: 'red' } });
        expect(find('#el').style.color).toBe('red');
    });

    it('returns element for chaining', () => {
        document.body.innerHTML = '<div id="el"></div>';
        const el = find('#el');
        expect(el.update({ text: 'hi' })).toBe(el);
    });
});

describe('el.update() — out and fn', () => {
    it('out renders an Out', async () => {
        const { Out } = await import('../../src/js/core/out.js');
        document.body.innerHTML = '<div id="el"></div>';
        find('#el').update({ out: Out.html('<p>Rendered</p>') });
        await new Promise(r => setTimeout(r, 10));
        expect(find('#el').innerHTML).toBe('<p>Rendered</p>');
    });

    it('fn receives and mutates element', async () => {
        document.body.innerHTML = '<div id="el"></div>';
        find('#el').update({ fn: (el) => { el.textContent = 'from fn'; } });
        await new Promise(r => setTimeout(r, 10));
        expect(find('#el').textContent).toBe('from fn');
    });

    it('fn returning Out renders it', async () => {
        const { Out } = await import('../../src/js/core/out.js');
        document.body.innerHTML = '<div id="el"></div>';
        find('#el').update({ fn: async () => Out.html('<em>fn out</em>') });
        await new Promise(r => setTimeout(r, 20));
        expect(find('#el').innerHTML).toBe('<em>fn out</em>');
    });
});

describe('el.update() — reactive', () => {
    it('re-runs when signal changes', async () => {
        document.body.innerHTML = '<div id="el"></div>';
        const [count, setCount] = state(0);
        find('#el').update({ text: () => `Count: ${count()}` });
        await new Promise(r => setTimeout(r, 10));
        expect(find('#el').textContent).toBe('Count: 0');
        setCount(5);
        await new Promise(r => setTimeout(r, 10));
        expect(find('#el').textContent).toBe('Count: 5');
    });
});


describe('el.list()', () => {
    it('renders items', async () => {
        const { Out } = await import('../../src/js/core/out.js');
        document.body.innerHTML = '<div id="list"></div>';
        find('#list').list([{ id: 1, text: 'A' }, { id: 2, text: 'B' }], {
            key:    i => i.id,
            render: i => Out.html(`<div class="item">${i.text}</div>`),
        });
        await new Promise(r => setTimeout(r, 20));
        expect(document.querySelectorAll('.item').length).toBe(2);
    });

    it('renders empty state', async () => {
        const { Out } = await import('../../src/js/core/out.js');
        document.body.innerHTML = '<div id="list"></div>';
        find('#list').list([], {
            key:    i => i.id,
            render: i => Out.html(`<div>${i.text}</div>`),
            empty:  Out.html('<p id="empty">No items</p>'),
        });
        await new Promise(r => setTimeout(r, 20));
        expect(document.querySelector('#empty')).not.toBeNull();
    });

    it('returns element for chaining', () => {
        document.body.innerHTML = '<div id="list"></div>';
        const el = find('#list');
        expect(el.list([], { render: () => {} })).toBe(el);
    });

    it('reactive — re-reconciles when signal changes', async () => {
        const { Out } = await import('../../src/js/core/out.js');
        document.body.innerHTML = '<div id="list"></div>';
        const [items, setItems] = state([{ id: 1, text: 'A' }]);
        find('#list').list(() => items(), {
            key:    i => i.id,
            render: i => Out.html(`<div class="item">${i.text}</div>`),
        });
        await new Promise(r => setTimeout(r, 20));
        expect(document.querySelectorAll('.item').length).toBe(1);
        setItems([{ id: 1, text: 'A' }, { id: 2, text: 'B' }]);
        await new Promise(r => setTimeout(r, 20));
        expect(document.querySelectorAll('.item').length).toBe(2);
    });
});


describe('findAll() / queryAll() — all elements enhanced', () => {
    it('findAll elements have update()', () => {
        document.body.innerHTML = '<span class="tag">a</span><span class="tag">b</span>';
        findAll('.tag').forEach(el => el.update({ class: { add: 'highlighted' } }));
        expect(findAll('.tag').every(el => el.classList.contains('highlighted'))).toBe(true);
    });

    it('queryAll elements have update()', () => {
        document.body.innerHTML = '<span class="tag">a</span><span class="tag">b</span>';
        queryAll('.tag').forEach(el => el.update({ text: 'updated' }));
        expect(queryAll('.tag').every(el => el.textContent === 'updated')).toBe(true);
    });

    it('findAll elements have placement methods', () => {
        document.body.innerHTML = '<span class="tag">a</span>';
        const [el] = findAll('.tag');
        expect(typeof el.appendTo).toBe('function');
        expect(typeof el.insertAfter).toBe('function');
        expect(typeof el.insertBefore).toBe('function');
        expect(typeof el.replace).toBe('function');
    });
});


describe('el.on() — direct listener', () => {
    it('fires handler on event', () => {
        document.body.innerHTML = '<button id="btn">Click</button>';
        const fn = vi.fn();
        find('#btn').on('click', fn);
        find('#btn').click();
        expect(fn).toHaveBeenCalledOnce();
    });

    it('returns element for chaining', () => {
        document.body.innerHTML = '<button id="btn">Click</button>';
        const el = find('#btn');
        expect(el.on('click', () => {})).toBe(el);
    });

    it('chains .on() with .update()', () => {
        document.body.innerHTML = '<button id="btn">Click</button>';
        const fn = vi.fn();
        find('#btn')
            .on('click', fn)
            .update({ class: { add: 'active' } });
        find('#btn').click();
        expect(fn).toHaveBeenCalledOnce();
        expect(find('#btn').classList.contains('active')).toBe(true);
    });
});

describe('el.on() — delegated listener', () => {
    it('fires when event target matches selector', () => {
        document.body.innerHTML = `
            <ul id="list">
                <li data-id="1">A</li>
                <li data-id="2">B</li>
            </ul>`;
        const fn = vi.fn();
        find('#list').on('click', '[data-id]', fn);
        document.querySelector('[data-id="2"]').click();
        expect(fn).toHaveBeenCalledOnce();
        expect(fn.mock.calls[0][1].dataset.id).toBe('2');
    });

    it('does not fire when target is outside element', () => {
        document.body.innerHTML = `
            <ul id="list"><li data-id="1">A</li></ul>
            <span data-id="outside">Outside</span>`;
        const fn = vi.fn();
        find('#list').on('click', '[data-id]', fn);
        document.querySelector('[data-id="outside"]').click();
        expect(fn).not.toHaveBeenCalled();
    });
});

describe('el.once() — fires only once', () => {
    it('direct: fires once then stops', () => {
        document.body.innerHTML = '<button id="btn">Click</button>';
        const fn = vi.fn();
        find('#btn').once('click', fn);
        find('#btn').click();
        find('#btn').click();
        expect(fn).toHaveBeenCalledOnce();
    });

    it('delegated: fires once then stops', () => {
        document.body.innerHTML = '<ul id="list"><li data-id="1">A</li></ul>';
        const fn = vi.fn();
        find('#list').once('click', '[data-id]', fn);
        document.querySelector('[data-id="1"]').click();
        document.querySelector('[data-id="1"]').click();
        expect(fn).toHaveBeenCalledOnce();
    });
});


describe('placement methods — renamed to avoid native collision', () => {
    it('insertAfter inserts as next sibling', () => {
        document.body.innerHTML = '<div id="a"></div><div id="c"></div>';
        make.div({ id: 'b' }).insertAfter('#a');
        const children = Array.from(document.body.children);
        expect(children[0].id).toBe('a');
        expect(children[1].id).toBe('b');
        expect(children[2].id).toBe('c');
    });

    it('insertBefore inserts as previous sibling', () => {
        document.body.innerHTML = '<div id="b"></div>';
        make.div({ id: 'a' }).insertBefore('#b');
        const children = Array.from(document.body.children);
        expect(children[0].id).toBe('a');
        expect(children[1].id).toBe('b');
    });

    it('native el.after() is NOT overwritten by _renderable', () => {
        document.body.innerHTML = '<div id="a"></div>';
        const el = find('#a');
        // Native .after() inserts nodes AFTER this element — it is a different
        // operation from our insertAfter() which inserts this element after a target.
        // Verify the native method is still present and callable.
        const sibling = document.createElement('span');
        el.after(sibling); // native — inserts sibling after #a
        expect(document.body.children[1]).toBe(sibling);
    });

    it('native el.before() is NOT overwritten by _renderable', () => {
        document.body.innerHTML = '<div id="b"></div>';
        const el = find('#b');
        const sibling = document.createElement('span');
        el.before(sibling); // native — inserts sibling before #b
        expect(document.body.children[0]).toBe(sibling);
    });
});