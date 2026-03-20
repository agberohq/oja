import { Router, Out, context } from 'https://cdn.jsdelivr.net/npm/@agberohq/oja@latest/build/oja.core.esm.js';

export const [count, setCount] = context('count', 0);

const router = new Router({ mode: 'hash', outlet: '#app' });

// Notice they correctly point to 'pages/...' now
router.Get('/',        Out.component('pages/home.html'));
router.Get('/counter', Out.component('pages/counter.html'));
router.Get('/about',   Out.component('pages/about.html'));

router.NotFound(Out.html(`
  <div style="text-align:center;padding:48px;color:#666">
    <div style="font-size:48px;margin-bottom:16px">404</div>
    <a href="#/" style="color:#888">← Home</a>
  </div>
`));

router.start('/');