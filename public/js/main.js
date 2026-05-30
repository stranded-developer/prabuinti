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

/* === Homepage Data + Collage + Portfolio + Alderon ===
 * One fetch drives all dynamic homepage content.
 * Hero collage: 3 independent cells cycling through image pool.
 * Transition: clip-path inset(100%→0) — Emil's reveal pattern.
 */
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

  // --- Alderon featured image ---
  if (hp.alderonImage) {
    const img = document.getElementById('alderonFeaturedImg');
    if (img) img.src = hp.alderonImage;
  }

  // --- Portfolio cards ---
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

  // --- Hero collage ---
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const images    = hp.heroImages;
  const cellIds   = ['collageCell0', 'collageCell1', 'collageCell2'];
  const startIdx  = [0, Math.min(3, images.length - 1), Math.min(1, images.length - 1)];
  const intervals = [2000, 1600, 2400]; // faster cycling
  const delays    = [800,  1500, 2200];

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
      requestAnimationFrame(() => {
        top.classList.add('reveal');
      });
    });

    setTimeout(() => {
      bg.src = images[nextIdx];
      top.classList.remove('reveal');
      cell.current = nextIdx;
    }, 900);
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
  const grid      = document.getElementById('productsGrid');
  const countEl   = document.getElementById('productsCount');
  const catContainer = document.getElementById('categories');

  const MOBILE_LIMIT = 8;
  let products = [];

  try {
    const res = await fetch('/api/products');
    products  = await res.json();
  } catch {
    grid.innerHTML = '<p style="color:var(--text-3);font-size:14px;">Gagal memuat produk.</p>';
    return;
  }

  // Categories — keep Alderon uPVC last so it appears at end
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

    // Remove old show-more button if any
    const oldBtn = document.getElementById('showMoreBtn');
    if (oldBtn) oldBtn.remove();

    list.forEach((p, i) => {
      const card = document.createElement('div');
      card.className = 'product-card' + (p.category === 'Alderon uPVC' ? ' product-card--alderon' : '');
      card.style.transitionDelay = Math.min(i * 35, 280) + 'ms';

      // On mobile, hide cards beyond MOBILE_LIMIT — revealed via show-more
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

    // Show-more button for mobile (CSS only shows it on ≤480px)
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

/* === FAQ === */
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
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); }
    });
  }, { threshold: 0.08, rootMargin: '-32px 0px' });

  document.querySelectorAll('.reveal').forEach(el => io.observe(el));
})();
