/**
 * Wedding Album 3D Coverflow Engine
 * Huy & Trang Wedding Invitation
 * Features:
 * - 3D Coverflow Slider (Swiper.js / CSS 3D Transforms)
 * - GPU Accelerated (translate3d, rotateY, scale)
 * - Lazy Loading (Surrounding 3-5 images)
 * - Responsive Image Tiers (mini/thumb/full WebP)
 * - Intelligent Background Next/Prev Preloader
 * - +16 Badge on 4th Preview Photo
 */

(function () {
  'use strict';

  // Complete list of all 20 photos
  const GALLERY_IMAGES = [
    { id: 1, base: 'wedding_prev_1.webp', title: 'Quang Huy & Thu Trang' },
    { id: 2, base: 'wedding_prev_2.webp', title: 'Quang Huy & Thu Trang' },
    { id: 3, base: 'wedding_prev_3.webp', title: 'Quang Huy & Thu Trang' },
    { id: 4, base: 'wedding_prev_4.webp', title: 'Quang Huy & Thu Trang' },
    { id: 5, base: 'wedding_1.webp', title: 'Quang Huy & Thu Trang' },
    { id: 6, base: 'wedding_2.webp', title: 'Quang Huy & Thu Trang' },
    { id: 7, base: 'wedding_3.webp', title: 'Quang Huy & Thu Trang' },
    { id: 8, base: 'wedding_4.webp', title: 'Quang Huy & Thu Trang' },
    { id: 9, base: 'wedding_5.webp', title: 'Quang Huy & Thu Trang' },
    { id: 10, base: 'wedding_6.webp', title: 'Quang Huy & Thu Trang' },
    { id: 11, base: 'wedding_7.webp', title: 'Quang Huy & Thu Trang' },
    { id: 12, base: 'wedding_8.webp', title: 'Quang Huy & Thu Trang' },
    { id: 13, base: 'wedding_9.webp', title: 'Quang Huy & Thu Trang' },
    { id: 14, base: 'wedding_10.webp', title: 'Quang Huy & Thu Trang' },
    { id: 15, base: 'wedding_11.webp', title: 'Quang Huy & Thu Trang' },
    { id: 16, base: 'wedding_12.webp', title: 'Quang Huy & Thu Trang' },
    { id: 17, base: 'wedding_13.webp', title: 'Quang Huy & Thu Trang' },
    { id: 18, base: 'wedding_14.webp', title: 'Quang Huy & Thu Trang' },
    { id: 19, base: 'wedding_15.webp', title: 'Quang Huy & Thu Trang' },
    { id: 20, base: 'wedding_16.webp', title: 'Quang Huy & Thu Trang' }
  ];

  // Preload Cache Set
  const preloadedUrls = new Set();

  function getImageUrl(img, tier) {
    return `/images/gallery/${tier}/${img.base}`;
  }

  // Preload a single image into browser cache
  function preloadImage(url) {
    if (!url || preloadedUrls.has(url)) return;
    preloadedUrls.add(url);
    const img = new Image();
    img.src = url;
  }

  // Preload surrounding images (Next + 1, Next + 2, Prev - 1)
  function preloadSurrounding(currentIndex) {
    const isMobile = window.innerWidth < 768;
    const tier = isMobile ? 'thumb' : 'full';

    const indicesToPreload = [
      currentIndex,
      (currentIndex + 1) % GALLERY_IMAGES.length,
      (currentIndex + 2) % GALLERY_IMAGES.length,
      (currentIndex - 1 + GALLERY_IMAGES.length) % GALLERY_IMAGES.length
    ];

    indicesToPreload.forEach(idx => {
      const url = getImageUrl(GALLERY_IMAGES[idx], tier);
      preloadImage(url);
    });
  }

  let swiperInstance = null;
  let modalOverlay = null;

  // Build the 3D Coverflow Modal HTML
  function createModal() {
    if (document.getElementById('coverflow-gallery-modal')) return;

    const overlay = document.createElement('div');
    overlay.id = 'coverflow-gallery-modal';
    overlay.className = 'coverflow-modal-overlay';
    overlay.innerHTML = `
      <div class="coverflow-modal-header">
        <div class="coverflow-modal-title">
          <span>ALBUM ẢNH CƯỚI</span>
          <span class="coverflow-badge-counter" id="coverflow-counter">1 / 20</span>
        </div>
        <div class="coverflow-header-actions">
          <button class="coverflow-close-btn" id="coverflow-close-btn" aria-label="Đóng album">&times;</button>
        </div>
      </div>

      <div class="coverflow-modal-body">
        <button class="coverflow-nav-btn coverflow-nav-prev" id="coverflow-prev" aria-label="Ảnh trước">
          <svg viewBox="0 0 24 24"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
        </button>
        <button class="coverflow-nav-btn coverflow-nav-next" id="coverflow-next" aria-label="Ảnh kế tiếp">
          <svg viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
        </button>

        <div class="swiper coverflow-swiper-container" id="coverflow-swiper">
          <div class="swiper-wrapper" id="coverflow-wrapper">
            ${GALLERY_IMAGES.map((img, idx) => `
              <div class="swiper-slide" data-slide-index="${idx}">
                <div class="coverflow-slide-inner">
                  <img
                    class="coverflow-slide-img lazy-loading"
                    data-base="${img.base}"
                    src="/images/gallery/mini/${img.base}"
                    alt="Ảnh cưới Quang Huy & Thu Trang ${idx + 1}"
                  />
                  <div class="coverflow-slide-sheen"></div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <div class="coverflow-modal-footer">
        <div class="coverflow-thumb-strip" id="coverflow-thumbs">
          ${GALLERY_IMAGES.map((img, idx) => `
            <div class="coverflow-thumb-item ${idx === 0 ? 'active' : ''}" data-index="${idx}">
              <img src="/images/gallery/mini/${img.base}" alt="Thumbnail ${idx + 1}" loading="lazy" />
            </div>
          `).join('')}
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    modalOverlay = overlay;

    // Attach Close Handlers
    document.getElementById('coverflow-close-btn').addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.classList.contains('coverflow-modal-body')) {
        closeModal();
      }
    });

    // Keyboard navigation
    window.addEventListener('keydown', (e) => {
      if (!modalOverlay.classList.contains('active')) return;
      if (e.key === 'Escape') closeModal();
      if (e.key === 'ArrowRight' && swiperInstance) swiperInstance.slideNext();
      if (e.key === 'ArrowLeft' && swiperInstance) swiperInstance.slidePrev();
    });

    // Thumbnail navigation clicks
    const thumbItems = overlay.querySelectorAll('.coverflow-thumb-item');
    thumbItems.forEach(thumb => {
      thumb.addEventListener('click', () => {
        const targetIdx = parseInt(thumb.getAttribute('data-index'), 10);
        if (swiperInstance) {
          swiperInstance.slideTo(targetIdx);
        }
      });
    });
  }

  // Load high-resolution image for visible/active slides
  function updateSlideImages(activeIndex) {
    if (!modalOverlay) return;
    const isMobile = window.innerWidth < 768;
    const targetTier = isMobile ? 'thumb' : 'full';
    const slides = modalOverlay.querySelectorAll('.swiper-slide');

    // Load active ± 2 slides high-res
    const loadIndices = new Set([
      activeIndex,
      (activeIndex + 1) % GALLERY_IMAGES.length,
      (activeIndex + 2) % GALLERY_IMAGES.length,
      (activeIndex - 1 + GALLERY_IMAGES.length) % GALLERY_IMAGES.length,
      (activeIndex - 2 + GALLERY_IMAGES.length) % GALLERY_IMAGES.length
    ]);

    slides.forEach((slide, idx) => {
      if (loadIndices.has(idx)) {
        const img = slide.querySelector('.coverflow-slide-img');
        const base = img.getAttribute('data-base');
        const targetSrc = `/images/gallery/${targetTier}/${base}`;
        if (img.src !== targetSrc && !img.src.endsWith(targetSrc)) {
          const highRes = new Image();
          highRes.src = targetSrc;
          highRes.onload = () => {
            img.src = targetSrc;
            img.classList.remove('lazy-loading');
            img.classList.add('lazy-loaded');
          };
        } else {
          img.classList.remove('lazy-loading');
          img.classList.add('lazy-loaded');
        }
      }
    });

    // Trigger preloading of next slides in background
    preloadSurrounding(activeIndex);
  }

  // Initialize or re-initialize Swiper
  function initSwiper(startIndex) {
    if (typeof Swiper === 'undefined') {
      console.warn('[Gallery 3D] Swiper library not loaded yet');
      return;
    }

    if (swiperInstance) {
      swiperInstance.destroy(true, true);
      swiperInstance = null;
    }

    swiperInstance = new Swiper('#coverflow-swiper', {
      effect: 'coverflow',
      grabCursor: true,
      centeredSlides: true,
      slidesPerView: 'auto',
      initialSlide: startIndex,
      speed: 450,
      coverflowEffect: {
        rotate: 30,
        stretch: 0,
        depth: 240,
        modifier: 1,
        slideShadows: true,
      },
      navigation: {
        nextEl: '#coverflow-next',
        prevEl: '#coverflow-prev',
      },
      keyboard: {
        enabled: true,
      },
      on: {
        init: function () {
          updateCounter(this.activeIndex);
          updateThumbs(this.activeIndex);
          updateSlideImages(this.activeIndex);
        },
        slideChange: function () {
          updateCounter(this.activeIndex);
          updateThumbs(this.activeIndex);
          updateSlideImages(this.activeIndex);
        }
      }
    });
  }

  function updateCounter(index) {
    const counterEl = document.getElementById('coverflow-counter');
    if (counterEl) {
      counterEl.textContent = `${index + 1} / ${GALLERY_IMAGES.length}`;
    }
  }

  function updateThumbs(index) {
    const thumbs = document.querySelectorAll('.coverflow-thumb-item');
    thumbs.forEach((thumb, i) => {
      if (i === index) {
        thumb.classList.add('active');
        thumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      } else {
        thumb.classList.remove('active');
      }
    });
  }

  function openModal(startIndex = 0) {
    createModal();
    if (!modalOverlay) return;

    modalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Small delay for DOM layout before initializing 3D transforms
    setTimeout(() => {
      initSwiper(startIndex);
    }, 50);
  }

  function closeModal() {
    if (!modalOverlay) return;
    modalOverlay.classList.remove('active');
    document.body.style.overflow = '';
    if (swiperInstance) {
      swiperInstance.destroy(true, true);
      swiperInstance = null;
    }
  }

  // Enhance the 4th card with +16 Badge & Add "Xem 3D Coverflow" Button
  function enhanceAlbumSection() {
    // 1. Locate Album section
    const headings = Array.from(document.querySelectorAll('h2, h3'));
    const albumHeading = headings.find(h => (h.textContent || '').includes('ALBUM') || (h.textContent || '').includes('Album'));
    if (!albumHeading) return;

    const albumSection = albumHeading.closest('section') || albumHeading.parentElement;
    if (!albumSection) return;

    // Find the 4 preview photo cards
    const grid = albumSection.querySelector('.grid-cols-2') || albumSection.querySelector('[class*="grid"]');
    if (!grid) return;

    const cards = Array.from(grid.children);
    if (cards.length >= 4) {
      const card4 = cards[3];

      // Replace or enhance overlay on card 4
      let overlay = card4.querySelector('.gallery-card-overflow');
      if (!overlay) {
        // Remove old simple span badge if any
        const oldSpan = card4.querySelector('span');
        const oldDiv = oldSpan ? oldSpan.parentElement : null;
        if (oldDiv && oldDiv !== card4) {
          oldDiv.remove();
        }

        overlay = document.createElement('div');
        overlay.className = 'gallery-card-overflow';
        overlay.setAttribute('id', 'gallery-open-all-btn');
        overlay.innerHTML = `
          <div class="badge-count">+16</div>
          <div class="badge-label">
            <svg viewBox="0 0 24 24"><path d="M22 16V4c0-1.1-.9-2-2-2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2zm-11-4l2.03 2.71L16 11l4 5H8l3-4zM2 6v14c0 1.1.9 2 2 2h14v-2H4V6H2z"/></svg>
            <span>Xem thêm</span>
          </div>
        `;
        card4.appendChild(overlay);
      }

      // Attach click to open 3D modal starting at slide 4 (index 3)
      card4.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        openModal(3);
      };

      // Also attach click handlers to cards 1, 2, 3
      cards[0].onclick = (e) => { e.preventDefault(); e.stopPropagation(); openModal(0); };
      cards[1].onclick = (e) => { e.preventDefault(); e.stopPropagation(); openModal(1); };
      cards[2].onclick = (e) => { e.preventDefault(); e.stopPropagation(); openModal(2); };
    }

    // 2. Add "Xem toàn bộ 20 ảnh (Hiệu ứng 3D Coverflow)" button under the grid
    if (!albumSection.querySelector('.gallery-3d-btn-wrapper')) {
      const btnWrapper = document.createElement('div');
      btnWrapper.className = 'gallery-3d-btn-wrapper';
      btnWrapper.innerHTML = `
        <button class="gallery-3d-btn" id="btn-open-3d-gallery" type="button">
          <svg viewBox="0 0 24 24">
            <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12zm-6.5-3.5l2.5 3.01L19 12l4 5H9l3.5-4.5z"/>
          </svg>
          <span>Xem trọn bộ 20 ảnh cưới (3D Slider)</span>
        </button>
      `;
      grid.parentNode.insertBefore(btnWrapper, grid.nextSibling);

      document.getElementById('btn-open-3d-gallery').addEventListener('click', (e) => {
        e.preventDefault();
        openModal(0);
      });
    }
  }

  // Preload initial 4 preview images for immediate display
  preloadSurrounding(0);

  // Initialize once DOM is ready & polling for React hydration
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      enhanceAlbumSection();
      setInterval(enhanceAlbumSection, 500);
    });
  } else {
    enhanceAlbumSection();
    setInterval(enhanceAlbumSection, 500);
  }

  // Expose global controller if needed
  window.WeddingGallery3D = {
    open: openModal,
    close: closeModal,
    images: GALLERY_IMAGES
  };

})();
