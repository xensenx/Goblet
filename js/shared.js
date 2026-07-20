/**
 * Gob Goblet — Shared Layout (Header + Footer)
 * ─────────────────────────────────────────────────────────────────────────────
 * Injected into every page via:
 *   <div id="site-header-placeholder"></div>
 *   <div id="site-footer-placeholder"></div>
 *   <script type="module" src="js/shared.js"></script>
 */

import { icons } from './icons.js';

// ─── Active page detection ────────────────────────────────────────────────────
const currentPage = window.location.pathname.split('/').pop() || 'index.html';

function isActive(href) {
  const page = href.split('/').pop();
  return currentPage === page ? 'aria-current="page"' : '';
}

// ─── Navigation HTML ──────────────────────────────────────────────────────────
const headerHTML = `
<header class="site-nav" role="banner">
  <div class="nav-inner">

    <a href="index.html" class="nav-brand" aria-label="Gob Goblet Home">
      <img
        src="https://cdn.jsdelivr.net/gh/Gob-Goblet/Gob-Goblet-assets/Logo/Goblet_logo.webp"
        alt="Gob Goblet"
        class="nav-logo-img"
        width="32"
        height="32"
      />
      <span class="nav-brand-name">Gob Goblet</span>
    </a>

    <nav class="nav-links" aria-label="Site navigation">
      <a href="index.html" class="nav-link" ${isActive('index.html')}>Home</a>
      <a href="pact.html" class="nav-link" ${isActive('pact.html')}>The Pact</a>
      <a href="about.html" class="nav-link" ${isActive('about.html')}>About</a>
      <a href="security.html" class="nav-link" ${isActive('security.html')}>Security</a>
    </nav>

    <div class="nav-actions">
      <a
        href="https://ko-fi.com/xensenx"
        target="_blank"
        rel="noopener noreferrer"
        class="nav-btn nav-btn-kofi"
        aria-label="Support on Ko-fi"
        title="Support Gob Goblet on Ko-fi"
      >
        <span class="nav-btn-icon">${icons.coffee}</span>
        <span class="nav-btn-label">Support</span>
      </a>
      <a
        href="https://github.com/Gob-Goblet"
        target="_blank"
        rel="noopener noreferrer"
        class="nav-btn nav-btn-ghost"
        aria-label="View source on GitHub"
        title="GitHub"
      >
        <span class="nav-btn-icon">${icons.github}</span>
        <span class="nav-btn-label sr-only">GitHub</span>
      </a>
    </div>

    <button class="nav-menu-toggle" id="nav-menu-toggle" aria-expanded="false" aria-controls="mobile-nav" aria-label="Open navigation menu">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" width="22" height="22">
        <line x1="3" y1="6" x2="21" y2="6"/>
        <line x1="3" y1="12" x2="21" y2="12"/>
        <line x1="3" y1="18" x2="21" y2="18"/>
      </svg>
    </button>
  </div>

  <!-- Mobile nav -->
  <nav id="mobile-nav" class="mobile-nav" aria-label="Mobile navigation" hidden>
    <a href="index.html" class="mobile-nav-link" ${isActive('index.html')}>Home</a>
    <a href="pact.html" class="mobile-nav-link" ${isActive('pact.html')}>The Pact</a>
    <a href="about.html" class="mobile-nav-link" ${isActive('about.html')}>About</a>
    <a href="security.html" class="mobile-nav-link" ${isActive('security.html')}>Security</a>
    <a href="support.html" class="mobile-nav-link" ${isActive('support.html')}>Support</a>
    <div class="mobile-nav-actions">
      <a href="https://ko-fi.com/gobgoblet" target="_blank" rel="noopener noreferrer" class="mobile-nav-action-link">
        ${icons.coffee} Support on Ko-fi
      </a>
      <a href="https://github.com/Gob-Goblet" target="_blank" rel="noopener noreferrer" class="mobile-nav-action-link">
        ${icons.github} GitHub
      </a>
    </div>
  </nav>
</header>
`;

// ─── Footer HTML ──────────────────────────────────────────────────────────────
const footerHTML = `
<footer class="site-footer" role="contentinfo">
  <div class="footer-inner">
    <div class="footer-brand">
      <img
        src="https://cdn.jsdelivr.net/gh/Gob-Goblet/Gob-Goblet-assets/Logo/Goblet_logo.webp"
        alt="Gob Goblet"
        class="footer-logo"
        width="24"
        height="24"
        loading="lazy"
      />
      <span class="footer-brand-name">Gob Goblet</span>
    </div>

    <p class="footer-tagline">
      Your files are protected entirely in your browser.
      No file content ever leaves your device unencrypted.
    </p>

    <nav class="footer-links" aria-label="Footer navigation">
      <a href="privacy-policy.html" class="footer-link">Privacy Policy</a>
      <a href="security.html" class="footer-link">Security</a>
      <a href="support.html" class="footer-link">Support</a>
      <a href="pact.html" class="footer-link">The Pact</a>
      <a href="https://github.com/Gob-Goblet" target="_blank" rel="noopener noreferrer" class="footer-link footer-link-external">
        Source Code
        <span class="footer-ext-icon">${icons.externalLink}</span>
      </a>
    </nav>

    <p class="footer-copy">
      &copy; 2026 Gob Goblet &mdash; Open Source &mdash; AES-256-GCM
    </p>
  </div>
</footer>
`;

// ─── Inject ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const headerEl = document.getElementById('site-header-placeholder');
  const footerEl = document.getElementById('site-footer-placeholder');

  if (headerEl) headerEl.outerHTML = headerHTML;
  if (footerEl) footerEl.outerHTML = footerHTML;

  // Mobile menu toggle
  const toggleBtn = document.getElementById('nav-menu-toggle');
  const mobileNav = document.getElementById('mobile-nav');
  if (toggleBtn && mobileNav) {
    toggleBtn.addEventListener('click', () => {
      const isOpen = !mobileNav.hidden;
      mobileNav.hidden = isOpen;
      toggleBtn.setAttribute('aria-expanded', String(!isOpen));
    });

    // Close when clicking outside the nav
    document.addEventListener('click', (e) => {
      if (!mobileNav.hidden && !mobileNav.contains(e.target) && !toggleBtn.contains(e.target)) {
        mobileNav.hidden = true;
        toggleBtn.setAttribute('aria-expanded', 'false');
      }
    });

    // Close when a nav link inside is clicked
    mobileNav.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        mobileNav.hidden = true;
        toggleBtn.setAttribute('aria-expanded', 'false');
      });
    });
  }
});
