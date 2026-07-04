/**
 * ═══════════════════════════════════════════════════════════════
 * PANINI WC 2026 — APPLICATION JAVASCRIPT COMPLÈTE
 * Logique métier, gestion d'état, rendu des vues, import/export
 * ═══════════════════════════════════════════════════════════════
 */
'use strict';

/* ─── CONFIG ─── */
const DATABASE_URL = 'database.json';
const LS_KEY = 'panini_wc2026_collection';

/* ─── ÉTAT GLOBAL ─── */
let stickers = [];
let collectionState = {};
let currentView = 'album';
let currentAlbumPageIndex = 0;
let albumPages = [];
let modalStickerID = null;
let searchQuery = '';
let searchActive = false;

let toastBatchCount = 0;
let toastBatchTimer = null;
let toastBatchMessage = '';

/* ─── INIT ─── */
document.addEventListener('DOMContentLoaded', async () => {
  showLoadingSpinner();
  try {
    await loadDatabase();
    loadCollectionFromLocalStorage();
    initNavigation();
    initAlbumPageSelect();
    initFilters();
    initExportImport();
    initModal();
    initGlobalSearch();
    initMobileSearchModal();
    initBoosterModal();
    initMatchmaker();

    renderCurrentView();
    updateGlobalProgress();
  } catch (err) {
    console.error(err);
    showToast('❌ Impossible de charger la base de données.', 4000);
    hideLoadingSpinner();
  }
});

/* ─── CHARGEMENT DONNÉES ─── */
async function loadDatabase() {
  const response = await fetch(DATABASE_URL);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  stickers = await response.json();

  const pagesSet = new Set(stickers.map(s => s['Page']));
  albumPages = Array.from(pagesSet).sort((a, b) => a - b);

  stickers.forEach(s => {
    if (!collectionState[s.ID]) {
      collectionState[s.ID] = { status: 'missing', count: 0 };
    }
  });
  hideLoadingSpinner();
}

/* ─── GESTION COLLECTION ─── */
function getStatus(id) {
  return collectionState[id]?.status || 'missing';
}
function getDupCount(id) {
  return collectionState[id]?.count || 2;
}
function setStatus(id, status, count) {
  if (!collectionState[id]) {
    collectionState[id] = { status: 'missing', count: 0 };
  }
  collectionState[id].status = status;
  if (status === 'duplicate') {
    collectionState[id].count = Math.max(2, count ?? collectionState[id].count ?? 2);
  } else {
    collectionState[id].count = 0;
  }
  saveCollectionToLocalStorage();
  updateGlobalProgress();
}

/* ─── PERSISTANCE ─── */
function saveCollectionToLocalStorage() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(collectionState)); } catch (e) { /* ignore */ }
}
function loadCollectionFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid');
    Object.keys(parsed).forEach(id => {
      if (collectionState[id] !== undefined) {
        collectionState[id] = parsed[id];
      }
    });
  } catch (e) { /* ignore */ }
}

/* ─── EXPORT / IMPORT JSON ─── */
function exportCollectionAsJSON() {
  try {
    const json = JSON.stringify(collectionState, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ma-collection-wc2026.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('✅ Collection exportée avec succès !');
  } catch (e) {
    showToast('❌ Erreur lors de l\'export.');
  }
}
function importCollectionFromJSON(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const parsed = JSON.parse(event.target.result);
      if (typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Format invalide');
      const knownIDs = new Set(stickers.map(s => s.ID));
      const validKeys = Object.keys(parsed).filter(k => knownIDs.has(k));
      if (validKeys.length === 0) throw new Error('Aucun sticker reconnu.');
      stickers.forEach(s => {
        collectionState[s.ID] = { status: 'missing', count: 0 };
      });
      validKeys.forEach(id => {
        const entry = parsed[id];
        if (entry && typeof entry.status === 'string') {
          collectionState[id] = {
            status: ['owned', 'missing', 'duplicate'].includes(entry.status) ? entry.status : 'missing',
            count: typeof entry.count === 'number' ? entry.count : 0,
          };
        }
      });
      saveCollectionToLocalStorage();
      renderCurrentView();
      updateGlobalProgress();
      showToast(`✅ Collection importée ! (${validKeys.length} vignettes chargées)`);
    } catch (e) {
      showToast(`❌ Erreur d'import : ${e.message}`);
    }
  };
  reader.onerror = () => showToast('❌ Impossible de lire le fichier.');
  reader.readAsText(file);
}

/* ─── NAVIGATION ─── */
function initNavigation() {
  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      switchView(btn.dataset.view);
    });
  });
}
function switchView(viewName) {
  currentView = viewName;
  document.querySelectorAll('[data-view]').forEach(btn => {
    const isActive = btn.dataset.view === viewName;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
  document.querySelectorAll('.view').forEach(view => {
    view.classList.toggle('hidden', view.id !== `view-${viewName}`);
  });
  if (searchActive) {
    applySearchFilter();
  } else {
    renderCurrentView();
  }
}
function renderCurrentView() {
  switch (currentView) {
    case 'album':      renderAlbumView(); break;
    case 'manquantes': renderManquantesView(); break;
    case 'doublons':   renderDoublonsView(); break;
    case 'stats':      renderStatsView(); break;
    case 'echanges':   /* déjà fait */ break;
    default: break;
  }
}

/* ─── VUE ALBUM ─── */
function initAlbumPageSelect() {
  const select = document.getElementById('albumPageSelect');
  select.innerHTML = '';
  albumPages.forEach((page, idx) => {
    const pageStickers = stickers.filter(s => s['Page'] === page);
    const section = pageStickers[0]?.Section || `Page ${page}`;
    const opt = document.createElement('option');
    opt.value = idx;
    opt.textContent = `p.${page} — ${section}`;
    select.appendChild(opt);
  });
  select.addEventListener('change', () => {
    currentAlbumPageIndex = parseInt(select.value, 10);
    renderAlbumView();
  });
  document.getElementById('btnPagePrev').addEventListener('click', () => {
    if (currentAlbumPageIndex > 0) { currentAlbumPageIndex--; renderAlbumView(); }
  });
  document.getElementById('btnPageNext').addEventListener('click', () => {
    if (currentAlbumPageIndex < albumPages.length - 1) { currentAlbumPageIndex++; renderAlbumView(); }
  });
  document.getElementById('albumPageTotal').textContent = 106;
}
function renderAlbumView() {
  const pageNum = albumPages[currentAlbumPageIndex];
  const pageStickers = stickers.filter(s => s['Page'] === pageNum);
  document.getElementById('albumPageCurrent').textContent = pageNum;
  document.getElementById('albumPageSelect').value = currentAlbumPageIndex;
  document.getElementById('btnPagePrev').disabled = currentAlbumPageIndex === 0;
  document.getElementById('btnPageNext').disabled = currentAlbumPageIndex === albumPages.length - 1;
  renderAlbumSectionHeader(pageStickers);
  const grid = document.getElementById('stickerGrid');
  const fragment = document.createDocumentFragment();
  pageStickers.forEach(sticker => fragment.appendChild(buildStickerCard(sticker)));
  grid.innerHTML = '';
  grid.appendChild(fragment);
}
const SECTION_BANNER_COLOR_COUNT = 6;
function getSectionBannerColorIndex(sectionName) {
  let hash = 0;
  const str = sectionName || '';
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash % SECTION_BANNER_COLOR_COUNT;
}
function renderAlbumSectionHeader(pageStickers) {
  const container = document.getElementById('albumSectionHeader');
  if (!pageStickers.length) { container.innerHTML = ''; return; }
  const sections = [...new Set(pageStickers.map(s => s['Section']))];
  const firstSection = sections[0];
  const flagURL = pageStickers[0]?.Drapeau || '';
  const groupe = pageStickers[0]?.Groupe || '';
  const colorClass = `section-banner--${getSectionBannerColorIndex(firstSection)}`;
  container.innerHTML = `
    <div class="section-banner ${colorClass}">
      ${flagURL ? `<img src="${escHtml(flagURL)}" alt="${escHtml(firstSection)}" />` : ''}
      <span>${escHtml(firstSection)}</span>
      ${groupe ? `<span style="font-size:12px;opacity:0.7;letter-spacing:0.1em;">Groupe ${escHtml(groupe)}</span>` : ''}
    </div>
  `;
}
function buildStickerCard(sticker) {
  const status = getStatus(sticker.ID);
  const dupCount = getDupCount(sticker.ID);
  const article = document.createElement('article');
  article.className = `sticker-card ${status}`;
  article.setAttribute('role', 'listitem');
  article.setAttribute('aria-label', `${sticker.ID} — ${sticker.Nom} (${statusLabel(status)})`);
  article.dataset.id = sticker.ID;
  article.dataset.type = sticker.Type || '';
  const dupBadge = status === 'duplicate'
    ? `<div class="dup-badge" aria-label="${dupCount} doublons">x${dupCount}</div>`
    : '';
  const typeColor = sticker.Type === 'Spécial' ? 'var(--color-purple)' : '';
  const typeStyle = typeColor ? `style="background:${typeColor};color:#fff;"` : '';
  article.innerHTML = `
    ${dupBadge}
    <div class="sticker-header" ${typeStyle}>
      <span class="sticker-id">${escHtml(sticker.ID)}</span>
      <span class="sticker-type-badge">${escHtml(sticker.Type === 'Spécial' ? 'SPEC' : 'STD')}</span>
    </div>
    <div class="sticker-flag-wrap">
      <img class="sticker-flag" src="${escHtml(sticker.Drapeau || '')}" alt="${escHtml(sticker.Section)}" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2260%22 height=%2240%22><rect width=%2260%22 height=%2240%22 fill=%22%23E3E2FF%22/></svg>'" />
    </div>
    <div class="sticker-footer">
      <div class="sticker-name">${escHtml(sticker.Nom)}</div>
      <div class="sticker-section-label">${escHtml(sticker.Section)}</div>
    </div>
  `;
  article.addEventListener('click', () => openModal(sticker.ID));
  return article;
}

/* ─── VUE MANQUANTES ─── */
function initFilters() {
  document.getElementById('manqSectionFilter').addEventListener('change', renderManquantesView);
  document.getElementById('dblSectionFilter').addEventListener('change', renderDoublonsView);
  populateFilterSelects();
}
function populateFilterSelects() {
  const sections = [...new Set(stickers.map(s => s.Section))].sort();
  const manqSec = document.getElementById('manqSectionFilter');
  const dblSec = document.getElementById('dblSectionFilter');
  sections.forEach(sec => {
    [manqSec, dblSec].forEach(sel => {
      const opt = document.createElement('option');
      opt.value = sec;
      opt.textContent = sec;
      sel.appendChild(opt);
    });
  });
}
function renderManquantesView() {
  const filterSection = document.getElementById('manqSectionFilter').value;
  let missing = stickers.filter(s => getStatus(s.ID) === 'missing');
  if (filterSection) missing = missing.filter(s => s.Section === filterSection);
  document.getElementById('manqCount').innerHTML =
    `<span>${missing.length}</span> vignette${missing.length > 1 ? 's' : ''} manquante${missing.length > 1 ? 's' : ''}`;
  renderStickerList(document.getElementById('manqList'), missing);
  document.getElementById('manqExportZone').classList.add('hidden');
}
function renderDoublonsView() {
  const filterSection = document.getElementById('dblSectionFilter').value;
  let duplicates = stickers.filter(s => getStatus(s.ID) === 'duplicate');
  if (filterSection) duplicates = duplicates.filter(s => s.Section === filterSection);
  document.getElementById('dblCount').innerHTML =
    `<span>${duplicates.length}</span> vignette${duplicates.length > 1 ? 's' : ''} en doublon`;
  renderStickerList(document.getElementById('dblList'), duplicates, true);
  document.getElementById('dblExportZone').classList.add('hidden');
}
function renderStickerList(container, stickersList, showDupCount = false) {
  const frag = document.createDocumentFragment();
  if (!stickersList.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:var(--sp-lg);text-align:center;color:var(--outline);';
    empty.innerHTML = `
      <span class="material-symbols-outlined" style="font-size:48px;opacity:0.3;display:block;margin-bottom:12px;">check_circle</span>
      <p style="font-weight:700;font-size:14px;">Aucune vignette dans cette catégorie.</p>
    `;
    frag.appendChild(empty);
    container.innerHTML = '';
    container.appendChild(frag);
    return;
  }
  const grouped = {};
  stickersList.forEach(s => {
    if (!grouped[s.Code]) grouped[s.Code] = [];
    grouped[s.Code].push(s);
  });
  Object.entries(grouped).forEach(([code, items]) => {
    const sectionName = items[0]?.Section || code;
    const flagURL     = items[0]?.Drapeau || '';
    const header = document.createElement('div');
    header.className = 'list-group-header';
    header.innerHTML = `
      ${flagURL ? `<img src="${escHtml(flagURL)}" alt="" />` : ''}
      <span>${escHtml(sectionName)}</span>
      <span style="margin-left:auto;font-size:11px;color:var(--outline);">${items.length} vignette${items.length > 1 ? 's' : ''}</span>
    `;
    frag.appendChild(header);
    items.forEach(s => {
      const item = document.createElement('div');
      item.className = 'list-item';
      item.setAttribute('role', 'listitem');
      item.dataset.id = s.ID;
      const dupBadge = showDupCount
        ? `<div class="list-item-dup-count">x${getDupCount(s.ID)}</div>`
        : '';
      item.innerHTML = `
        <img class="list-item-flag" src="${escHtml(s.Drapeau || '')}" alt="" loading="lazy" onerror="this.style.display='none'" />
        <span class="list-item-id">${escHtml(s.ID)}</span>
        <span class="list-item-name">${escHtml(s.Nom)}</span>
        <span class="list-item-section">${escHtml(s.Type)}</span>
        ${dupBadge}
      `;
      item.addEventListener('click', () => openModal(s.ID));
      frag.appendChild(item);
    });
  });
  container.innerHTML = '';
  container.appendChild(frag);
}

/* ─── EXPORT TEXTE ─── */
function generateExportText(stickersList) {
  const grouped = {};
  stickersList.forEach(s => {
    if (!grouped[s.Code]) grouped[s.Code] = [];
    grouped[s.Code].push(s['N°']);
  });
  return Object.entries(grouped)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, nums]) => `${code} ${nums.sort((a, b) => a - b).join(',')}`)
    .join('\n');
}
function initExportImport() {
  document.getElementById('btnExport').addEventListener('click', exportCollectionAsJSON);
  document.getElementById('inputImport').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) importCollectionFromJSON(file);
    e.target.value = '';
  });
  document.getElementById('btnExportManq').addEventListener('click', () => {
    const filterSection = document.getElementById('manqSectionFilter').value;
    let missing = stickers.filter(s => getStatus(s.ID) === 'missing');
    if (filterSection) missing = missing.filter(s => s.Section === filterSection);
    const text = generateExportText(missing);
    document.getElementById('manqTextarea').value = text || '(Aucune vignette manquante)';
    document.getElementById('manqExportZone').classList.remove('hidden');
    document.getElementById('manqExportZone').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  document.getElementById('btnCopyManq').addEventListener('click', () => copyTextarea('manqTextarea'));
  document.getElementById('btnCloseManqExport').addEventListener('click', () => {
    document.getElementById('manqExportZone').classList.add('hidden');
  });
  document.getElementById('btnExportDbl').addEventListener('click', () => {
    const filterSection = document.getElementById('dblSectionFilter').value;
    let duplicates = stickers.filter(s => getStatus(s.ID) === 'duplicate');
    if (filterSection) duplicates = duplicates.filter(s => s.Section === filterSection);
    const text = generateExportText(duplicates);
    document.getElementById('dblTextarea').value = text || '(Aucun doublon)';
    document.getElementById('dblExportZone').classList.remove('hidden');
    document.getElementById('dblExportZone').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  document.getElementById('btnCopyDbl').addEventListener('click', () => copyTextarea('dblTextarea'));
  document.getElementById('btnCloseDblExport').addEventListener('click', () => {
    document.getElementById('dblExportZone').classList.add('hidden');
  });
}
function copyTextarea(textareaId) {
  const textarea = document.getElementById(textareaId);
  navigator.clipboard.writeText(textarea.value)
    .then(() => showToast('📋 Liste copiée dans le presse-papier !'))
    .catch(() => {
      textarea.select();
      document.execCommand('copy');
      showToast('📋 Liste copiée !');
    });
}

/* ─── STATISTIQUES ─── */
function renderStatsView() {
  const total     = stickers.length;
  const owned     = stickers.filter(s => getStatus(s.ID) === 'owned').length;
  const duplicates = stickers.filter(s => getStatus(s.ID) === 'duplicate').length;
  const missing   = stickers.filter(s => getStatus(s.ID) === 'missing').length;
  const ownedTotal = owned + duplicates;
  const pct = Math.round((ownedTotal / total) * 100);
  document.getElementById('statsGlobal').innerHTML = `
    <div class="stat-card completion">
      <div class="stat-card-value">${pct}%</div>
      <div class="stat-card-label">Complétion globale</div>
    </div>
    <div class="stat-card owned">
      <div class="stat-card-value">${ownedTotal}</div>
      <div class="stat-card-label">Possédées</div>
    </div>
    <div class="stat-card missing">
      <div class="stat-card-value">${missing}</div>
      <div class="stat-card-label">Manquantes</div>
    </div>
    <div class="stat-card duplicate">
      <div class="stat-card-value">${duplicates}</div>
      <div class="stat-card-label">Doublons</div>
    </div>
  `;
  renderStatsBars();
}
function renderStatsBars() {
  const container = document.getElementById('statsBars');
  container.innerHTML = '';
  const grouped = {};
  stickers.forEach(s => {
    if (!grouped[s.Code]) grouped[s.Code] = { section: s.Section, flag: s.Drapeau, stickers: [] };
    grouped[s.Code].stickers.push(s);
  });
  const sortedEntries = Object.entries(grouped).sort((a, b) => {
    const getPct = (items) => {
      const total = items.length;
      const ok = items.filter(s => getStatus(s.ID) !== 'missing').length;
      return ok / total;
    };
    return getPct(b[1].stickers) - getPct(a[1].stickers);
  });
  sortedEntries.forEach(([code, data]) => {
    const total  = data.stickers.length;
    const ok     = data.stickers.filter(s => getStatus(s.ID) !== 'missing').length;
    const pct    = Math.round((ok / total) * 100);
    const fillClass = pct === 100 ? 'full' : pct < 20 ? 'low' : '';
    const row = document.createElement('div');
    row.className = 'stat-bar-row';
    row.innerHTML = `
      <div class="stat-bar-label">
        ${data.flag ? `<img src="${escHtml(data.flag)}" alt="" loading="lazy" />` : ''}
        <span title="${escHtml(data.section)}">${escHtml(data.section)}</span>
      </div>
      <div class="stat-bar-track">
        <div class="stat-bar-fill ${fillClass}" style="width:${pct}%"></div>
      </div>
      <div class="stat-bar-pct">${pct}%</div>
    `;
    container.appendChild(row);
  });
}

/* ─── MODALE ─── */
function initModal() {
  document.getElementById('btnModalClose').addEventListener('click', closeModal);
  document.getElementById('stickerModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalStickerID) closeModal();
  });
  document.querySelectorAll('.btn-status').forEach(btn => {
    btn.addEventListener('click', () => {
      const status = btn.dataset.status;
      if (!modalStickerID) return;
      setStatus(modalStickerID, status);
      updateModalStatusButtons(status);
      refreshStickerInView(modalStickerID);
      if (status === 'duplicate') {
        document.getElementById('modalDupControls').classList.remove('hidden');
        document.getElementById('dupCountDisplay').textContent = getDupCount(modalStickerID);
        updateDupMinusState();
      } else {
        document.getElementById('modalDupControls').classList.add('hidden');
      }
    });
  });
  document.getElementById('btnDupPlus').addEventListener('click', () => {
    if (!modalStickerID) return;
    const newCount = (collectionState[modalStickerID]?.count || 2) + 1;
    setStatus(modalStickerID, 'duplicate', newCount);
    document.getElementById('dupCountDisplay').textContent = newCount;
    updateDupMinusState();
    refreshStickerInView(modalStickerID);
  });
  document.getElementById('btnDupMinus').addEventListener('click', () => {
    if (!modalStickerID) return;
    const current = collectionState[modalStickerID]?.count || 2;
    if (current <= 2) return;
    const newCount = current - 1;
    setStatus(modalStickerID, 'duplicate', newCount);
    document.getElementById('dupCountDisplay').textContent = newCount;
    document.getElementById('btnDupMinus').disabled = (newCount <= 2);
    refreshStickerInView(modalStickerID);
  });
}
function updateDupMinusState() {
  const btnMinus = document.getElementById('btnDupMinus');
  if (!modalStickerID) { btnMinus.disabled = false; return; }
  const count = collectionState[modalStickerID]?.count || 2;
  btnMinus.disabled = (count <= 2);
}
function openModal(id) {
  const sticker = stickers.find(s => s.ID === id);
  if (!sticker) return;
  modalStickerID = id;
  const status = getStatus(id);
  document.getElementById('modalId').textContent = sticker.ID;
  document.getElementById('modalTitle').textContent = sticker.Nom;
  document.getElementById('modalFlag').src = sticker.Drapeau || '';
  document.getElementById('modalFlag').alt = sticker.Section;
  document.getElementById('modalMeta').innerHTML = `
    <span>${escHtml(sticker.Section)}</span>
    <span>${escHtml(sticker.Type)}</span>
    ${sticker.Groupe ? `<span>Groupe ${escHtml(sticker.Groupe)}</span>` : ''}
    <span>Page ${sticker['Page']}</span>
  `;
  const headerColors = {
    owned:     { bg: 'var(--color-green-deep)',      fg: 'var(--color-yellow)' },
    missing:   { bg: 'var(--surface-mid)',     fg: 'var(--outline)' },
    duplicate: { bg: 'var(--color-orange)',  fg: '#fff' },
  };
  const colors = headerColors[status] || headerColors.missing;
  const header = document.getElementById('modalHeader');
  header.style.background = colors.bg;
  header.style.color = colors.fg;
  updateModalStatusButtons(status);
  const dupControls = document.getElementById('modalDupControls');
  if (status === 'duplicate') {
    dupControls.classList.remove('hidden');
    document.getElementById('dupCountDisplay').textContent = getDupCount(id);
    updateDupMinusState();
  } else {
    dupControls.classList.add('hidden');
  }
  document.getElementById('stickerModal').classList.remove('hidden');
  document.getElementById('btnModalClose').focus();
}
function closeModal() {
  document.getElementById('stickerModal').classList.add('hidden');
  modalStickerID = null;
}
function updateModalStatusButtons(activeStatus) {
  document.querySelectorAll('.btn-status').forEach(btn => {
    btn.classList.toggle('active-status', btn.dataset.status === activeStatus);
  });
}
function refreshStickerInView(id) {
  const existingCards = document.querySelectorAll(`.sticker-card[data-id="${id}"]`);
  if (existingCards.length > 0) {
    const sticker = stickers.find(s => s.ID === id);
    if (!sticker) return;
    const newCard = buildStickerCard(sticker);
    existingCards.forEach(card => card.parentNode.replaceChild(newCard.cloneNode(true), card));
    document.querySelectorAll(`.sticker-card[data-id="${id}"]`).forEach(card => {
      card.addEventListener('click', () => openModal(id));
    });
  }
  if (currentView === 'manquantes') renderManquantesView();
  if (currentView === 'doublons')   renderDoublonsView();
  if (currentView === 'stats')      renderStatsView();
}

/* ─── BARRE DE PROGRESSION ─── */
function updateGlobalProgress() {
  const total = stickers.length;
  const owned = stickers.filter(s => getStatus(s.ID) !== 'missing').length;
  const pct   = total > 0 ? Math.round((owned / total) * 100) : 0;
  document.getElementById('progressOwned').textContent = owned;
  document.getElementById('progressTotal').textContent = total;
  document.getElementById('progressPct').textContent = `${pct}%`;
  document.getElementById('progressFill').style.width = `${pct}%`;
}

/* ─── UTILITAIRES ─── */
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}
function statusLabel(status) {
  const labels = { owned: 'Possédée', missing: 'Manquante', duplicate: 'Doublon' };
  return labels[status] || status;
}

let toastTimer = null;
function showToast(message, duration = 2500, batchable = false) {
  const toast = document.getElementById('toast');
  if (batchable) {
    if (toastBatchMessage === message) {
      toastBatchCount++;
      const baseMsg = message.replace(/ \(\d+\)$/, '');
      toast.textContent = toastBatchCount > 1 ? `${baseMsg} (${toastBatchCount})` : baseMsg;
    } else {
      toastBatchCount = 1;
      toastBatchMessage = message;
      toast.textContent = message;
    }
    toast.classList.add('show');
    clearTimeout(toastTimer);
    clearTimeout(toastBatchTimer);
    toastBatchTimer = setTimeout(() => {
      toastBatchCount = 0;
      toastBatchMessage = '';
    }, duration + 500);
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, duration);
    return;
  }
  toastBatchCount = 0;
  toastBatchMessage = '';
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

function showLoadingSpinner() {
  const main = document.getElementById('stickerGrid');
  if (main) {
    main.innerHTML = `
      <div class="loading-spinner" style="grid-column:1/-1">
        <div class="spinner-ring"></div>
        <p style="font-weight:700;font-size:14px;color:var(--outline);">Chargement de la base…</p>
      </div>
    `;
  }
}
function hideLoadingSpinner() {}

/* ─── RECHERCHE GLOBALE ─── */
function initGlobalSearch() {
  const input  = document.getElementById('globalSearch');
  const clearBtn = document.getElementById('searchClear');
  if (!input) return;
  input.addEventListener('input', () => {
    const wasActive = searchActive;
    searchQuery = input.value.trim().toLowerCase();
    searchActive = searchQuery.length > 0;
    clearBtn.classList.toggle('hidden', !searchActive);

    // Si recherche active et qu'on n'est pas sur Album, basculer sur Album
    if (searchActive && !wasActive && currentView !== 'album') {
      switchView('album');
      return;
    }
    applySearchFilter();
  });
  clearBtn.addEventListener('click', () => {
    input.value = '';
    searchQuery = '';
    searchActive = false;
    clearBtn.classList.add('hidden');
    applySearchFilter();
  });
}
function initMobileSearchModal() {
  const btn = document.getElementById('btnMobileSearch');
  const modal = document.getElementById('searchModal');
  const body = document.getElementById('searchModalBody');
  const searchBar = document.getElementById('headerSearch');
  const headerInner = document.querySelector('.header-inner');
  const headerActions = document.querySelector('.header-actions');
  const btnClose = document.getElementById('btnSearchModalClose');
  if (!btn || !modal || !body || !searchBar || !headerInner) return;
  function openSearchModal() {
    body.appendChild(searchBar);
    modal.classList.remove('hidden');
    const input = document.getElementById('globalSearch');
    if (input) input.focus();
  }
  function closeSearchModal() {
    modal.classList.add('hidden');
    if (headerActions) {
      headerInner.insertBefore(searchBar, headerActions);
    } else {
      headerInner.appendChild(searchBar);
    }
  }
  btn.addEventListener('click', openSearchModal);
  btnClose && btnClose.addEventListener('click', closeSearchModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeSearchModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeSearchModal();
  });
}
function applySearchFilter() {
  document.querySelectorAll('.search-results-banner').forEach(b => b.remove());
  if (!searchActive) {
    renderCurrentView();
    return;
  }
  const q = searchQuery;
  const matched = stickers.filter(s => {
    const idMatch   = s.ID.toLowerCase().includes(q);
    const nomMatch  = (s.Nom || '').toLowerCase().includes(q);
    const codeMatch = (s.Code || '').toLowerCase().includes(q);
    return idMatch || nomMatch || codeMatch;
  });
  if (currentView === 'album') {
    renderSearchResultsGrid(matched, q);
  } else if (currentView === 'manquantes') {
    const filtered = matched.filter(s => getStatus(s.ID) === 'missing');
    renderSearchResultsList(filtered, q, false);
  } else if (currentView === 'doublons') {
    const filtered = matched.filter(s => getStatus(s.ID) === 'duplicate');
    renderSearchResultsList(filtered, q, true);
  } else {
    renderSearchResultsGrid(matched, q);
  }
}
function renderSearchResultsGrid(results, q) {
  let grid = document.getElementById('stickerGrid');
  if (!grid) return;
  const banner = createSearchBanner(results.length, q);
  grid.parentNode.insertBefore(banner, grid);
  const frag = document.createDocumentFragment();
  results.forEach(s => frag.appendChild(buildStickerCard(s)));
  grid.innerHTML = '';
  grid.appendChild(frag);
}
function renderSearchResultsList(results, q, showDupCount) {
  const listId = currentView === 'manquantes' ? 'manqList' : 'dblList';
  const listEl = document.getElementById(listId);
  if (!listEl) return;
  const banner = createSearchBanner(results.length, q);
  listEl.parentNode.insertBefore(banner, listEl);
  renderStickerList(listEl, results, showDupCount);
}
function createSearchBanner(count, q) {
  const banner = document.createElement('div');
  banner.className = 'search-results-banner';
  banner.innerHTML = `
    <span class="material-symbols-outlined" style="font-size:16px;">search</span>
    <span><strong>${count}</strong> résultat${count !== 1 ? 's' : ''} pour "<em>${escHtml(q)}</em>"</span>
    <button class="search-banner-clear" id="searchBannerClear">
      <span class="material-symbols-outlined" style="font-size:14px;">close</span>
      Effacer
    </button>
  `;
  banner.querySelector('#searchBannerClear').addEventListener('click', () => {
    const input = document.getElementById('globalSearch');
    if (input) input.value = '';
    searchQuery = '';
    searchActive = false;
    document.getElementById('searchClear').classList.add('hidden');
    applySearchFilter();
  });
  return banner;
}

/* ─── BOOSTER ─── */
function initBoosterModal() {
  const fab     = document.getElementById('fabBooster');
  const modal   = document.getElementById('boosterModal');
  const btnClose   = document.getElementById('btnBoosterClose');
  const btnCancel  = document.getElementById('btnBoosterCancel');
  const btnValidate = document.getElementById('btnBoosterValidate');
  const input   = document.getElementById('boosterInput');
  const preview = document.getElementById('boosterPreview');
  if (!fab || !modal) return;
  fab.addEventListener('click', () => {
    input.value = '';
    preview.innerHTML = '';
    modal.classList.remove('hidden');
    input.focus();
  });
  [btnClose, btnCancel].forEach(btn => {
    btn && btn.addEventListener('click', closeBoosterModal);
  });
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeBoosterModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeBoosterModal();
  });
  input.addEventListener('input', () => {
    updateBoosterPreview(input.value, preview);
  });
  btnValidate.addEventListener('click', () => {
    const ids = parseBoosterInput(input.value);
    if (ids.valid.length === 0) {
      showToast('⚠️ Aucun ID reconnu dans la saisie.');
      return;
    }
    ids.valid.forEach(id => {
      const current = getStatus(id);
      if (current === 'missing') {
        setStatus(id, 'owned');
      } else if (current === 'owned') {
        setStatus(id, 'duplicate', Math.max(2, (collectionState[id]?.count || 0) + 1));
      } else if (current === 'duplicate') {
        const newCount = (collectionState[id]?.count || 2) + 1;
        setStatus(id, 'duplicate', newCount);
      }
    });
    renderCurrentView();
    closeBoosterModal();
    showToast(`✅ ${ids.valid.length} vignette${ids.valid.length > 1 ? 's' : ''} ajoutée${ids.valid.length > 1 ? 's' : ''} !`, 3000);
  });
}
function closeBoosterModal() {
  document.getElementById('boosterModal').classList.add('hidden');
}
function parseBoosterInput(raw) {
  const knownIDs = new Set(stickers.map(s => s.ID));
  const tokens = raw.trim().toUpperCase().split(/\s+/).filter(Boolean);
  const valid = [];
  const invalid = [];
  tokens.forEach(t => {
    if (knownIDs.has(t)) valid.push(t);
    else invalid.push(t);
  });
  return { valid, invalid };
}
function updateBoosterPreview(raw, preview) {
  if (!raw.trim()) { preview.innerHTML = ''; return; }
  const { valid, invalid } = parseBoosterInput(raw);
  const frag = document.createDocumentFragment();
  valid.forEach(id => {
    const tag = document.createElement('span');
    tag.className = 'booster-tag valid';
    tag.textContent = id;
    frag.appendChild(tag);
  });
  invalid.forEach(id => {
    const tag = document.createElement('span');
    tag.className = 'booster-tag invalid';
    tag.textContent = id;
    frag.appendChild(tag);
  });
  preview.innerHTML = '';
  preview.appendChild(frag);
}

/* ─── MATCHMAKER ─── */
let friendCollection = null;
let lastGiveList = [];
let lastReceiveList = [];

function initMatchmaker() {
  const btnAnalyse = document.getElementById('btnAnalyse');
  const inputFriendJSON = document.getElementById('inputFriendJSON');
  const btnExportMatch = document.getElementById('btnExportMatch');
  const btnCopyMatch   = document.getElementById('btnCopyMatch');
  const btnCopyMatchText = document.getElementById('btnCopyMatchText');
  const btnCloseMatchExport = document.getElementById('btnCloseMatchExport');
  const btnApplyExchange = document.getElementById('btnApplyExchange');

  if (!btnAnalyse) return;
  btnAnalyse.addEventListener('click', runMatchmaker);

  inputFriendJSON && inputFriendJSON.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      document.getElementById('colleagueInput').value = ev.target.result;
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  btnExportMatch && btnExportMatch.addEventListener('click', exportMatchSummary);
  btnCopyMatch && btnCopyMatch.addEventListener('click', exportMatchSummary);
  btnCopyMatchText && btnCopyMatchText.addEventListener('click', () => copyTextarea('matchTextarea'));
  btnCloseMatchExport && btnCloseMatchExport.addEventListener('click', () => {
    document.getElementById('matchExportZone').classList.add('hidden');
  });

  // Bouton "Valider l'échange"
  btnApplyExchange && btnApplyExchange.addEventListener('click', applyExchange);
}

function parseFriendCollection(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch (e) {}
  const ids = parseTextList(raw);
  if (ids.size === 0) return null;
  const result = {};
  stickers.forEach(s => {
    result[s.ID] = { status: 'missing', count: 0 };
  });
  ids.forEach(id => {
    if (new Set(stickers.map(s => s.ID)).has(id)) {
      result[id] = { status: 'owned', count: 0 };
    }
  });
  return result;
}

function parseTextList(text) {
  const ids = new Set();
  const knownIDs = new Set(stickers.map(s => s.ID));
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  lines.forEach(line => {
    const match = line.match(/^([A-Z0-9]+)\s+([\d,\s]+)$/i);
    if (!match) return;
    const code = match[1].toUpperCase();
    const nums = match[2].split(',').map(n => parseInt(n.trim(), 10)).filter(n => !isNaN(n));
    nums.forEach(n => {
      const id = `${code}${n}`;
      if (knownIDs.has(id)) ids.add(id);
    });
  });
  return ids;
}

function runMatchmaker() {
  const raw = document.getElementById('colleagueInput').value.trim();
  const resultsEl = document.getElementById('matchmakerResults');
  const emptyEl   = document.getElementById('echangeResults');
  if (!raw) {
    showToast('⚠️ La liste de ton ami est vide.');
    return;
  }
  friendCollection = parseFriendCollection(raw);
  if (!friendCollection) {
    showToast('❌ Format non reconnu. Utilise le JSON ou le format CODE 1,2,3.');
    return;
  }
  const knownIDs = new Set(stickers.map(s => s.ID));

  const mesManquantes = new Set(
    stickers.filter(s => getStatus(s.ID) === 'missing').map(s => s.ID)
  );
  const mesDoublons = new Set(
    stickers.filter(s => getStatus(s.ID) === 'duplicate').map(s => s.ID)
  );
  const amiManquantes = new Set(
    stickers.filter(s => {
      const entry = friendCollection[s.ID];
      return !entry || entry.status === 'missing';
    }).map(s => s.ID)
  );
  const amiDoublons = new Set(
    stickers.filter(s => {
      const entry = friendCollection[s.ID];
      return entry && entry.status === 'duplicate';
    }).map(s => s.ID)
  );

  const jeDonne = [...mesDoublons].filter(id => amiManquantes.has(id));
  const ilDonne = [...mesManquantes].filter(id => amiDoublons.has(id));
  lastGiveList = jeDonne;
  lastReceiveList = ilDonne;

  emptyEl.classList.add('hidden');
  resultsEl.classList.remove('hidden');

  document.getElementById('matchmakerSummary').innerHTML = `
    <div class="matchmaker-summary-stat">
      <span class="stat-val">${jeDonne.length}</span>
      <span class="stat-lbl">Je donne</span>
    </div>
    <div class="matchmaker-summary-divider"></div>
    <div class="matchmaker-summary-stat">
      <span class="stat-val">${ilDonne.length}</span>
      <span class="stat-lbl">Je reçois</span>
    </div>
    <div class="matchmaker-summary-divider"></div>
    <div class="matchmaker-summary-stat">
      <span class="stat-val">${Math.min(jeDonne.length, ilDonne.length)}</span>
      <span class="stat-lbl">Échange net possible</span>
    </div>
  `;
  document.getElementById('giveCount').textContent = jeDonne.length;
  document.getElementById('receiveCount').textContent = ilDonne.length;
  renderMatchTags(document.getElementById('giveList'), jeDonne, 'give');
  renderMatchTags(document.getElementById('receiveList'), ilDonne, 'receive');

  document.getElementById('matchExportZone').classList.add('hidden');
  document.getElementById('exchangeDownloadZone').classList.add('hidden');
}

function renderMatchTags(container, ids, direction) {
  const frag = document.createDocumentFragment();
  if (ids.length === 0) {
    const empty = document.createElement('p');
    empty.style.cssText = 'color:var(--outline);font-size:13px;font-style:italic;padding:4px;';
    empty.textContent = 'Aucune vignette correspondante.';
    frag.appendChild(empty);
  } else {
    ids.forEach(id => {
      const s = stickers.find(x => x.ID === id);
      const tag = document.createElement('div');
      tag.className = 'match-tag';
      tag.title = `${id} — ${s?.Nom || ''}`;
      tag.innerHTML = `
        ${escHtml(id)}
        <span class="tag-name">${escHtml(s?.Nom || '')}</span>
      `;
      tag.addEventListener('click', () => openModal(id));
      frag.appendChild(tag);
    });
  }
  container.innerHTML = '';
  container.appendChild(frag);
}

function exportMatchSummary() {
  const giveIds = lastGiveList;
  const receiveIds = lastReceiveList;
  const giveText    = giveIds.length ? giveIds.join(', ') : 'Aucun doublon à donner';
  const receiveText = receiveIds.length ? receiveIds.join(', ') : 'Aucune vignette à recevoir';
  const text = [
    '=== RÉCAPITULATIF ÉCHANGE PANINI WC2026 ===',
    '',
    `Ce que je peux te donner (${giveIds.length}) :`,
    giveText,
    '',
    `Ce que tu peux me donner (${receiveIds.length}) :`,
    receiveText,
    '',
    `Généré le ${new Date().toLocaleDateString('fr-FR')} via Panini WC2026 Tracker`,
  ].join('\n');
  document.getElementById('matchTextarea').value = text;
  const zone = document.getElementById('matchExportZone');
  zone.classList.remove('hidden');
  zone.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ─── APPLIQUER L'ÉCHANGE ─── */
function applyExchange() {
  if (lastGiveList.length === 0 && lastReceiveList.length === 0) {
    showToast('⚠️ Aucun échange à valider.');
    return;
  }
  // 1. Mettre à jour notre collection
  // Pour chaque carte que je donne (mes doublons) : on diminue le compteur
  lastGiveList.forEach(id => {
    const current = getStatus(id);
    if (current === 'duplicate') {
      const count = getDupCount(id);
      if (count > 2) {
        // on enlève un doublon
        setStatus(id, 'duplicate', count - 1);
      } else {
        // il ne reste qu'un exemplaire -> on passe en 'owned'
        setStatus(id, 'owned');
      }
    } else {
      // normalement on ne donne que des doublons, mais sécurité
      setStatus(id, 'missing');
    }
  });
  // Pour chaque carte reçue (mes manquantes) : on la passe en 'owned'
  lastReceiveList.forEach(id => {
    const current = getStatus(id);
    if (current === 'missing') {
      setStatus(id, 'owned');
    } else if (current === 'owned') {
      // si déjà possédée, on passe en doublon (rare)
      setStatus(id, 'duplicate', 2);
    } else {
      setStatus(id, 'owned');
    }
  });

  // 2. Sauvegarder localement
  saveCollectionToLocalStorage();
  updateGlobalProgress();

  // 3. Générer le fichier pour l'autre échangeur
  // On part de friendCollection (état de l'ami avant échange)
  // On applique les changements inverses :
  //   - il reçoit les cartes que je lui donne (lastGiveList) -> il les passe en 'owned'
  //   - il donne les cartes que je reçois (lastReceiveList) -> on les retire de sa collection
  if (friendCollection) {
    const updatedFriend = JSON.parse(JSON.stringify(friendCollection));
    lastGiveList.forEach(id => {
      if (updatedFriend[id]) {
        // s'il les avait, on les passe en 'owned' (ou on augmente le compte si doublon)
        const status = updatedFriend[id].status;
        if (status === 'missing') {
          updatedFriend[id].status = 'owned';
          updatedFriend[id].count = 0;
        } else if (status === 'owned') {
          updatedFriend[id].status = 'duplicate';
          updatedFriend[id].count = 2;
        } else if (status === 'duplicate') {
          updatedFriend[id].count = (updatedFriend[id].count || 2) + 1;
        } else {
          updatedFriend[id] = { status: 'owned', count: 0 };
        }
      } else {
        updatedFriend[id] = { status: 'owned', count: 0 };
      }
    });
    lastReceiveList.forEach(id => {
      if (updatedFriend[id]) {
        const status = updatedFriend[id].status;
        if (status === 'duplicate') {
          const count = updatedFriend[id].count || 2;
          if (count > 2) {
            updatedFriend[id].count = count - 1;
          } else {
            updatedFriend[id].status = 'owned';
            updatedFriend[id].count = 0;
          }
        } else if (status === 'owned') {
          updatedFriend[id].status = 'missing';
          updatedFriend[id].count = 0;
        } else {
          // déjà missing, on ne fait rien
        }
      }
    });

    // Proposer le téléchargement
    const json = JSON.stringify(updatedFriend, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const downloadZone = document.getElementById('exchangeDownloadZone');
    downloadZone.classList.remove('hidden');
    const downloadBtn = document.getElementById('btnDownloadExchangeFile');
    downloadBtn.onclick = () => {
      const a = document.createElement('a');
      a.href = url;
      a.download = 'collection-apres-echange.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('✅ Fichier pour votre ami téléchargé !');
    };
    const closeDownload = document.getElementById('btnCloseExchangeDownload');
    closeDownload && closeDownload.addEventListener('click', () => {
      downloadZone.classList.add('hidden');
      URL.revokeObjectURL(url);
    });
  }

  showToast(`✅ Échange validé ! ${lastGiveList.length} carte(s) données, ${lastReceiveList.length} reçues.`);
  // Re-rendu des vues affectées
  renderCurrentView();
}