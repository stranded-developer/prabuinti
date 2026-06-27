/* === Nav === */
(function initNav() {
  const nav    = document.getElementById('nav');
  const menu   = document.getElementById('navMenu');
  const mobile = document.getElementById('navMobile');

  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 20);
  }, { passive: true });

  menu.addEventListener('click', () => {
    const open = menu.classList.toggle('open');
    mobile.classList.toggle('open', open);
    menu.setAttribute('aria-expanded', open);
  });

  mobile.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => {
      menu.classList.remove('open');
      mobile.classList.remove('open');
    });
  });
})();

/* === Hero Title — word-by-word clip reveal === */
(function initHeroTitle() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const title = document.querySelector('.hero-title');
  if (!title) return;

  function wrapWords(node, delayStart, delayStep) {
    let delay = delayStart;
    const children = Array.from(node.childNodes);
    node.innerHTML = '';

    children.forEach(child => {
      if (child.nodeType === Node.TEXT_NODE) {
        const words = child.textContent.split(/(\s+)/);
        words.forEach(part => {
          if (!part.trim()) {
            node.appendChild(document.createTextNode(part));
          } else {
            const wrapper = document.createElement('span');
            wrapper.className = 'word';
            const inner = document.createElement('span');
            inner.className = 'word-inner';
            inner.style.animationDelay = delay + 'ms';
            inner.textContent = part;
            wrapper.appendChild(inner);
            node.appendChild(wrapper);
            delay += delayStep;
          }
        });
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const clone = child.cloneNode(false);
        const words = child.textContent.split(/(\s+)/);
        words.forEach(part => {
          if (!part.trim()) {
            clone.appendChild(document.createTextNode(part));
          } else {
            const inner = document.createElement('span');
            inner.className = 'word-inner';
            inner.style.animationDelay = delay + 'ms';
            inner.style.display = 'inline-block';
            inner.textContent = part;
            const wrapper = document.createElement('span');
            wrapper.className = 'word';
            wrapper.style.display = 'inline-block';
            wrapper.style.overflow = 'hidden';
            wrapper.style.verticalAlign = 'bottom';
            wrapper.appendChild(inner);
            clone.appendChild(wrapper);
            delay += delayStep;
          }
        });
        node.appendChild(clone);
      }
    });
    return delay;
  }

  wrapWords(title, 180, 80);
})();

/* === Counter animation for hero stats === */
(function initCounters() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const stats = document.querySelectorAll('[data-count]');
  if (!stats.length) return;

  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      const el = e.target;
      const target = parseInt(el.dataset.count, 10);
      const suffix = el.textContent.includes('+') ? '+' : '';
      const duration = 1200;
      const start = performance.now();

      function tick(now) {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = Math.floor(eased * target);
        el.textContent = current + suffix;
        if (progress < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
      io.unobserve(el);
    });
  }, { threshold: 0.5 });

  stats.forEach(el => io.observe(el));
})();

/* === Stagger Reveal for grouped children === */
(function initStagger() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const staggerGroups = [
    { parent: '.about-cards', child: '.about-card', base: 0, step: 70 },
    { parent: '.testimonials-grid', child: '.testimonial', base: 0, step: 60 },
  ];

  staggerGroups.forEach(({ parent, child, base, step }) => {
    const container = document.querySelector(parent);
    if (!container) return;
    const items = container.querySelectorAll(child);
    items.forEach((item, i) => {
      item.classList.add('stagger-child');
      item.style.transitionDelay = (base + i * step) + 'ms';
    });

    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        const children = container.querySelectorAll('.stagger-child');
        children.forEach(c => c.classList.add('visible'));
        io.unobserve(container);
      });
    }, { threshold: 0.08, rootMargin: '-24px 0px' });

    io.observe(container);
  });
})();

/* === Pillars carousel — one card at a time; tap/click cycles 01→02→03→01 === */
(function initPillars() {
  const deck = document.getElementById('pillarsDeck');
  if (!deck) return;
  const cards = Array.from(deck.querySelectorAll('.pillar'));
  const dots  = Array.from(document.querySelectorAll('#pillarsDots .pillars-dot'));
  let current = 0;

  function show(i) {
    current = ((i % cards.length) + cards.length) % cards.length;
    cards.forEach((c, idx) => c.classList.toggle('is-active', idx === current));
    dots.forEach((d, idx) => d.classList.toggle('is-active', idx === current));
  }

  // Clicking the card advances to the next pillar.
  deck.addEventListener('click', () => show(current + 1));
  // Dots jump directly to a pillar (don't bubble into the deck's advance).
  dots.forEach((d, idx) => d.addEventListener('click', (e) => {
    e.stopPropagation();
    show(idx);
  }));

  show(0);
})();

/* === Preloader ===
 * Keeps the page hidden until all above-the-fold (non-lazy) images have
 * loaded, so nothing pops in. The hero video is NOT a gate — it shows a
 * poster/placeholder immediately and buffers in the background.
 */
const Preloader = (function () {
  const el = document.getElementById('preloader');
  let done = false;
  function reveal() {
    if (done) return;
    done = true;
    document.body.classList.remove('preloading');
    if (el) {
      el.classList.add('hidden');
      el.addEventListener('transitionend', () => el.remove(), { once: true });
    }
  }
  // Hard cap: reveal no later than 2s — keeps the load short and predictable.
  setTimeout(reveal, 2000);
  return { reveal };
})();

// Resolves once every eager (non-lazy) resource on the page has loaded.
function whenWindowLoaded() {
  return new Promise(res => {
    if (document.readyState === 'complete') return res();
    window.addEventListener('load', res, { once: true });
  });
}

/* === Lazy images (tuned threshold) ===
 * Loads images ~400px BEFORE they enter the viewport — still lazy (not all
 * upfront), but they're ready just as you scroll to them, so no pop-in.
 * Mark an <img> with data-lazy-src="..." (no src) and call LazyImages.observe
 * for dynamic images, or LazyImages.refresh() to pick up any in the DOM.
 */
const LazyImages = (function () {
  const ROOT_MARGIN = '400px 0px'; // start loading 400px before it appears
  function swap(img) {
    const src = img.getAttribute('data-lazy-src');
    if (src) { img.src = src; img.removeAttribute('data-lazy-src'); }
  }
  const io = ('IntersectionObserver' in window)
    ? new IntersectionObserver((entries, obs) => {
        entries.forEach(e => {
          if (e.isIntersecting) { swap(e.target); obs.unobserve(e.target); }
        });
      }, { rootMargin: ROOT_MARGIN })
    : null;
  function observe(img) {
    if (!img) return;
    if (io) io.observe(img);
    else swap(img); // no IntersectionObserver: just load it
  }
  function refresh() {
    document.querySelectorAll('img[data-lazy-src]').forEach(observe);
  }
  return { observe, refresh };
})();

// Pick up static [data-lazy-src] images (partner logos, etc.)
LazyImages.refresh();

/* Collapsible category filter: a toggle button shows/hides its chip row by
 * flipping `.collapsed` on the wrapping `.cat-filter`. Shared by the products
 * and documents category menus. */
function wireCatToggle(toggleId, filterId) {
  const toggle = document.getElementById(toggleId);
  const filter = document.getElementById(filterId);
  if (!toggle || !filter) return;
  toggle.addEventListener('click', () => {
    const collapsed = filter.classList.toggle('collapsed');
    toggle.setAttribute('aria-expanded', String(!collapsed));
  });
}

/* === Shared catalog loader ===
 * Loads products + projects exactly once and exposes lookup maps so the
 * products grid, the project showcase, and both detail overlays stay in sync.
 */
const Catalog = (function () {
  let promise = null;
  const data = { products: [], projects: [], productsById: {}, projectsById: {} };
  function load() {
    if (promise) return promise;
    promise = Promise.all([
      fetch('/api/products').then(r => r.ok ? r.json() : []).catch(() => []),
      fetch('/api/projects').then(r => r.ok ? r.json() : []).catch(() => []),
    ]).then(([products, projects]) => {
      data.products = products;
      data.projects = projects;
      products.forEach(p => { data.productsById[p.id] = p; });
      projects.forEach(p => { data.projectsById[p.id] = p; });
      return data;
    });
    return promise;
  }
  return { load, data };
})();

/* === Shared Lightbox (zoom a single photo) === */
const Lightbox = (function () {
  const lb    = document.getElementById('pdLightbox');
  const lbImg = document.getElementById('pdlbImg');
  if (!lb) return { open() {}, close() {}, isOpen: () => false };
  function open(src) {
    lbImg.src = src;
    lb.classList.add('open');
    lb.setAttribute('aria-hidden', 'false');
  }
  function close() {
    lb.classList.remove('open');
    lb.setAttribute('aria-hidden', 'true');
  }
  const closeBtn = document.getElementById('pdlbClose');
  if (closeBtn) closeBtn.addEventListener('click', close);
  lb.addEventListener('click', e => { if (e.target === lb) close(); });
  return { open, close, isOpen: () => lb.classList.contains('open') };
})();

/* === Product Detail Overlay ===
 * Fancy animated full-screen product view with the projects that use it.
 * ProductDetail.open(product, linkedProjects) populates and animates it in.
 */
const ProductDetail = (function () {
  const root = document.getElementById('productDetail');
  if (!root) return { open() {} };

  const imgEl    = document.getElementById('pdImg');
  const catEl    = document.getElementById('pdCat');
  const nameEl   = document.getElementById('pdName');
  const descEl   = document.getElementById('pdDesc');
  const ctaEl    = document.getElementById('pdCta');
  const projWrap = document.getElementById('pdProjects');
  const projList = document.getElementById('pdProjectsList');
  const scroll   = document.getElementById('pdScroll');
  const WA       = 'https://wa.me/6285199881929';

  let isOpen = false;

  function open(product, projects) {
    // Hero
    if (product.image) {
      imgEl.src = product.image;
      imgEl.style.display = '';
    } else {
      imgEl.removeAttribute('src');
      imgEl.style.display = 'none';
    }
    imgEl.alt        = product.name || '';
    catEl.textContent  = product.category || '';
    nameEl.textContent = product.name || '';
    descEl.textContent = product.description || '';
    ctaEl.href = WA + '?text=' + encodeURIComponent(
      'Halo, saya tertarik dengan produk ' + (product.name || '') + '. Boleh minta penawaran?'
    );

    // Projects that use this product
    projList.innerHTML = '';
    const valid = (projects || []).filter(pr => pr && Array.isArray(pr.images) && pr.images.length);
    if (valid.length) {
      valid.forEach(pr => {
        const block = document.createElement('div');
        block.className = 'pd-project';

        const h = document.createElement('button');
        h.type = 'button';
        h.className = 'pd-project-title pd-project-link';
        h.innerHTML = `<span>${pr.title || 'Proyek'}</span>`
          + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3"/></svg>';
        const goToProject = () => { close(); ProjectDetail.open(pr); };
        h.addEventListener('click', goToProject);

        const gal = document.createElement('div');
        gal.className = 'pd-gallery';
        pr.images.forEach((src, i) => {
          const shot = document.createElement('div');
          shot.className = 'pd-shot pd-shot--link';
          shot.style.animationDelay = Math.min(i * 60, 420) + 'ms';
          const im = document.createElement('img');
          im.src = src;
          im.alt = pr.title || '';
          im.loading = 'lazy';
          shot.appendChild(im);
          shot.addEventListener('click', goToProject);
          gal.appendChild(shot);
        });

        block.appendChild(h);
        block.appendChild(gal);
        projList.appendChild(block);
      });
      projWrap.hidden = false;
    } else {
      projWrap.hidden = true;
    }

    scroll.scrollTop = 0;
    root.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => root.classList.add('open'));
    isOpen = true;
  }

  function close() {
    root.classList.remove('open');
    root.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    Lightbox.close();
    isOpen = false;
  }

  document.getElementById('pdClose').addEventListener('click', close);
  root.querySelectorAll('[data-pd-close]').forEach(el => el.addEventListener('click', close));
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (Lightbox.isOpen()) Lightbox.close();
    else if (isOpen) close();
  });

  return { open, close, isOpen: () => isOpen };
})();

/* === Project Detail Overlay ===
 * Full-screen project view: name, year, location, photo gallery, and the
 * products used (each links through to that product's detail overlay).
 * ProjectDetail.open(project) populates and animates it in.
 */
const ProjectDetail = (function () {
  const root = document.getElementById('projectDetail');
  if (!root) return { open() {} };

  const heroImg  = document.getElementById('prjHeroImg');
  const nameEl   = document.getElementById('prjName');
  const metaEl   = document.getElementById('prjMeta');
  const descEl   = document.getElementById('prjDesc');
  const prodWrap = document.getElementById('prjProducts');
  const prodList = document.getElementById('prjProductsList');
  const scroll   = document.getElementById('prjScroll');

  let isOpen = false;

  const ICONS = {
    year:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
    location: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  };

  // Manual prev/next + dots carousel over the hero image (multi-image projects).
  function buildHeroCarousel(media, images) {
    let cur = 0;
    const mkNav = (cls, label, path) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'prj-cz prj-cz-nav ' + cls;
      b.setAttribute('aria-label', label);
      b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`;
      return b;
    };
    const prev = mkNav('prj-cz-prev', 'Sebelumnya', 'M15 18l-6-6 6-6');
    const next = mkNav('prj-cz-next', 'Berikutnya', 'M9 18l6-6-6-6');
    const dots = document.createElement('div');
    dots.className = 'prj-cz prj-cz-dots';
    images.forEach((_, i) => {
      const d = document.createElement('button');
      d.type = 'button'; d.className = 'prj-cz-dot';
      d.setAttribute('aria-label', 'Foto ' + (i + 1));
      d.addEventListener('click', () => go(i));
      dots.appendChild(d);
    });
    function go(i) {
      cur = (i + images.length) % images.length;
      heroImg.src = images[cur];
      dots.querySelectorAll('.prj-cz-dot').forEach((d, j) => d.classList.toggle('active', j === cur));
    }
    prev.addEventListener('click', () => go(cur - 1));
    next.addEventListener('click', () => go(cur + 1));
    media.appendChild(prev); media.appendChild(next); media.appendChild(dots);
    images.forEach(s => { const im = new Image(); im.src = s; });
    go(0);
  }

  function open(project) {
    const images = (Array.isArray(project.images) ? project.images : []).filter(Boolean);

    // Hero — clear any controls left over from a previous open.
    const media = heroImg.parentElement;
    media.querySelectorAll('.prj-cz').forEach(el => el.remove());
    if (images[0]) {
      heroImg.src = images[0];
      heroImg.style.display = '';
    } else {
      heroImg.removeAttribute('src');
      heroImg.style.display = 'none';
    }
    heroImg.alt = project.title || '';
    if (images.length > 1) buildHeroCarousel(media, images);
    nameEl.textContent = project.title || 'Proyek';

    // Meta — tahun + lokasi
    metaEl.innerHTML = '';
    if (project.year) {
      const it = document.createElement('span');
      it.className = 'prj-meta-item';
      it.innerHTML = ICONS.year + '<span>Tahun <b>' + project.year + '</b></span>';
      metaEl.appendChild(it);
    }
    if (project.location) {
      const it = document.createElement('span');
      it.className = 'prj-meta-item';
      it.innerHTML = ICONS.location + '<span><b>' + project.location + '</b></span>';
      metaEl.appendChild(it);
    }

    // Description
    if (project.description) {
      descEl.textContent = project.description;
      descEl.style.display = '';
    } else {
      descEl.textContent = '';
      descEl.style.display = 'none';
    }

    // Products used in this project
    prodList.innerHTML = '';
    const products = (project.productIds || [])
      .map(id => Catalog.data.productsById[id])
      .filter(Boolean);
    if (products.length) {
      products.forEach((prod, i) => {
        const cell = document.createElement('div');
        cell.className = 'prj-prod';
        cell.style.animationDelay = Math.min(i * 60, 420) + 'ms';
        cell.innerHTML = prod.image
          ? `<img src="${prod.image}" alt="${prod.name || ''}" loading="lazy">`
          : `<div class="prj-prod-placeholder">PI</div>`;
        const label = document.createElement('div');
        label.className = 'prj-prod-label';
        label.innerHTML = `<span class="cat">${prod.category || ''}</span><span class="name">${prod.name || ''}</span>`;
        cell.appendChild(label);
        cell.addEventListener('click', () => {
          close();
          const linked = (prod.projectIds || [])
            .map(pid => Catalog.data.projectsById[pid])
            .filter(Boolean);
          ProductDetail.open(prod, linked);
        });
        prodList.appendChild(cell);
      });
      prodWrap.hidden = false;
    } else {
      prodWrap.hidden = true;
    }

    scroll.scrollTop = 0;
    root.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => root.classList.add('open'));
    isOpen = true;
  }

  function close() {
    root.classList.remove('open');
    root.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    Lightbox.close();
    isOpen = false;
  }

  document.getElementById('prjClose').addEventListener('click', close);
  root.querySelectorAll('[data-prj-close]').forEach(el => el.addEventListener('click', close));
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (Lightbox.isOpen()) Lightbox.close();
    else if (isOpen) close();
  });

  return { open, close };
})();

/* === Homepage Data + Hero Video + Portfolio + Alderon ===
 * One fetch drives all dynamic homepage content.
 * Hero: a single looping MP4 background video (managed via admin).
 */
(async function initHomepage() {
  let hp = { heroVideo: '', alderonImage: '', alderonTitle: '', alderonSub: '', alderonDesc: '', alderonFeatures: null, portfolio: [] };
  try {
    const r = await fetch('/api/homepage');
    if (r.ok) {
      const data = await r.json();
      if (data.heroVideo) hp.heroVideo = data.heroVideo;
      if (data.alderonImage) hp.alderonImage = data.alderonImage;
      if (data.alderonTitle) hp.alderonTitle = data.alderonTitle;
      if (data.alderonSub) hp.alderonSub = data.alderonSub;
      if (data.alderonDesc) hp.alderonDesc = data.alderonDesc;
      if (Array.isArray(data.alderonFeatures)) hp.alderonFeatures = data.alderonFeatures;
      if (Array.isArray(data.portfolio)) hp.portfolio = data.portfolio;
    }
  } catch {}

  // --- Hero video ---
  // The server normally inlines the <video src> into the HTML, so the download
  // is already in flight by now. Only set it from the API if it wasn't inlined
  // (e.g. config changed since the cached HTML, or served as a static file).
  const heroVideo = document.getElementById('heroVideo');
  const heroWrap  = document.querySelector('.hero-video');
  if (heroVideo) {
    if (!heroVideo.getAttribute('poster') && hp.heroPoster) heroVideo.poster = hp.heroPoster;
    if (!heroVideo.getAttribute('src') && hp.heroVideo) {
      heroVideo.preload = 'auto';
      heroVideo.src = hp.heroVideo;
      heroVideo.load();
    }
    if (heroVideo.getAttribute('src')) {
      // Set muted/playsInline as JS properties too (not just attributes) — some
      // browsers only honour them for autoplay when set this way.
      heroVideo.muted = true;
      heroVideo.playsInline = true;
      heroVideo.play().catch(() => {
        // Autoplay was blocked (e.g. iOS Low Power Mode / strict policy). Retry
        // on the first real user gesture anywhere on the page, so the visitor
        // never has to hunt for the video's play button. Keep listening until
        // it actually starts (a single gesture is enough for a muted video).
        const events = ['pointerdown', 'touchstart', 'keydown', 'click'];
        const kick = () => {
          heroVideo.play().then(() => {
            events.forEach(ev => window.removeEventListener(ev, kick));
          }).catch(() => {});
        };
        events.forEach(ev => window.addEventListener(ev, kick, { passive: true }));
      });
    } else if (heroWrap) {
      heroWrap.classList.add('hero-video-empty');
    }
  } else if (heroWrap) {
    heroWrap.classList.add('hero-video-empty');
  }

  // The hero video is no longer a gate: it shows a poster/placeholder instantly
  // and fills in as it buffers, so we reveal as soon as eager images are loaded.
  whenWindowLoaded().then(Preloader.reveal);

  // --- Alderon featured image + copy ---
  // The title/description default to the static HTML; only overwrite them when
  // the admin has set a custom value, so the page never renders blank.
  {
    const img = document.getElementById('alderonFeaturedImg');
    if (img) {
      if (hp.alderonImage) img.setAttribute('data-lazy-src', hp.alderonImage);
      LazyImages.observe(img);
    }
    const titleEl = document.getElementById('alderonBrandText');
    if (titleEl && hp.alderonTitle) titleEl.textContent = hp.alderonTitle;
    const subEl = document.getElementById('alderonSub');
    if (subEl && hp.alderonSub) subEl.textContent = hp.alderonSub;
    const descEl = document.getElementById('alderonDesc');
    if (descEl && hp.alderonDesc) descEl.textContent = hp.alderonDesc;

    const listEl = document.getElementById('alderonFeaturesList');
    if (listEl && Array.isArray(hp.alderonFeatures) && hp.alderonFeatures.length) {
      listEl.innerHTML = '';
      hp.alderonFeatures.forEach((text, i) => {
        const li = document.createElement('li');
        li.className = 'alderon-feature-item';
        const num = document.createElement('span');
        num.className = 'afi-num';
        num.textContent = String(i + 1).padStart(2, '0');
        const t = document.createElement('span');
        t.className = 'afi-text';
        t.textContent = text;
        li.append(num, t);
        listEl.appendChild(li);
      });
    }
  }

  // --- Project showcase ---
  // Rendered from the Proyek collection (clickable → detail overlay). If the
  // collection is empty we fall back to the static homepage collage so the
  // section is never blank.
  renderProjectShowcase(hp.portfolio || []);
})();

async function renderProjectShowcase(portfolioFallback) {
  const grid = document.getElementById('projectsGrid');
  if (!grid) return;
  const searchWrap  = document.querySelector('.projects .catalog-search');
  const searchInput = document.getElementById('projectsSearch');
  const emptyEl     = document.getElementById('projectsEmpty');

  const { projects } = await Catalog.load();

  if (projects.length) {
    // Auto-rotate a card's cover through all its images while it's on screen:
    // one image every 2s, two full loops, then settle back on the first.
    function attachProjectAutoCarousel(card, baseImg, images) {
      card.classList.add('pc-carousel');
      baseImg.classList.add('pc-on');
      const overlay = document.createElement('img');
      overlay.alt = baseImg.alt;
      baseImg.insertAdjacentElement('afterend', overlay);
      images.forEach(src => { const im = new Image(); im.src = src; }); // warm the cache

      const layers = [baseImg, overlay];
      let visible = 0, idx = 0, advances = 0, timer = null;
      const MAX = images.length * 2;

      function goTo(i) {
        const nxt = layers[1 - visible];
        nxt.src = images[i];
        nxt.classList.add('pc-on');
        layers[visible].classList.remove('pc-on');
        visible = 1 - visible; idx = i;
      }
      function resetToFirst() {
        layers[0].src = images[0]; layers[0].classList.add('pc-on');
        layers[1].classList.remove('pc-on');
        visible = 0; idx = 0;
      }
      function stop() { if (timer) { clearInterval(timer); timer = null; } }
      function start() {
        if (timer) return;
        advances = 0;
        timer = setInterval(() => {
          goTo((idx + 1) % images.length);
          if (++advances >= MAX) { stop(); if (idx !== 0) goTo(0); }
        }, 2000);
      }

      const io = new IntersectionObserver(entries => {
        entries.forEach(e => { if (e.isIntersecting) start(); else { stop(); resetToFirst(); } });
      }, { threshold: 0.5 });
      io.observe(card);
    }

    function makeProjectCard(pr) {
      const card = document.createElement('div');
      card.className = 'project-card reveal visible';
      const images = (pr.images || []).filter(Boolean);
      const cover = images[0] || '';
      if (cover) {
        const img = document.createElement('img');
        img.alt = pr.title || '';
        img.setAttribute('data-lazy-src', cover);
        card.appendChild(img);
        LazyImages.observe(img);
        if (images.length > 1) attachProjectAutoCarousel(card, img, images);
      } else {
        card.innerHTML = `<div class="portfolio-placeholder"><span>${pr.title || 'Proyek'}</span></div>`;
      }
      const label = document.createElement('div');
      label.className = 'project-label';
      label.textContent = pr.title || 'Proyek';
      card.appendChild(label);
      card.style.cursor = 'pointer';
      card.addEventListener('click', () => ProjectDetail.open(pr));
      return card;
    }

    function renderList(list) {
      grid.innerHTML = '';
      list.forEach(pr => grid.appendChild(makeProjectCard(pr)));
      if (emptyEl) emptyEl.hidden = list.length > 0;
      LazyImages.refresh();
    }

    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const q = searchInput.value.trim().toLowerCase();
        renderList(!q ? projects : projects.filter(pr =>
          `${pr.title || ''} ${pr.location || ''} ${pr.year || ''} ${pr.description || ''}`.toLowerCase().includes(q)));
      });
    }

    renderList(projects);
    return;
  }

  // No projects yet — hide the search box so it doesn't filter the static collage.
  if (searchWrap) searchWrap.hidden = true;

  // Fallback: static collage from homepage.json (not clickable)
  grid.innerHTML = '';
  (portfolioFallback.length ? portfolioFallback : [
    { title: 'Gudang Konstruksi' }, { title: 'Bangunan Masjid' }, { title: 'Bangunan Gudang' },
  ]).forEach(item => {
    const card = document.createElement('div');
    card.className = 'project-card reveal visible';
    if (item.image) {
      const img = document.createElement('img');
      img.alt = item.title || '';
      img.setAttribute('data-lazy-src', item.image);
      card.appendChild(img);
      LazyImages.observe(img);
    } else {
      card.innerHTML = `<div class="portfolio-placeholder"><span>${item.title || ''}</span></div>`;
    }
    const label = document.createElement('div');
    label.className = 'project-label';
    label.textContent = item.title || '';
    card.appendChild(label);
    grid.appendChild(card);
  });
}

/* === Products — six at a time in a normal grid ===
 * Shows one "page" of six products. Each "Lihat 6 Lainnya" advances to the
 * next six (wrapping around when it reaches the end).
 */
(async function initProducts() {
  const grid         = document.getElementById('productsGrid');
  const countEl      = document.getElementById('productsCount');
  const catContainer = document.getElementById('categories');
  if (!grid) return;

  const PAGE = 6;
  let all = [], filtered = [], page = 0;
  let activeCat = 'Semua', searchTerm = '';
  const searchInput = document.getElementById('productsSearch');
  const projectsById = Catalog.data.projectsById;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

  // Control row (page counter + reveal button) sits just below the grid.
  const moreRow = document.createElement('div');
  moreRow.className = 'products-more';
  moreRow.hidden = true;
  moreRow.innerHTML =
    '<span class="products-more-count" id="productsPage"></span>' +
    '<button class="products-show-more" id="showMoreBtn">' +
      '<span id="showMoreLabel">Lihat 6 Lainnya</span>' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>' +
    '</button>';
  grid.after(moreRow);
  const pageEl  = moreRow.querySelector('#productsPage');
  const moreBtn = moreRow.querySelector('#showMoreBtn');
  const moreLbl = moreRow.querySelector('#showMoreLabel');

  try {
    const data = await Catalog.load();
    all = data.products;
  } catch {
    grid.innerHTML = '<p style="color:var(--text-3);font-size:14px;">Gagal memuat produk.</p>';
    return;
  }

  // Category filter order managed in the back office (/api/categories).
  let catNames = [];
  try {
    const r = await fetch('/api/categories');
    if (r.ok) catNames = (await r.json()).map(c => c.name);
  } catch {}
  const catSet     = new Set(all.map(p => p.category));
  const ordered    = catNames.filter(c => catSet.has(c));
  const extras     = [...catSet].filter(c => c && !catNames.includes(c));
  const categories = ['Semua', ...ordered, ...extras];

  categories.forEach((cat, i) => {
    const btn = document.createElement('button');
    btn.className = 'cat-btn' + (i === 0 ? ' active' : '');
    btn.textContent = cat;
    btn.addEventListener('click', () => {
      catContainer.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeCat = cat;
      applyFilters();
    });
    catContainer.appendChild(btn);
  });

  wireCatToggle('productsCatToggle', 'productsCatFilter');

  // Combine the active category with the free-text search box.
  function applyFilters() {
    const q = searchTerm.trim().toLowerCase();
    let list = activeCat === 'Semua' ? all : all.filter(p => p.category === activeCat);
    if (q) list = list.filter(p =>
      `${p.name || ''} ${p.category || ''} ${p.description || ''}`.toLowerCase().includes(q));
    setFilter(list);
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => { searchTerm = searchInput.value; applyFilters(); });
  }

  function setFilter(list) {
    filtered = list;
    page = 0;
    countEl.textContent = list.length + ' Material';
    renderPage();
  }

  function renderPage() {
    const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE));
    page = ((page % pageCount) + pageCount) % pageCount;   // wrap both ways
    const start = page * PAGE;
    const slice = filtered.slice(start, start + PAGE);

    grid.innerHTML = '';
    slice.forEach((p, i) => {
      const card = document.createElement('div');
      card.className = 'product-card';
      card.style.transitionDelay = Math.min(i * 60, 320) + 'ms';
      const imgHtml = p.image
        ? `<img data-lazy-src="${esc(p.image)}" alt="${esc(p.name)}">`
        : `<div class="product-img-placeholder">PI</div>`;
      card.innerHTML =
        `<div class="product-img">${imgHtml}</div>` +
        `<div class="product-info">` +
          `<div class="product-cat">${esc(p.category)}</div>` +
          `<div class="product-name">${esc(p.name)}</div>` +
          `<div class="product-desc">${esc(p.description)}</div>` +
        `</div>`;
      card.addEventListener('click', () => {
        const linked = (p.projectIds || []).map(id => projectsById[id]).filter(Boolean);
        ProductDetail.open(p, linked);
      });
      grid.appendChild(card);
      requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add('visible')));
    });

    LazyImages.refresh();

    if (filtered.length <= PAGE) {
      moreRow.hidden = true;
    } else {
      moreRow.hidden = false;
      pageEl.innerHTML = `<b>${String(page + 1).padStart(2, '0')}</b> / ${String(pageCount).padStart(2, '0')}`;
      const remaining = filtered.length - (start + slice.length);
      const next = remaining > 0 ? Math.min(PAGE, remaining) : Math.min(PAGE, filtered.length);
      moreLbl.textContent = `Lihat ${next} Lainnya`;
    }
  }

  moreBtn.addEventListener('click', () => { page += 1; renderPage(); });

  applyFilters();
})();

/* === Overlay back-button / history nav ===
 * Shared history handling for the fullscreen overlays (the "Berita Lainnya"
 * list and the news detail). Each open() pushes a history entry and registers
 * a DOM-only close fn; the browser/device back button — or an in-overlay
 * back/close control calling requestClose() — pops it and closes the topmost
 * overlay. Nesting works: open the list, then a detail on top, and back closes
 * the detail first, then the list, then leaves the section.
 */
const OverlayNav = (function () {
  const stack = []; // [{ name, close }] — topmost overlay last
  function open(name, closeFn) {
    stack.push({ name, close: closeFn });
    history.pushState({ piOverlay: name }, '');
  }
  function requestClose() { if (stack.length) history.back(); }
  window.addEventListener('popstate', () => {
    const top = stack.pop();
    if (top) top.close();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && stack.length) requestClose(); });
  return { open, requestClose };
})();

/* === News Detail Overlay + Comments ===
 * Fullscreen news view (like product/project detail). Anyone can read comments
 * live (polled). To comment, a visitor verifies their phone via OTP, then sets
 * a display name (asked once). One comment per phone per post (edit replaces).
 */
const NewsDetail = (function () {
  const root = document.getElementById('newsDetail');
  if (!root) return { open() {} };

  const mediaEl   = document.getElementById('ndMedia');
  const dateEl    = document.getElementById('ndDate');
  const titleEl   = document.getElementById('ndTitle');
  const descEl    = document.getElementById('ndDesc');
  const listEl    = document.getElementById('ndCommentList');
  const countEl   = document.getElementById('ndCount');
  const composeEl = document.getElementById('ndCompose');
  const scroll    = document.getElementById('ndScroll');

  const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  function fmtDate(d) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || '');
    return m ? Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1] : (d || '');
  }
  function fmtTime(iso) {
    const t = Date.parse(iso || '');
    if (isNaN(t)) return '';
    const diff = (Date.now() - t) / 1000;
    if (diff < 60)     return 'Baru saja';
    if (diff < 3600)   return Math.floor(diff / 60) + ' menit lalu';
    if (diff < 86400)  return Math.floor(diff / 3600) + ' jam lalu';
    if (diff < 604800) return Math.floor(diff / 86400) + ' hari lalu';
    const d = new Date(t);
    return d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()] + ' ' + d.getFullYear();
  }
  function maskPhone(p) {
    const s = String(p).replace(/\D/g, '');
    if (s.length < 6) return s;
    return s.slice(0, 4) + '****' + s.slice(-2);
  }

  let isOpen = false, current = null, pollTimer = null;
  let userToken = localStorage.getItem('ia_user_token') || '';
  let userName  = localStorage.getItem('ia_user_name')  || '';
  let pendingPhone = '';

  const authHeaders = () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + userToken });
  function saveSession(token, name) {
    if (token) { userToken = token; localStorage.setItem('ia_user_token', token); }
    if (name)  { userName = name;  localStorage.setItem('ia_user_name', name); }
  }
  function clearSession() {
    userToken = ''; userName = '';
    localStorage.removeItem('ia_user_token');
    localStorage.removeItem('ia_user_name');
  }
  function setErr(msg) {
    const e = document.getElementById('ndErr');
    if (!e) return;
    e.textContent = msg || '';
    e.classList.toggle('show', !!msg);
  }

  // --- Comments ---
  async function loadComments() {
    if (!current) return;
    try {
      const r = await fetch(`/api/news/${current.id}/comments`);
      if (r.ok) renderComments(await r.json());
    } catch {}
  }
  function renderComments(list) {
    countEl.textContent = list.length ? '(' + list.length + ')' : '';
    listEl.innerHTML = '';
    if (!list.length) {
      listEl.innerHTML = '<div class="nd-comment-empty">Belum ada komentar. Jadilah yang pertama!</div>';
      return;
    }
    list.forEach(c => {
      const isMe = userName && c.name === userName;
      const el = document.createElement('div');
      el.className = 'nd-comment' + (isMe ? ' is-me' : '');
      el.innerHTML =
        `<div class="nd-comment-avatar">${esc((c.name || '?').trim().charAt(0) || '?')}</div>` +
        `<div class="nd-comment-main">` +
          `<div class="nd-comment-head"><span class="nd-comment-name">${esc(c.name)}</span>` +
          `<span class="nd-comment-time">${esc(fmtTime(c.updatedAt || c.createdAt))}</span></div>` +
          `<div class="nd-comment-text">${esc(c.text)}</div>` +
        `</div>`;
      listEl.appendChild(el);
    });
  }

  // --- Composer / auth panels ---
  async function renderCompose() {
    if (!userToken) return renderPhone();
    if (!userName)  return renderName();
    let mine = {};
    try {
      const r = await fetch(`/api/news/${current.id}/my-comment`, { headers: authHeaders() });
      if (r.status === 401) { clearSession(); return renderPhone(); }
      if (r.ok) mine = await r.json();
    } catch {}
    renderComposer(mine && mine.text ? mine.text : '');
  }

  function renderPhone() {
    composeEl.innerHTML =
      `<div class="nd-compose-title">Ikut berkomentar</div>` +
      `<div class="nd-compose-sub">Verifikasi nomor WhatsApp Anda untuk mengirim komentar. Satu komentar per berita.</div>` +
      `<div class="nd-error" id="ndErr"></div>` +
      `<input class="nd-field" id="ndPhone" type="tel" inputmode="tel" placeholder="Contoh: 08123456789" autocomplete="tel">` +
      `<button class="nd-btn" id="ndSend">Kirim Kode OTP</button>`;
    document.getElementById('ndSend').addEventListener('click', sendOtp);
    document.getElementById('ndPhone').addEventListener('keydown', e => { if (e.key === 'Enter') sendOtp(); });
  }

  async function sendOtp() {
    const phone = (document.getElementById('ndPhone').value || '').trim();
    if (!phone) return setErr('Masukkan nomor WhatsApp Anda.');
    const btn = document.getElementById('ndSend');
    btn.disabled = true; btn.textContent = 'Mengirim...';
    try {
      const r = await fetch('/api/comment-auth/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone }) });
      const d = await r.json();
      if (!r.ok) { setErr(d.error || 'Gagal mengirim OTP'); btn.disabled = false; btn.textContent = 'Kirim Kode OTP'; return; }
      pendingPhone = phone;
      renderOtp(!!d.dev);
    } catch { setErr('Tidak dapat terhubung'); btn.disabled = false; btn.textContent = 'Kirim Kode OTP'; }
  }

  function renderOtp(dev) {
    composeEl.innerHTML =
      `<div class="nd-compose-title">Masukkan Kode OTP</div>` +
      `<div class="nd-compose-sub">Kode 6 digit dikirim ke <strong>${esc(maskPhone(pendingPhone))}</strong>.</div>` +
      `<div class="nd-error" id="ndErr"></div>` +
      `<input class="nd-field nd-otp-field" id="ndOtp" inputmode="numeric" maxlength="6" placeholder="------">` +
      `<div class="nd-row"><button class="nd-btn" id="ndVerify">Verifikasi</button>` +
      `<button class="nd-btn-text" id="ndBack">Ganti nomor</button></div>` +
      (dev ? `<div class="nd-note">Mode dev: kode OTP tampil di konsol server.</div>` : '');
    const otp = document.getElementById('ndOtp');
    otp.focus();
    otp.addEventListener('keydown', e => { if (e.key === 'Enter') verifyOtp(); });
    document.getElementById('ndVerify').addEventListener('click', verifyOtp);
    document.getElementById('ndBack').addEventListener('click', renderPhone);
  }

  async function verifyOtp() {
    const otp = (document.getElementById('ndOtp').value || '').trim();
    if (otp.length < 6) return setErr('Masukkan 6 digit kode OTP.');
    const btn = document.getElementById('ndVerify');
    btn.disabled = true; btn.textContent = 'Memverifikasi...';
    try {
      const r = await fetch('/api/comment-auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: pendingPhone, otp }) });
      const d = await r.json();
      if (!r.ok) { setErr(d.error || 'Verifikasi gagal'); btn.disabled = false; btn.textContent = 'Verifikasi'; return; }
      saveSession(d.token, d.name);
      if (d.needName || !d.name) renderName();
      else { renderComposer(''); loadComments(); }
    } catch { setErr('Tidak dapat terhubung'); btn.disabled = false; btn.textContent = 'Verifikasi'; }
  }

  function renderName() {
    composeEl.innerHTML =
      `<div class="nd-compose-title">Nama Anda</div>` +
      `<div class="nd-compose-sub">Nama ini akan ditampilkan pada komentar Anda.</div>` +
      `<div class="nd-error" id="ndErr"></div>` +
      `<input class="nd-field" id="ndName" maxlength="40" placeholder="Nama lengkap" autocomplete="name">` +
      `<button class="nd-btn" id="ndSaveName">Simpan & Lanjut</button>`;
    const nm = document.getElementById('ndName');
    nm.focus();
    nm.addEventListener('keydown', e => { if (e.key === 'Enter') saveName(); });
    document.getElementById('ndSaveName').addEventListener('click', saveName);
  }

  async function saveName() {
    const name = (document.getElementById('ndName').value || '').trim();
    if (!name) return setErr('Nama wajib diisi.');
    const btn = document.getElementById('ndSaveName');
    btn.disabled = true; btn.textContent = 'Menyimpan...';
    try {
      const r = await fetch('/api/comment-auth/name', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ name }) });
      const d = await r.json();
      if (!r.ok) { setErr(d.error || 'Gagal menyimpan nama'); btn.disabled = false; btn.textContent = 'Simpan & Lanjut'; return; }
      saveSession(d.token, d.name);
      renderComposer('');
    } catch { setErr('Tidak dapat terhubung'); btn.disabled = false; btn.textContent = 'Simpan & Lanjut'; }
  }

  function renderComposer(existingText) {
    const editing = !!existingText;
    composeEl.innerHTML =
      `<div class="nd-compose-title">${editing ? 'Komentar Anda' : 'Tulis komentar'}</div>` +
      `<div class="nd-compose-sub">Masuk sebagai <strong>${esc(userName)}</strong>. ` +
      `<button class="nd-btn-text" id="ndLogout" style="padding:0;">Ganti akun</button></div>` +
      `<div class="nd-error" id="ndErr"></div>` +
      `<textarea class="nd-field" id="ndText" maxlength="500" placeholder="Tulis komentar Anda...">${esc(existingText)}</textarea>` +
      `<button class="nd-btn" id="ndPost">${editing ? 'Perbarui Komentar' : 'Kirim Komentar'}</button>` +
      (editing ? `<div class="nd-note">Anda hanya dapat memiliki satu komentar per berita — mengirim akan memperbarui komentar Anda.</div>` : '');
    document.getElementById('ndPost').addEventListener('click', postComment);
    document.getElementById('ndLogout').addEventListener('click', () => { clearSession(); renderPhone(); });
  }

  async function postComment() {
    const text = (document.getElementById('ndText').value || '').trim();
    if (!text) return setErr('Komentar tidak boleh kosong.');
    const btn = document.getElementById('ndPost');
    btn.disabled = true; btn.textContent = 'Mengirim...';
    try {
      const r = await fetch(`/api/news/${current.id}/comments`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ text }) });
      const d = await r.json();
      if (r.status === 401) { clearSession(); return renderPhone(); }
      if (!r.ok) { setErr(d.error || 'Gagal mengirim komentar'); btn.disabled = false; btn.textContent = 'Kirim Komentar'; return; }
      await loadComments();
      renderComposer(d.text || text);
    } catch { setErr('Tidak dapat terhubung'); btn.disabled = false; btn.textContent = 'Kirim Komentar'; }
  }

  // --- Open / close ---
  function open(news) {
    current = news;
    mediaEl.innerHTML = '';
    if (news.media && news.mediaType === 'video') {
      const v = document.createElement('video');
      if (news.mediaPoster) v.poster = news.mediaPoster;
      v.src = news.media; v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true;
      v.setAttribute('playsinline', ''); v.controls = true;
      v.play().catch(() => {});
      mediaEl.appendChild(v);
    } else if (news.media) {
      const im = document.createElement('img');
      im.src = news.media; im.alt = news.title || '';
      mediaEl.appendChild(im);
    } else {
      mediaEl.innerHTML = '<div class="nd-hero-placeholder">PI</div>';
    }
    dateEl.textContent  = fmtDate(news.date);
    titleEl.textContent = news.title || '';
    descEl.textContent  = news.description || '';
    listEl.innerHTML = '';
    countEl.textContent = '';
    composeEl.innerHTML = '';
    scroll.scrollTop = 0;
    pendingPhone = '';

    root.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => root.classList.add('open'));
    isOpen = true;

    loadComments();
    renderCompose();
    clearInterval(pollTimer);
    pollTimer = setInterval(loadComments, 5000);
    OverlayNav.open('nd', close);
  }

  function close() {
    root.classList.remove('open');
    root.setAttribute('aria-hidden', 'true');
    // Only re-enable page scroll if no other overlay (e.g. the list underneath)
    // is still open.
    if (!document.querySelector('.pd.open')) document.body.style.overflow = '';
    clearInterval(pollTimer);
    mediaEl.innerHTML = ''; // stop any playing video
    isOpen = false;
  }

  const back = () => OverlayNav.requestClose();
  document.getElementById('ndClose').addEventListener('click', back);
  root.querySelectorAll('[data-nd-close]').forEach(el => el.addEventListener('click', back));

  return { open };
})();

/* === Berita Lainnya — older-news list (in-app page) ===
 * A fullscreen overlay listing the title + date of every older post (those not
 * shown in the rail). Opened from the "Berita Lainnya" button; the back/close
 * control (and the device back button, via OverlayNav) returns to the main
 * page. Clicking an entry opens the existing NewsDetail view on top.
 */
const NewsList = (function () {
  const root = document.getElementById('newsList');
  if (!root) return { open() {}, setData() {} };
  const itemsEl = document.getElementById('nlItems');
  const scroll  = document.getElementById('nlScroll');

  const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  function fmtDate(d) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || '');
    return m ? Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1] : (d || '');
  }

  let items = [], onOpenItem = null;

  function render() {
    itemsEl.innerHTML = '';
    if (!items.length) {
      itemsEl.innerHTML = '<div class="nl-empty">Belum ada berita lainnya.</div>';
      return;
    }
    items.forEach(n => {
      const item = document.createElement('button');
      item.className = 'nl-item';
      item.innerHTML =
        `<span class="nl-item-date">${esc(fmtDate(n.date))}</span>` +
        `<span class="nl-item-title">${esc(n.title)}</span>`;
      item.addEventListener('click', () => { if (onOpenItem) onOpenItem(n); });
      itemsEl.appendChild(item);
    });
  }

  function open() {
    render();
    scroll.scrollTop = 0;
    root.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => root.classList.add('open'));
    OverlayNav.open('nl', close);
  }

  function close() {
    root.classList.remove('open');
    root.setAttribute('aria-hidden', 'true');
    if (!document.querySelector('.pd.open')) document.body.style.overflow = '';
  }

  function setData(allItems, openItemFn) { items = allItems || []; onOpenItem = openItemFn; }

  const back = () => OverlayNav.requestClose();
  document.getElementById('nlClose').addEventListener('click', back);
  root.querySelectorAll('[data-nl-close]').forEach(el => el.addEventListener('click', back));

  return { open, setData };
})();

/* === Floating News Rail ===
 * A collapsible panel pinned to the right edge of the viewport. Shows compact,
 * clickable cards (→ NewsDetail). Works on phone (anchored bottom-right) and
 * desktop (vertically centered). Videos show a poster and only download/play
 * while visible, so the page doesn't fetch every clip at once.
 */
(async function initNews() {
  const rail    = document.getElementById('newsRail');
  const list    = document.getElementById('newsRailList');
  const toggle  = document.getElementById('newsRailToggle');
  const closeB  = document.getElementById('newsRailClose');
  const countB  = document.getElementById('newsRailCount');
  if (!rail || !list || !toggle) return;

  const NEWS_BATCH = 4;

  // Fetch one page at a time from the server (true server-side pagination).
  async function fetchPage(page) {
    try {
      const r = await fetch(`/api/news?page=${page}&limit=${NEWS_BATCH}`);
      if (!r.ok) return { items: [], total: 0, hasMore: false };
      return await r.json();
    } catch { return { items: [], total: 0, hasMore: false }; }
  }

  // Fetch every post (newest-first) in large pages, then drop the newest `skip`
  // already shown in the rail — used to populate the "Berita Lainnya" archive.
  async function fetchOlder(skip) {
    const out = [];
    for (let pg = 1; ; pg++) {
      try {
        const r = await fetch(`/api/news?page=${pg}&limit=50`);
        if (!r.ok) break;
        const data = await r.json();
        out.push(...(data.items || []));
        if (!data.hasMore) break;
      } catch { break; }
    }
    return out.slice(skip);
  }

  const first = await fetchPage(1);
  if (!first.items.length) return; // nothing to show — rail stays hidden

  const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  function fmtDate(d) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || '');
    if (!m) return d || '';
    return Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1];
  }
  const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

  // Only download + play a video while it's actually visible in the rail.
  const videoIO = ('IntersectionObserver' in window)
    ? new IntersectionObserver(entries => {
        entries.forEach(e => {
          const v = e.target;
          if (e.isIntersecting) { v.preload = 'auto'; v.play().catch(() => {}); }
          else v.pause();
        });
      }, { rootMargin: '120px' })
    : null;

  function makeCard(n) {
    const card = document.createElement('article');
    card.className = 'news-card';

    const media = document.createElement('div');
    media.className = 'news-card-media';
    if (n.media && n.mediaType === 'video') {
      const v = document.createElement('video');
      v.muted = true; v.loop = true; v.playsInline = true;
      v.setAttribute('playsinline', '');
      v.preload = 'none';
      if (n.mediaPoster) v.poster = n.mediaPoster;
      v.src = n.media;
      media.appendChild(v);
      if (videoIO) videoIO.observe(v);
      else { v.autoplay = true; v.play().catch(() => {}); }
    } else if (n.media) {
      const im = document.createElement('img');
      im.src = n.media; im.alt = n.title || ''; im.loading = 'lazy';
      media.appendChild(im);
    } else {
      media.innerHTML = '<div class="news-card-media-placeholder">PI</div>';
    }

    const body = document.createElement('div');
    body.className = 'news-card-body';
    body.innerHTML =
      `<div class="news-card-date">${esc(fmtDate(n.date))}</div>` +
      `<div class="news-card-title">${esc(n.title)}</div>` +
      `<div class="news-card-desc">${esc(n.description)}</div>`;

    card.appendChild(media);
    card.appendChild(body);
    card.addEventListener('click', () => NewsDetail.open(n));

    // Warm the (immutably-cached) video into the HTTP cache on hover, so the
    // detail overlay — same URL — opens instantly.
    if (n.media && n.mediaType === 'video') {
      card.addEventListener('pointerenter', () => { fetch(n.media).catch(() => {}); }, { once: true });
    }
    return card;
  }

  // The rail shows only the newest page; any older posts live behind the
  // "Berita Lainnya" button, which opens a fullscreen archive (NewsList).
  const total = first.total || first.items.length;
  first.items.forEach(n => list.appendChild(makeCard(n)));
  countB.textContent = total;

  const olderCount = Math.max(0, total - first.items.length);
  if (olderCount > 0) {
    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'news-rail-more';
    moreBtn.textContent = 'Berita Lainnya';
    list.appendChild(moreBtn);

    let olderItems = null; // fetched lazily on first open, then cached
    moreBtn.addEventListener('click', async () => {
      if (!olderItems) {
        moreBtn.disabled = true;
        moreBtn.textContent = 'Memuat…';
        olderItems = await fetchOlder(first.items.length);
        moreBtn.disabled = false;
        moreBtn.textContent = 'Berita Lainnya';
      }
      NewsList.setData(olderItems, n => NewsDetail.open(n));
      NewsList.open();
    });
  }

  let touched = false;
  const openRail  = () => { rail.classList.add('open');  toggle.setAttribute('aria-expanded', 'true'); };
  const closeRail = () => { rail.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); };
  toggle.addEventListener('click', () => {
    touched = true;
    rail.classList.contains('open') ? closeRail() : openRail();
  });
  if (closeB) closeB.addEventListener('click', () => { touched = true; closeRail(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeRail(); });

  rail.hidden = false;

  // Advertise the rail once on larger screens by sliding it open briefly after
  // load — but never override the visitor if they've already touched it.
  if (window.matchMedia('(min-width: 601px)').matches) {
    setTimeout(() => { if (!touched) openRail(); }, 1800);
  }
})();

/* === FAQ (loaded from /api/faq, managed in the back office) ===
 * Answers are plain text: blank lines split paragraphs, "- "/"* " lines become
 * a bullet list, and "1." / "1)" lines a numbered list. Everything is escaped,
 * so admin-entered text can't inject markup.
 */
(async function initFAQ() {
  const list = document.getElementById('faqList');
  if (!list) return;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  const isUL = l => /^\s*[-*•]\s+/.test(l);
  const isOL = l => /^\s*\d+[.)]\s+/.test(l);

  function renderAnswer(text) {
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    let html = '', i = 0;
    while (i < lines.length) {
      if (!lines[i].trim()) { i++; continue; }
      if (isUL(lines[i])) {
        html += '<ul>';
        while (i < lines.length && isUL(lines[i])) { html += '<li>' + esc(lines[i].replace(/^\s*[-*•]\s+/, '')) + '</li>'; i++; }
        html += '</ul>';
      } else if (isOL(lines[i])) {
        html += '<ol>';
        while (i < lines.length && isOL(lines[i])) { html += '<li>' + esc(lines[i].replace(/^\s*\d+[.)]\s+/, '')) + '</li>'; i++; }
        html += '</ol>';
      } else {
        const para = [];
        while (i < lines.length && lines[i].trim() && !isUL(lines[i]) && !isOL(lines[i])) { para.push(esc(lines[i])); i++; }
        html += '<p>' + para.join('<br>') + '</p>';
      }
    }
    return html;
  }

  let faqs = [];
  try {
    const r = await fetch('/api/faq');
    if (r.ok) faqs = await r.json();
  } catch {}

  list.innerHTML = '';
  faqs.forEach((f, idx) => {
    const item = document.createElement('div');
    item.className = 'faq-item';
    item.innerHTML =
      `<button class="faq-question">` +
        `<span class="faq-num">${String(idx + 1).padStart(2, '0')}</span>` +
        `<span class="faq-q-text">${esc(f.question)}</span>` +
        `<span class="faq-icon">+</span>` +
      `</button>` +
      `<div class="faq-body"><div class="faq-body-inner"><div class="faq-answer">${renderAnswer(f.answer)}</div></div></div>`;
    item.querySelector('.faq-question').addEventListener('click', () => {
      const isOpen = item.classList.contains('open');
      list.querySelectorAll('.faq-item.open').forEach(el => el.classList.remove('open'));
      if (!isOpen) item.classList.add('open');
    });
    list.appendChild(item);
  });
})();

/* === Scroll Reveal === */
(function initReveal() {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); }
    });
  }, { threshold: 0.08, rootMargin: '-32px 0px' });

  document.querySelectorAll('.reveal').forEach(el => io.observe(el));
})();
