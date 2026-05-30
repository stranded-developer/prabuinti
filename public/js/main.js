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
      menu.setAttribute('aria-expanded', false);
    });
  });
})();

/* === Hero Title — word-by-word clip reveal === */
(function initHeroTitle() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const title = document.querySelector('.hero-title');
  if (!title) return;

  // Walk text nodes and wrap each word
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
        // Preserve em tags but wrap their words too
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
        const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
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

  // Groups: pillars, about-cards, testimonials, projects
  const staggerGroups = [
    { parent: '.pillars-grid', child: '.pillar', base: 0, step: 80 },
    { parent: '.about-cards', child: '.about-card', base: 0, step: 70 },
    { parent: '.testimonials-grid', child: '.testimonial', base: 0, step: 60 },
    { parent: '.projects-grid', child: '.project-card', base: 0, step: 70 },
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

/* === Homepage Data + Collage + Portfolio + Alderon === */
(async function initHomepage() {
  const DEFAULT_IMAGES = [
    '/images/hero/kokoh_cover-01.png',
    '/images/hero/alderon_cover-1.png',
    '/images/hero/alderon_innovation-2.png',
    '/images/hero/alderon_warehouse-4.png',
    '/images/hero/fiberled_factory-1.png',
    '/images/hero/kokoh_colors-09.png',
  ];

  let hp = { heroImages: DEFAULT_IMAGES, alderonImage: '', portfolio: [] };
  try {
    const r = await fetch('/api/homepage');
    if (r.ok) {
      const data = await r.json();
      if (Array.isArray(data.heroImages) && data.heroImages.length >= 3) hp.heroImages = data.heroImages;
      if (data.alderonImage) hp.alderonImage = data.alderonImage;
      if (Array.isArray(data.portfolio)) hp.portfolio = data.portfolio;
    }
  } catch {}

  // Alderon featured image
  if (hp.alderonImage) {
    const img = document.getElementById('alderonFeaturedImg');
    if (img) img.src = hp.alderonImage;
  }

  // Portfolio cards
  hp.portfolio.forEach((item, i) => {
    const card  = document.getElementById('portfolioCard' + i);
    const label = document.getElementById('portfolioLabel' + i);
    if (!card) return;
    if (label && item.title) label.textContent = item.title;
    if (item.image) {
      const ph = card.querySelector('.portfolio-placeholder');
      if (ph) ph.style.display = 'none';
      const img = document.createElement('img');
      img.src = item.image;
      img.alt = item.title || '';
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;position:absolute;inset:0;';
      card.insertBefore(img, card.firstChild);
    } else if (item.title) {
      const span = card.querySelector('.portfolio-placeholder span');
      if (span) span.textContent = item.title;
    }
  });

  // Hero collage
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const images   = hp.heroImages;
  const cellIds  = ['collageCell0', 'collageCell1', 'collageCell2'];
  const startIdx = [0, Math.min(3, images.length - 1), Math.min(1, images.length - 1)];
  const intervals = [2200, 1800, 2600];
  const delays    = [900,  1600, 2400];

  const cells = cellIds.map((id, i) => ({
    el:      document.getElementById(id),
    current: startIdx[i],
  }));

  if (!cells[0].el) return;

  cells.forEach(cell => {
    const bg = cell.el.querySelector('.collage-img-bg');
    if (bg) bg.src = images[cell.current];
  });

  function transitionCell(cell) {
    const bg  = cell.el.querySelector('.collage-img-bg');
    const top = cell.el.querySelector('.collage-img-top');
    if (!bg || !top) return;

    let nextIdx;
    do { nextIdx = Math.floor(Math.random() * images.length); }
    while (nextIdx === cell.current);

    top.src = images[nextIdx];
    top.classList.remove('reveal');

    requestAnimationFrame(() => {
      requestAnimationFrame(() => top.classList.add('reveal'));
    });

    setTimeout(() => {
      bg.src = images[nextIdx];
      top.classList.remove('reveal');
      cell.current = nextIdx;
    }, 950);
  }

  cells.forEach((cell, i) => {
    setTimeout(() => {
      transitionCell(cell);
      setInterval(() => transitionCell(cell), intervals[i]);
    }, delays[i]);
  });
})();

/* === Products === */
(async function initProducts() {
  const grid         = document.getElementById('productsGrid');
  const countEl      = document.getElementById('productsCount');
  const catContainer = document.getElementById('categories');

  const MOBILE_LIMIT = 8;
  let products = [];

  try {
    const res = await fetch('/api/products');
    products  = await res.json();
  } catch {
    grid.innerHTML = '<p style="color:var(--text-3);font-size:14px;padding:24px 0;">Gagal memuat produk.</p>';
    return;
  }

  const catOrder = ['Semua','Roofing & Cladding','Floor Deck','Roof Truss','Fiber Glass','Genteng','Insulasi','Wiremesh','Alderon uPVC'];
  const catSet   = new Set(products.map(p => p.category));
  const categories = ['Semua', ...catOrder.slice(1).filter(c => catSet.has(c)), ...[...catSet].filter(c => !catOrder.includes(c))];

  categories.forEach((cat, i) => {
    const btn = document.createElement('button');
    btn.className = 'cat-btn' + (i === 0 ? ' active' : '');
    btn.textContent = cat;
    btn.addEventListener('click', () => {
      catContainer.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderProducts(cat === 'Semua' ? products : products.filter(p => p.category === cat));
    });
    catContainer.appendChild(btn);
  });

  renderProducts(products);

  function renderProducts(list) {
    countEl.textContent = list.length + ' produk';
    grid.innerHTML = '';

    const oldBtn = document.getElementById('showMoreBtn');
    if (oldBtn) oldBtn.remove();

    list.forEach((p, i) => {
      const card = document.createElement('div');
      card.className = 'product-card';
      // stagger delay capped at 320ms
      card.style.transitionDelay = Math.min(i * 32, 320) + 'ms';

      if (i >= MOBILE_LIMIT) card.classList.add('hidden-mobile');

      const imgHtml = p.image
        ? `<img src="${p.image}" alt="${p.name}" loading="lazy">`
        : `<div class="product-img-placeholder">IA</div>`;

      card.innerHTML = `
        <div class="product-img">${imgHtml}</div>
        <div class="product-info">
          <div class="product-cat">${p.category}</div>
          <div class="product-name">${p.name}</div>
          <div class="product-desc">${p.description}</div>
        </div>
      `;
      grid.appendChild(card);
      requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add('visible')));
    });

    if (list.length > MOBILE_LIMIT) {
      const remaining = list.length - MOBILE_LIMIT;
      const btn = document.createElement('button');
      btn.id = 'showMoreBtn';
      btn.className = 'products-show-more';
      btn.textContent = `Lihat ${remaining} Produk Lainnya`;
      btn.addEventListener('click', () => {
        grid.querySelectorAll('.product-card.hidden-mobile').forEach(c => {
          c.classList.add('revealed');
          requestAnimationFrame(() => requestAnimationFrame(() => c.classList.add('visible')));
        });
        btn.remove();
      });
      grid.after(btn);
    }
  }
})();

/* === FAQ — accordion with one-open-at-a-time === */
(function initFAQ() {
  document.querySelectorAll('.faq-item').forEach(item => {
    item.querySelector('.faq-question').addEventListener('click', () => {
      const isOpen = item.classList.contains('open');
      document.querySelectorAll('.faq-item.open').forEach(el => el.classList.remove('open'));
      if (!isOpen) item.classList.add('open');
    });
  });
})();

/* === Scroll Reveal === */
(function initReveal() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.querySelectorAll('.reveal').forEach(el => el.classList.add('visible'));
    return;
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); }
    });
  }, { threshold: 0.07, rootMargin: '-28px 0px' });

  document.querySelectorAll('.reveal').forEach(el => io.observe(el));
})();
