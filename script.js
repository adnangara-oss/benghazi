(() => {
  'use strict';

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(pointer:fine)').matches;
  const hasGSAP = typeof window.gsap !== 'undefined';

  // If the CDN fails, .no-gsap makes every JS-animated element visible via CSS
  // and the non-GSAP features below (sliders, menu, forms, lightbox) still run.
  if (!hasGSAP) document.documentElement.classList.add('no-gsap');
  else gsap.registerPlugin(ScrollTrigger);

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const pad2 = n => String(n).padStart(2, '0');

  // Web fonts and picsum images land after the first refresh and shift page height,
  // which can strand a trigger past the point scrolling can reach. Resync on both.
  if (hasGSAP) {
    window.addEventListener('load', () => ScrollTrigger.refresh());
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => ScrollTrigger.refresh());
  }

  let openLightbox = () => {};
  let relayoutHeroTitle = () => {};

  /* =========================================================
     Language — Arabic default, layout stays LTR either way
     ========================================================= */
  const LANG_KEY = 'benghazi-lang';
  let lang = localStorage.getItem(LANG_KEY) || 'ar';

  function applyLang(next) {
    lang = next;
    localStorage.setItem(LANG_KEY, lang);
    document.documentElement.lang = lang;

    $$('[data-ar]').forEach(el => {
      const txt = el.dataset[lang];
      if (txt != null) el.textContent = txt;
    });
    $$('[data-ar-ph]').forEach(el => {
      const ph = lang === 'ar' ? el.dataset.arPh : el.dataset.enPh;
      if (ph != null) el.placeholder = ph;
    });
    $$('#langToggle .lang-opt').forEach(o =>
      o.classList.toggle('is-on', o.dataset.lang === lang));

    // The hero lines were split into per-word spans; setting textContent above
    // wiped them, so they have to be re-split and made visible again.
    relayoutHeroTitle();
    if (hasGSAP) ScrollTrigger.refresh();
  }

  document.addEventListener('DOMContentLoaded', () => {
    const btn = $('#langToggle');
    if (btn) btn.addEventListener('click', () => applyLang(lang === 'ar' ? 'en' : 'ar'));
    if (lang !== 'ar') applyLang(lang);
    else document.documentElement.lang = 'ar';
  });

  /* =========================================================
     Preloader
     ========================================================= */
  const preloader = $('#preloader');
  let preloadDone = false;

  function finishPreload() {
    if (preloadDone) return;
    preloadDone = true;
    const done = () => { preloader.style.display = 'none'; startSite(); };

    if (!hasGSAP || reduced) { done(); return; }

    gsap.timeline({ onComplete: done })
      .to('.preloader-inner', { autoAlpha: 0, y: -16, duration: .4, ease: 'power2.in' })
      .fromTo('#preloaderCurtain', { yPercent: 100 }, { yPercent: -100, duration: .95, ease: 'power3.inOut' }, '-=.08')
      .to(preloader, { yPercent: -100, duration: .95, ease: 'power3.inOut' }, '<+=.18')
      .add(startSite, '<+=.15');

    setTimeout(done, 4000); // hard backstop — never leave a full-screen overlay up
  }

  let siteStarted = false;
  function startSite() {
    if (siteStarted) return;
    siteStarted = true;
    playIntro(reduced || !hasGSAP);
    initScrollFX();
  }

  if (!hasGSAP) startSite();
  else if (reduced) finishPreload();
  else {
    setTimeout(finishPreload, 3000); // rAF is throttled in hidden tabs — don't stall behind it
    const counter = { val: 0 };
    const countEl = $('#preloaderCount');
    const barEl = $('#preloaderBar');
    gsap.to(counter, {
      val: 100, duration: 1.5, ease: 'power1.inOut',
      onUpdate: () => {
        const v = Math.round(counter.val);
        countEl.textContent = pad2(v);
        barEl.style.width = v + '%';
      },
      onComplete: finishPreload
    });
  }

  /* =========================================================
     Word splitting + hero intro
     ========================================================= */
  function splitWords(el) {
    const text = el.textContent.trim();
    el.innerHTML = text.split(' ').map(w => `<span class="word">${w}&nbsp;</span>`).join('');
    return el.querySelectorAll('.word');
  }

  // Re-split the hero lines after a language swap and leave them visible.
  relayoutHeroTitle = () => {
    $$('.hero-title .line').forEach(line => {
      const words = splitWords(line);
      if (hasGSAP) gsap.set(words, { opacity: 1, yPercent: 0 });
    });
  };

  function playIntro(instant) {
    const lines = $$('.hero-title .line');
    lines.forEach((line, i) => {
      const words = splitWords(line);
      if (instant) { if (hasGSAP) gsap.set(words, { opacity: 1, yPercent: 0 }); return; }
      gsap.set(words, { opacity: 0, yPercent: 115 });
      gsap.to(words, { opacity: 1, yPercent: 0, duration: 1.15, stagger: .06, ease: 'expo.out', delay: .1 + i * .1 });
    });

    if (instant) {
      if (hasGSAP) gsap.set('#heroFrame, .hero-index, .hero-destlist li, .hero-dots', { opacity: 1 });
      return;
    }
    gsap.to('#heroFrame', { opacity: 1, duration: 1.1, delay: .35, ease: 'power2.out' });
    gsap.fromTo('.hero-index', { opacity: 0 }, { opacity: .55, duration: .8, delay: .9 });
    gsap.fromTo('.hero-destlist li', { opacity: 0, x: 14 }, { opacity: 1, x: 0, duration: .7, stagger: .07, delay: .8, ease: 'power2.out', clearProps: 'opacity' });
    gsap.fromTo('.hero-dots', { opacity: 0 }, { opacity: 1, duration: .8, delay: 1 });
  }

  /* =========================================================
     Hero cursor-reveal window
     ========================================================= */
  const heroWindow = (function initHeroWindow() {
    const hero = $('.hero'), reveal = $('#heroReveal'), frame = $('#heroFrame');
    if (!hero || !reveal || !frame) return { scale: () => {} };

    let winScale = 1;
    let w = 0, h = 0, W = 0, H = 0;
    // cur lags target so the window trails the cursor instead of snapping to it
    let tx = 0, ty = 0, cx = 0, cy = 0;

    function measure() {
      const r = hero.getBoundingClientRect();
      W = r.width; H = r.height;
      w = Math.min(360, Math.max(190, W * .215)) * winScale;
      h = w * .62;
      frame.style.width = w + 'px';
      frame.style.height = h + 'px';
    }

    function place() {
      // Clamp so the window never runs past the hero edges and leaves a torn frame.
      const x = Math.max(w / 2, Math.min(W - w / 2, cx));
      const y = Math.max(h / 2, Math.min(H - h / 2, cy));
      reveal.style.clipPath =
        `inset(${y - h / 2}px ${W - x - w / 2}px ${H - y - h / 2}px ${x - w / 2}px)`;
      frame.style.transform = `translate(${x - w / 2}px, ${y - h / 2}px)`;
    }

    function centre() { tx = cx = W / 2; ty = cy = H * .5; }

    measure(); centre(); place();
    window.addEventListener('resize', () => { measure(); place(); });

    // Touch / reduced-motion: park it centred, no cursor tracking.
    if (!reduced && finePointer && hasGSAP) {
      hero.addEventListener('mousemove', e => {
        const r = hero.getBoundingClientRect();
        tx = e.clientX - r.left;
        ty = e.clientY - r.top;
      }, { passive: true });
      hero.addEventListener('mouseleave', () => { tx = W / 2; ty = H * .5; });

      let inView = true;
      ScrollTrigger.create({ trigger: hero, start: 'top bottom', end: 'bottom top',
        onToggle: self => { inView = self.isActive; } });

      gsap.ticker.add(() => {
        if (!inView) return;               // no work while the hero is off-screen
        cx += (tx - cx) * .12;
        cy += (ty - cy) * .12;
        place();
      });
    }

    return {
      scale(v) { winScale = v; measure(); place(); }
    };
  })();

  /* =========================================================
     Hero slider (crossfade + Ken Burns)
     ========================================================= */
  (function initHeroSlider() {
    // The reveal window holds a second copy of the same slides; both sets have to
    // flip together or the bright window would show a different photo.
    const slides = $$('#heroSlides .hero-slide');
    const clones = $$('#heroSlidesClone .hero-slide');
    const dotsWrap = $('#heroDots');
    const hero = $('.hero');
    if (slides.length < 2 || !dotsWrap) return;

    let index = 0, paused = false;

    const dots = slides.map((_, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-label', `شريحة ${i + 1}`);
      b.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
      b.addEventListener('click', () => go(i));
      dotsWrap.appendChild(b);
      return b;
    });

    function go(n) {
      const next = (n + slides.length) % slides.length;
      if (next === index) return;
      [slides, clones].forEach(set => set[index] && set[index].classList.remove('is-active'));
      index = next;
      [slides, clones].forEach(set => {
        const el = set[index];
        if (!el) return;
        el.classList.remove('is-active');
        void el.offsetWidth;            // restart the Ken Burns keyframes
        el.classList.add('is-active');
      });
      dots.forEach((d, i) => d.setAttribute('aria-selected', i === index ? 'true' : 'false'));
    }

    if (reduced) return;                // frozen on slide 1; dots still work manually

    setInterval(() => { if (!paused && !document.hidden) go(index + 1); }, 6500);
    hero.addEventListener('mouseenter', () => { paused = true; });
    hero.addEventListener('mouseleave', () => { paused = false; });
    dotsWrap.addEventListener('focusin', () => { paused = true; });
    dotsWrap.addEventListener('focusout', () => { paused = false; });
  })();

  /* =========================================================
     Destination lightbox (collage cards)
     ========================================================= */
  (function initLightbox() {
    const cards = $$('#collage .polaroid');
    const lb = $('#lightbox');
    if (!cards.length || !lb) return;

    const imgEl = $('#lightboxImg'), titleEl = $('#lightboxTitle'), countEl = $('#lightboxCount');
    const closeBtn = $('#lightboxClose'), prevBtn = $('#lightboxPrev'), nextBtn = $('#lightboxNext');
    let index = 0, isOpen = false, lastFocused = null;

    function render() {
      const card = cards[index];
      imgEl.src = card.dataset.full || card.querySelector('img').src;
      imgEl.alt = card.querySelector('p').textContent;
      titleEl.textContent = card.querySelector('p').textContent;
      countEl.textContent = `${pad2(index + 1)} / ${pad2(cards.length)}`;
    }
    const go = d => { index = (index + d + cards.length) % cards.length; render(); };

    function show(i) {
      lastFocused = document.activeElement;
      index = ((i % cards.length) + cards.length) % cards.length;
      render();
      isOpen = true;
      lb.classList.add('is-open');
      lb.setAttribute('aria-hidden', 'false');
      document.body.classList.add('lightbox-open');
      closeBtn.focus();
    }
    function hide() {
      if (!isOpen) return;
      isOpen = false;
      lb.classList.remove('is-open');
      lb.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('lightbox-open');
      if (lastFocused && lastFocused.focus) lastFocused.focus();
    }

    cards.forEach((card, i) => {
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `عرض ${card.querySelector('p').textContent} بالحجم الكامل`);
      card.addEventListener('click', () => show(i));
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(i); }
      });
    });

    closeBtn.addEventListener('click', hide);
    prevBtn.addEventListener('click', () => go(-1));
    nextBtn.addEventListener('click', () => go(1));
    lb.addEventListener('click', e => { if (e.target === lb) hide(); });
    document.addEventListener('keydown', e => {
      if (!isOpen) return;
      if (e.key === 'Escape') hide();
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    });

    openLightbox = show;
  })();

  /* =========================================================
     Voices — quote slider
     ========================================================= */
  (function initQuotes() {
    const quotes = $$('.quote');
    const countEl = $('#quotesCount');
    const prev = $('#quotePrev'), next = $('#quoteNext');
    if (quotes.length < 2) return;

    let i = 0, paused = false;
    function go(n) {
      quotes[i].classList.remove('is-active');
      i = (n + quotes.length) % quotes.length;
      quotes[i].classList.add('is-active');
      countEl.textContent = `${pad2(i + 1)} / ${pad2(quotes.length)}`;
    }
    prev.addEventListener('click', () => { go(i - 1); paused = true; });
    next.addEventListener('click', () => { go(i + 1); paused = true; });

    if (!reduced) {
      setInterval(() => { if (!paused && !document.hidden) go(i + 1); }, 7000);
    }
  })();

  /* =========================================================
     Reveal choreography — timing/distance vary by element type
     ========================================================= */
  const REVEAL = {
    fade:  { from: { opacity: 0, y: 18 },              duration: 1,   ease: 'power2.out' },
    up:    { from: { opacity: 0, y: 46 },              duration: 1.1, ease: 'expo.out' },
    left:  { from: { opacity: 0, x: -34 },             duration: 1.1, ease: 'expo.out' },
    right: { from: { opacity: 0, x: 34 },              duration: 1.1, ease: 'expo.out' },
    panel: { from: { opacity: 0, y: 56, scale: .985 }, duration: 1.2, ease: 'expo.out' },
    note:  { from: { opacity: 0, y: 40, scale: .94, rotation: -6 }, to: { rotation: -1.2 }, duration: 1.3, ease: 'expo.out' }
  };

  function initScrollFX() {
    if (!hasGSAP) return;

    // Nav background
    ScrollTrigger.create({
      start: 'top -60',
      onUpdate: self => $('#nav').classList.toggle('scrolled', self.scroll() > 60)
    });

    // Nav active-section indicator
    $$('[data-nav-link]').forEach(link => {
      const section = document.getElementById(link.dataset.navLink);
      if (!section) return;
      ScrollTrigger.create({
        trigger: section, start: 'top 45%', end: 'bottom 45%',
        onToggle: self => link.classList.toggle('is-active', self.isActive)
      });
    });

    if (!reduced) {
      // Hero background parallax — both the real slides and the reveal copy, so the
      // window keeps showing exactly the pixels it sits over.
      gsap.to('.hero-slides', {
        yPercent: 12, ease: 'none',
        scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true }
      });

      // The reveal window opens up as you scroll away from the hero.
      const winScale = { v: 1 };
      gsap.to(winScale, {
        v: 2.6, ease: 'none',
        scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: .6 },
        onUpdate: () => heroWindow.scale(winScale.v)
      });

      // Ghost headline layer drifts slower than the solid text — the doubled/offset
      // look visible around t=4s in the reference.
      $$('[data-ghost]').forEach((ghost, i) => {
        gsap.to(ghost, {
          yPercent: 55 + i * 14, ease: 'none',
          scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: .8 }
        });
      });

      // Story background parallax
      gsap.to('#storyBg', {
        yPercent: 9, ease: 'none',
        scrollTrigger: { trigger: '.story', start: 'top bottom', end: 'bottom top', scrub: true }
      });
    }

    // Collage: cards fade + rise into place as they scroll into view
    const cards = $$('#collage .polaroid');
    if (cards.length) {
      gsap.set(cards, { opacity: 0, y: 30 });
      ScrollTrigger.batch(cards, {
        start: 'top 92%', once: true,
        onEnter: b => gsap.to(b, { opacity: 1, y: 0, duration: .9, stagger: .07, ease: 'expo.out' })
      });
    }

    // Collage + section titles: word-level stagger
    $$('.collage-title span[data-split], .story-title span[data-split], .travel-head h2[data-split]').forEach(line => {
      const words = splitWords(line);
      gsap.set(words, { opacity: 0, yPercent: 100 });
      gsap.to(words, {
        opacity: 1, yPercent: 0, duration: 1.1, stagger: .05, ease: 'expo.out',
        scrollTrigger: { trigger: line.closest('section'), start: 'top 68%', once: true }
      });
    });

    // Generic reveals
    $$('[data-reveal]').forEach(el => {
      const key = el.dataset.reveal;
      if (key === 'panel') return;                       // batched below
      const p = REVEAL[key] || REVEAL.fade;
      gsap.fromTo(el, p.from, Object.assign(
        { opacity: 1, x: 0, y: 0, scale: 1, rotation: 0, duration: p.duration, ease: p.ease },
        p.to || {},
        {
          scrollTrigger: {
            trigger: el,
            // 'top 88%' is unreachable for elements in the document's final ~12vh —
            // fall back to 'top bottom' so they can't sit at opacity 0 forever.
            start: () => {
              const top = el.getBoundingClientRect().top + window.scrollY;
              return (top - innerHeight * .88) <= ScrollTrigger.maxScroll(window) ? 'top 88%' : 'top bottom';
            },
            once: true
          },
          onComplete: () => gsap.set(el, { clearProps: 'transform' })
        }
      ));
    });

    // Travel panels stagger
    const panels = $$('.travel-panel');
    if (panels.length) {
      gsap.set(panels, { opacity: 0, y: 56 });
      ScrollTrigger.batch(panels, {
        start: 'top 85%', once: true,
        onEnter: b => gsap.to(b, {
          opacity: 1, y: 0, duration: 1.2, stagger: .1, ease: 'expo.out',
          onComplete: () => gsap.set(b, { clearProps: 'transform' })
        })
      });
    }

    // Stat counters
    const fmt = n => n.toLocaleString('en-US');
    $$('.stat-num').forEach(el => {
      const end = Number(el.dataset.count) || 0;
      const suffix = el.dataset.suffix || '';
      if (reduced) { el.textContent = fmt(end) + suffix; return; }
      const o = { v: 0 };
      gsap.to(o, {
        v: end, duration: 2, ease: 'power2.out',
        scrollTrigger: { trigger: el, start: 'top 90%', once: true },
        onUpdate: () => { el.textContent = fmt(Math.round(o.v)) + suffix; },
        onComplete: () => { el.textContent = fmt(end) + suffix; }
      });
    });

    ScrollTrigger.refresh();
  }

  /* =========================================================
     Custom cursor + magnetic buttons
     ========================================================= */
  (function initCursor() {
    if (!hasGSAP || reduced || !finePointer) return;
    const dot = $('#cursorDot'), ring = $('#cursorRing');
    if (!dot || !ring) return;

    gsap.set([dot, ring], { xPercent: -50, yPercent: -50 });
    const rx = gsap.quickTo(ring, 'x', { duration: .5, ease: 'power3' });
    const ry = gsap.quickTo(ring, 'y', { duration: .5, ease: 'power3' });
    const dx = gsap.quickTo(dot, 'x', { duration: .12, ease: 'power3' });
    const dy = gsap.quickTo(dot, 'y', { duration: .12, ease: 'power3' });

    window.addEventListener('mousemove', e => {
      document.body.classList.add('cursor-active');
      rx(e.clientX); ry(e.clientY); dx(e.clientX); dy(e.clientY);
    }, { passive: true });
    document.addEventListener('mouseleave', () => document.body.classList.remove('cursor-active'));

    const HOVER = 'a, button, input, .polaroid, .travel-panel';
    document.addEventListener('mouseover', e => { if (e.target.closest(HOVER)) document.body.classList.add('cursor-hover'); });
    document.addEventListener('mouseout',  e => { if (e.target.closest(HOVER)) document.body.classList.remove('cursor-hover'); });

    $$('[data-magnetic]').forEach(el => {
      el.addEventListener('mousemove', e => {
        const r = el.getBoundingClientRect();
        gsap.to(el, {
          x: (e.clientX - r.left - r.width / 2) * .3,
          y: (e.clientY - r.top - r.height / 2) * .3,
          duration: .5, ease: 'power3.out'
        });
      });
      el.addEventListener('mouseleave', () => gsap.to(el, { x: 0, y: 0, duration: .8, ease: 'elastic.out(1,.45)' }));
    });
  })();

  /* =========================================================
     Menu + forms
     ========================================================= */
  (function initMenu() {
    const burger = $('#navBurger'), nav = $('#nav');
    if (!burger) return;
    const close = () => { nav.classList.remove('nav-open'); burger.setAttribute('aria-expanded', 'false'); };
    burger.addEventListener('click', () => {
      const open = nav.classList.toggle('nav-open');
      burger.setAttribute('aria-expanded', String(open));
    });
    $$('.nav-links a').forEach(a => a.addEventListener('click', close));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  })();

  (function initForms() {
    const form = $('#planForm'), success = $('#noteSuccess');
    if (form) form.addEventListener('submit', e => {
      e.preventDefault();
      form.hidden = true;
      success.hidden = false;
    });

    const news = $('#newsForm'), newsDone = $('#newsDone');
    if (news) news.addEventListener('submit', e => {
      e.preventDefault();
      news.hidden = true;
      newsDone.hidden = false;
    });
  })();
})();
