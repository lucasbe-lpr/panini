/* =======================================================
   app.js — Panini WC26 Collection Tracker
   Single-user app. No framework, vanilla JS.
   ======================================================= */

// -------------------------------------------------------
// 1. DATA STRUCTURES
// -------------------------------------------------------

/** @type {Array<Object>} Raw sticker metadata from database.json */
let stickers = [];

/**
 * Collection state: maps sticker ID → { status, count }
 * status: 'owned' | 'missing' | 'duplicate'
 * count: number of duplicates (1+ when duplicate)
 */
let collectionState = {};

// -------------------------------------------------------
// 2. BOOTSTRAP / INIT
// -------------------------------------------------------

/**
 * Entry point. Load data, restore state from localStorage, then render.
 */
async function init() {
  insertLoadingScreen();

  try {
    const response = await fetch('./database.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    stickers = await response.json();
  } catch (err) {
    hideLoading();
    document.querySelector('.app-main').innerHTML = `
      <div class="error-screen">
        <h2>⚠ Impossible de charger database.json</h2>
        <p>Assure-toi que le fichier <code>database.json</code> est dans le même dossier qu'<code>index.html</code>, puis relance l'app.</p>
        <p style="margin-top:8px;color:#DC0203;">${err.message}</p>
      </div>`;
    return;
  }

  // Restore saved state from localStorage
  restoreFromLocalStorage();

  // Populate all filter selects
  populateFilters();

  // Initial render of all views
  renderAlbum();
  renderCountryGrid();
  renderMissingList();
  renderDuplicateList();
  renderStats();

  updateHeaderStats();
  hideLoading();
}

/** Insert the loading screen DOM node */
function insertLoadingScreen() {
  const el = document.createElement('div');
  el.id = 'loading-screen';
  el.innerHTML = `
    <div class="loading-logo">WC<span>26</span></div>
    <div class="loading-bar-wrap"><div class="loading-bar-fill"></div></div>
    <div class="loading-text">Chargement de l'album…</div>`;
  document.body.appendChild(el);
}

function hideLoading() {
  const el = document.getElementById('loading-screen');
  if (!el) return;
  el.classList.add('hidden');
  setTimeout(() => el.remove(), 400);
}

// -------------------------------------------------------
// 3. PERSIST — localStorage as automatic cache
// -------------------------------------------------------

const LS_KEY = 'panini-wc26-collection';

function saveToLocalStorage() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(collectionState));
  } catch (e) {
    console.warn('localStorage save failed:', e);
  }
}

function restoreFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) collectionState = JSON.parse(raw);
  } catch (e) {
    console.warn('localStorage restore failed:', e);
    collectionState = {};
  }
}

// -------------------------------------------------------
// 4. EXPORT / IMPORT JSON (main persistence mechanism)
// -------------------------------------------------------

/**
 * Export collectionState as a downloadable JSON file.
 */
function exportCollectionAsJSON() {
  try {
    const json = JSON.stringify(collectionState, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'ma-collection-panini.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Collection exportée ✓', 'ok');
  } catch (err) {
    showToast('Erreur export : ' + err.message, 'err');
  }
}

/**
 * Import collectionState from a user-selected JSON file.
 * @param {HTMLInputElement} input
 */
function importCollectionFromJSON(input) {
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const imported = JSON.parse(e.target.result);

      // Basic validation: must be an object
      if (typeof imported !== 'object' || Array.isArray(imported)) {
        throw new Error('Format invalide : JSON doit être un objet.');
      }

      collectionState = imported;
      saveToLocalStorage();

      // Re-render all views
      renderAlbum();
      renderCountryGrid();
      if (activeCountryCode) renderCountryDetail(activeCountryCode);
      renderMissingList();
      renderDuplicateList();
      renderStats();
      updateHeaderStats();

      showToast('Collection importée ✓', 'ok');
    } catch (err) {
      showToast('Fichier invalide : ' + err.message, 'err');
    }
    // Reset input so the same file can be re-imported if needed
    input.value = '';
  };
  reader.onerror = () => showToast('Impossible de lire le fichier.', 'err');
  reader.readAsText(file);
}

// -------------------------------------------------------
// 5. STATUS MANAGEMENT
// -------------------------------------------------------

/**
 * Get the current status object for a sticker, defaulting to 'missing'.
 * @param {string} id
 * @returns {{ status: string, count: number }}
 */
function getState(id) {
  return collectionState[id] || { status: 'missing', count: 0 };
}

/**
 * Set a sticker's status.
 * When setting to 'duplicate', increments count.
 * When setting to 'owned' or 'missing', resets count.
 * @param {string} id
 * @param {'owned'|'missing'|'duplicate'} status
 */
function setStatus(id, status) {
  if (!id) return;
  const current = getState(id);

  if (status === 'duplicate') {
    const count = (current.status === 'duplicate') ? current.count + 1 : 1;
    collectionState[id] = { status: 'duplicate', count };
  } else {
    collectionState[id] = { status, count: 0 };
  }

  saveToLocalStorage();
  refreshAfterStatusChange(id);

  // Update modal if open
  if (currentModal === id) updateModalStatus(id);
}

/**
 * Decrement duplicate count. If it reaches 0, mark as 'owned'.
 * @param {string} id
 */
function decrementDuplicate(id) {
  if (!id) return;
  const current = getState(id);
  if (current.status !== 'duplicate') return;

  if (current.count <= 1) {
    collectionState[id] = { status: 'owned', count: 0 };
  } else {
    collectionState[id] = { status: 'duplicate', count: current.count - 1 };
  }

  saveToLocalStorage();
  refreshAfterStatusChange(id);
  if (currentModal === id) updateModalStatus(id);
}

/**
 * Refresh only the parts of the UI that changed after a status update.
 * @param {string} id
 */
function refreshAfterStatusChange(id) {
  // Update sticker card in album if visible
  const card = document.querySelector(`.sticker-card[data-id="${id}"]`);
  if (card) decorateStickerCard(card, id);

  // Update list items in country detail if visible
  const countryChip = document.querySelector(`.list-item-chip[data-id="${id}"]`);
  if (countryChip) {
    const s = getState(id);
    countryChip.className = `list-item-chip ${s.status === 'owned' ? 'chip-missing' : s.status === 'duplicate' ? 'chip-duplicate' : 'chip-missing'}`;
  }

  updateHeaderStats();
}

// -------------------------------------------------------
// 6. HELPERS
// -------------------------------------------------------

/** Extract unique sorted values for a given key from stickers */
function uniqueValues(key) {
  return [...new Set(stickers.map(s => s[key]).filter(Boolean))].sort();
}

/** Group stickers by a key → { value: [stickers] } */
function groupBy(arr, key) {
  return arr.reduce((acc, s) => {
    const k = s[key] || '—';
    if (!acc[k]) acc[k] = [];
    acc[k].push(s);
    return acc;
  }, {});
}

/** Get sorted, deduped album pages */
function getAlbumPages() {
  const pages = [...new Set(stickers.map(s => s['Page (album)']))];
  // Sort: numeric first, then strings
  pages.sort((a, b) => {
    const na = Number(a), nb = Number(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    if (!isNaN(na)) return -1;
    if (!isNaN(nb)) return 1;
    return String(a).localeCompare(String(b));
  });
  return pages;
}

/** Get a representative flag URL for a code */
function getFlagForCode(code) {
  const s = stickers.find(s => s['Code'] === code && s['Drapeau']);
  return s ? s['Drapeau'] : '';
}

/** Format sticker number from ID (strip code prefix) */
function getStickerNumber(sticker) {
  const id = sticker['ID'];
  const code = sticker['Code'];
  const num = id.replace(code, '');
  return num || id;
}

/** Update the header mini-stats + progress bar */
function updateHeaderStats() {
  let owned = 0, missing = 0, dup = 0;
  stickers.forEach(s => {
    const st = getState(s['ID']).status;
    if (st === 'owned')     owned++;
    else if (st === 'missing') missing++;
    else if (st === 'duplicate') { owned++; dup++; } // duplicates count as owned
  });

  const pct = stickers.length ? Math.round((owned / stickers.length) * 100) : 0;

  document.getElementById('h-owned').textContent   = owned;
  document.getElementById('h-missing').textContent = missing;
  document.getElementById('h-dup').textContent      = dup;
  document.getElementById('h-pct').textContent      = pct + '%';
  document.getElementById('progress-fill').style.width = pct + '%';
}

/** Populate all filter <select> elements */
function populateFilters() {
  const codes    = uniqueValues('Code');
  const sections = uniqueValues('Section');
  const types    = uniqueValues('Type');
  const groups   = uniqueValues('Groupe').filter(g => g && g !== '');

  const makeOptions = (values) => values.map(v => `<option value="${v}">${v}</option>`).join('');

  ['missing', 'dup'].forEach(prefix => {
    document.getElementById(`${prefix}-filter-code`).innerHTML    = `<option value="">Tous les pays</option>${makeOptions(codes)}`;
    document.getElementById(`${prefix}-filter-section`).innerHTML = `<option value="">Toutes les sections</option>${makeOptions(sections)}`;
    document.getElementById(`${prefix}-filter-type`).innerHTML    = `<option value="">Tous les types</option>${makeOptions(types)}`;
    document.getElementById(`${prefix}-filter-group`).innerHTML   = `<option value="">Tous les groupes</option>${makeOptions(groups)}`;
  });
}

// -------------------------------------------------------
// 7. TAB NAVIGATION
// -------------------------------------------------------

let activeTab = 'album';

function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-content').forEach(section => {
    section.classList.toggle('active', section.id === `tab-${tabId}`);
  });
  activeTab = tabId;
}

// -------------------------------------------------------
// 8. ALBUM VIEW
// -------------------------------------------------------

let albumPages = [];
let currentPageIndex = 0;

function renderAlbum() {
  albumPages = getAlbumPages();

  // Populate page selector
  const select = document.getElementById('page-select');
  select.innerHTML = albumPages.map((p, i) =>
    `<option value="${i}">Page ${p}</option>`
  ).join('');

  document.getElementById('page-total').textContent = albumPages.length;
  renderCurrentAlbumPage();
}

function renderCurrentAlbumPage() {
  const page = albumPages[currentPageIndex];
  if (page === undefined) return;

  // Label
  document.getElementById('album-page-label').textContent = `Page ${page}`;

  // Sync select
  document.getElementById('page-select').value = currentPageIndex;

  // Nav buttons
  document.getElementById('btn-prev').disabled = currentPageIndex === 0;
  document.getElementById('btn-next').disabled = currentPageIndex === albumPages.length - 1;

  // Filter stickers for this page
  const pageStickers = stickers.filter(s => s['Page (album)'] == page);

  // Render grid
  const grid = document.getElementById('album-grid');
  grid.innerHTML = '';
  pageStickers.forEach(s => {
    const card = buildStickerCard(s);
    grid.appendChild(card);
  });
}

function albumPrevPage() {
  if (currentPageIndex > 0) {
    currentPageIndex--;
    renderCurrentAlbumPage();
  }
}

function albumNextPage() {
  if (currentPageIndex < albumPages.length - 1) {
    currentPageIndex++;
    renderCurrentAlbumPage();
  }
}

function albumGoToPage(index) {
  currentPageIndex = parseInt(index, 10);
  renderCurrentAlbumPage();
}

function markAllPageOwned() {
  const page = albumPages[currentPageIndex];
  stickers.filter(s => s['Page (album)'] == page).forEach(s => {
    if (getState(s['ID']).status !== 'owned') {
      collectionState[s['ID']] = { status: 'owned', count: 0 };
    }
  });
  saveToLocalStorage();
  renderCurrentAlbumPage();
  updateHeaderStats();
  showToast('Page marquée possédée ✓', 'ok');
}

function markAllPageMissing() {
  const page = albumPages[currentPageIndex];
  stickers.filter(s => s['Page (album)'] == page).forEach(s => {
    collectionState[s['ID']] = { status: 'missing', count: 0 };
  });
  saveToLocalStorage();
  renderCurrentAlbumPage();
  updateHeaderStats();
  showToast('Page marquée manquante ✗', 'info');
}

/** Build a sticker card DOM element */
function buildStickerCard(sticker) {
  const id = sticker['ID'];
  const card = document.createElement('div');
  card.className = 'sticker-card';
  card.dataset.id = id;
  card.onclick = () => openModal(id);

  // Type class for badge
  const typeClass = {
    'Spécial': 'type-special',
    'Classique': 'type-classique',
    'Extra': 'type-extra'
  }[sticker['Type']] || 'type-classique';

  card.innerHTML = `
    <div class="sticker-flag-wrap">
      <img class="sticker-flag" src="${sticker['Drapeau']}" alt="${sticker['Nom']}" loading="lazy" onerror="this.src='';this.classList.add('error-flag')">
    </div>
    <div class="sticker-body">
      <div class="sticker-id">${id}</div>
      <div class="sticker-nom" title="${sticker['Nom']}">${sticker['Nom']}</div>
      <span class="sticker-type ${typeClass}">${sticker['Type']}</span>
    </div>
    <div class="sticker-status-badge"></div>`;

  decorateStickerCard(card, id);
  return card;
}

/** Apply status-based decoration to an existing card element */
function decorateStickerCard(card, id) {
  const { status, count } = getState(id);

  // Remove old status classes
  card.classList.remove('status-owned', 'status-missing', 'status-duplicate');
  card.classList.add(`status-${status}`);

  // Update badge
  const badge = card.querySelector('.sticker-status-badge');
  badge.className = 'sticker-status-badge';
  if (status === 'owned') {
    badge.classList.add('badge-owned');
    badge.textContent = '✓';
  } else if (status === 'missing') {
    badge.classList.add('badge-missing');
    badge.textContent = '✗';
  } else {
    badge.classList.add('badge-duplicate');
    badge.textContent = '+';
  }

  // Dup count
  let dupEl = card.querySelector('.sticker-dup-count');
  if (status === 'duplicate') {
    if (!dupEl) {
      dupEl = document.createElement('div');
      dupEl.className = 'sticker-dup-count';
      card.appendChild(dupEl);
    }
    dupEl.textContent = `×${count}`;
  } else if (dupEl) {
    dupEl.remove();
  }
}

// -------------------------------------------------------
// 9. COUNTRY VIEW
// -------------------------------------------------------

let activeCountryCode = null;

function renderCountryGrid() {
  const codes = uniqueValues('Code');
  const grid = document.getElementById('country-grid');
  grid.innerHTML = '';

  codes.forEach(code => {
    const codeStickers = stickers.filter(s => s['Code'] === code);
    const owned = codeStickers.filter(s => {
      const st = getState(s['ID']).status;
      return st === 'owned' || st === 'duplicate';
    }).length;
    const pct = Math.round((owned / codeStickers.length) * 100);
    const flag = getFlagForCode(code);
    const sectionName = codeStickers[0]?.['Section'] || code;

    const pill = document.createElement('button');
    pill.className = 'country-pill';
    pill.dataset.code = code;
    pill.onclick = () => {
      document.querySelectorAll('.country-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      activeCountryCode = code;
      renderCountryDetail(code);
    };
    pill.innerHTML = `
      ${flag ? `<img src="${flag}" alt="${code}" onerror="this.style.display='none'">` : ''}
      <span>${code}</span>
      <span class="cpill-pct">${pct}%</span>`;
    grid.appendChild(pill);
  });
}

function renderCountryDetail(code) {
  const codeStickers = stickers.filter(s => s['Code'] === code);
  const flag = getFlagForCode(code);
  const sectionName = codeStickers[0]?.['Section'] || code;

  const owned = codeStickers.filter(s => {
    const st = getState(s['ID']).status;
    return st === 'owned' || st === 'duplicate';
  }).length;
  const missing = codeStickers.filter(s => getState(s['ID']).status === 'missing').length;
  const pct = Math.round((owned / codeStickers.length) * 100);

  const detail = document.getElementById('country-detail');
  detail.innerHTML = `
    <div class="country-detail-header">
      ${flag ? `<img class="country-detail-flag" src="${flag}" alt="${code}" onerror="this.style.display='none'">` : ''}
      <div>
        <div class="country-detail-name">${sectionName}</div>
        <div class="country-detail-code">${code} — ${codeStickers.length} vignettes</div>
      </div>
      <div class="country-detail-stats">
        <div class="pct-big">${pct}%</div>
        <div style="font-size:10px;color:var(--outline);font-family:var(--font-mono)">${owned}/${codeStickers.length} possédées · ${missing} manquantes</div>
      </div>
    </div>
    <div class="album-grid" id="country-sticker-grid"></div>`;

  const grid = document.getElementById('country-sticker-grid');
  codeStickers.forEach(s => {
    const card = buildStickerCard(s);
    grid.appendChild(card);
  });
}

// -------------------------------------------------------
// 10. MISSING LIST VIEW
// -------------------------------------------------------

function renderMissingList() {
  const code    = document.getElementById('missing-filter-code').value;
  const section = document.getElementById('missing-filter-section').value;
  const type    = document.getElementById('missing-filter-type').value;
  const group   = document.getElementById('missing-filter-group').value;

  let filtered = stickers.filter(s => getState(s['ID']).status === 'missing');
  if (code)    filtered = filtered.filter(s => s['Code'] === code);
  if (section) filtered = filtered.filter(s => s['Section'] === section);
  if (type)    filtered = filtered.filter(s => s['Type'] === type);
  if (group)   filtered = filtered.filter(s => s['Groupe'] === group);

  renderListView('missing-list', filtered, 'missing');
}

// -------------------------------------------------------
// 11. DUPLICATE LIST VIEW
// -------------------------------------------------------

function renderDuplicateList() {
  const code    = document.getElementById('dup-filter-code').value;
  const section = document.getElementById('dup-filter-section').value;
  const type    = document.getElementById('dup-filter-type').value;
  const group   = document.getElementById('dup-filter-group').value;

  let filtered = stickers.filter(s => getState(s['ID']).status === 'duplicate');
  if (code)    filtered = filtered.filter(s => s['Code'] === code);
  if (section) filtered = filtered.filter(s => s['Section'] === section);
  if (type)    filtered = filtered.filter(s => s['Type'] === type);
  if (group)   filtered = filtered.filter(s => s['Groupe'] === group);

  renderListView('dup-list', filtered, 'duplicate');
}

/**
 * Render a grouped list view (missing or duplicate).
 * @param {string} containerId
 * @param {Array} stickerList
 * @param {'missing'|'duplicate'} chipType
 */
function renderListView(containerId, stickerList, chipType) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  if (!stickerList.length) {
    container.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">${chipType === 'missing' ? '🎉' : '📦'}</div><p>${chipType === 'missing' ? 'Aucune vignette manquante !' : 'Aucun doublon.'}</p></div>`;
    return;
  }

  // Group by code
  const groups = groupBy(stickerList, 'Code');

  Object.entries(groups).sort().forEach(([code, items]) => {
    const flag = getFlagForCode(code);
    const sectionName = items[0]?.['Section'] || code;
    const group = document.createElement('div');
    group.className = 'list-group';

    const chipsHtml = items.map(s => {
      const st = getState(s['ID']);
      const countHtml = chipType === 'duplicate'
        ? `<span class="chip-dup-count">${st.count}</span>` : '';
      const num = getStickerNumber(s);
      return `<span class="list-item-chip chip-${chipType}" data-id="${s['ID']}" title="${s['Nom']}" onclick="openModal('${s['ID']}')">${num}${countHtml}</span>`;
    }).join('');

    group.innerHTML = `
      <div class="list-group-header">
        ${flag ? `<img class="list-group-flag" src="${flag}" alt="${code}" onerror="this.style.display='none'">` : ''}
        <span class="list-group-code">${code}</span>
        <span class="list-group-name">${sectionName}</span>
        <span class="list-group-count">${items.length}</span>
      </div>
      <div class="list-items">${chipsHtml}</div>`;

    container.appendChild(group);
  });
}

// -------------------------------------------------------
// 12. EXPORT LIST TEXT (wantlist / duplicate list)
// -------------------------------------------------------

/**
 * Build the text export string:
 * Format: CODE num1,num2,num3
 * Example: MEX 1,2,5,10
 * @param {Array} stickerList
 * @returns {string}
 */
function buildExportText(stickerList) {
  const groups = groupBy(stickerList, 'Code');
  return Object.entries(groups).sort()
    .map(([code, items]) => {
      const nums = items.map(s => getStickerNumber(s)).join(',');
      return `${code} ${nums}`;
    })
    .join('\n');
}

function exportMissingList() {
  const code    = document.getElementById('missing-filter-code').value;
  const section = document.getElementById('missing-filter-section').value;
  const type    = document.getElementById('missing-filter-type').value;
  const group   = document.getElementById('missing-filter-group').value;

  let filtered = stickers.filter(s => getState(s['ID']).status === 'missing');
  if (code)    filtered = filtered.filter(s => s['Code'] === code);
  if (section) filtered = filtered.filter(s => s['Section'] === section);
  if (type)    filtered = filtered.filter(s => s['Type'] === type);
  if (group)   filtered = filtered.filter(s => s['Groupe'] === group);

  const text = buildExportText(filtered);
  const ta = document.getElementById('missing-textarea');
  ta.value = text || '(aucune vignette manquante)';
  ta.select();
  try { document.execCommand('copy'); showToast('Liste copiée ✓', 'ok'); }
  catch { showToast('Sélectionne et copie le texte manuellement', 'info'); }
}

function exportDuplicateList() {
  const code    = document.getElementById('dup-filter-code').value;
  const section = document.getElementById('dup-filter-section').value;
  const type    = document.getElementById('dup-filter-type').value;
  const group   = document.getElementById('dup-filter-group').value;

  let filtered = stickers.filter(s => getState(s['ID']).status === 'duplicate');
  if (code)    filtered = filtered.filter(s => s['Code'] === code);
  if (section) filtered = filtered.filter(s => s['Section'] === section);
  if (type)    filtered = filtered.filter(s => s['Type'] === type);
  if (group)   filtered = filtered.filter(s => s['Groupe'] === group);

  const text = buildExportText(filtered);
  const ta = document.getElementById('dup-textarea');
  ta.value = text || '(aucun doublon)';
  ta.select();
  try { document.execCommand('copy'); showToast('Liste copiée ✓', 'ok'); }
  catch { showToast('Sélectionne et copie le texte manuellement', 'info'); }
}

// -------------------------------------------------------
// 13. STATS VIEW
// -------------------------------------------------------

function renderStats() {
  let owned = 0, missing = 0, dup = 0;
  stickers.forEach(s => {
    const st = getState(s['ID']).status;
    if (st === 'owned')     owned++;
    else if (st === 'missing') missing++;
    else if (st === 'duplicate') { owned++; dup++; }
  });

  const total = stickers.length;
  const pct   = total ? Math.round((owned / total) * 100) : 0;

  document.getElementById('stat-owned').textContent   = owned;
  document.getElementById('stat-missing').textContent = missing;
  document.getElementById('stat-dup').textContent     = dup;
  document.getElementById('stat-total').textContent   = total;
  document.getElementById('stats-pct').textContent    = pct + '%';
  document.getElementById('stats-big-fill').style.width = pct + '%';

  // Per-section stats
  const sections = groupBy(stickers, 'Section');
  const statsGrid = document.getElementById('stats-grid');
  statsGrid.innerHTML = '';

  Object.entries(sections)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([section, items]) => {
      const sOwned = items.filter(s => {
        const st = getState(s['ID']).status;
        return st === 'owned' || st === 'duplicate';
      }).length;
      const sPct = Math.round((sOwned / items.length) * 100);
      const flag = getFlagForCode(items[0]['Code']);

      const row = document.createElement('div');
      row.className = 'stats-row';
      row.innerHTML = `
        ${flag ? `<img class="stats-row-flag" src="${flag}" alt="${section}" onerror="this.style.display='none'">` : '<div style="width:28px"></div>'}
        <span class="stats-row-name" title="${section}">${section}</span>
        <span style="font-family:var(--font-mono);font-size:9px;color:var(--outline);margin-left:auto;margin-right:6px;">${sOwned}/${items.length}</span>
        <div class="stats-row-bar-wrap">
          <div class="stats-row-bar-fill ${sPct === 100 ? 'stats-row-fill-green' : ''}" style="width:${sPct}%"></div>
        </div>
        <span class="stats-row-pct">${sPct}%</span>`;
      statsGrid.appendChild(row);
    });
}

// -------------------------------------------------------
// 14. EXCHANGE MODULE
// -------------------------------------------------------

/**
 * Parse a list text (e.g. "MEX 1,2,3\nFRA 4,5") into a map:
 * { MEX: ['MEX1','MEX2','MEX3'], FRA: ['FRA4','FRA5'] }
 * Also handles plain IDs like "MEX1,MEX2" or mixed formats.
 * @param {string} text
 * @returns {Object}
 */
function parseListText(text) {
  const result = {};
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  lines.forEach(line => {
    // Try to match "CODE num1,num2,..." pattern
    const match = line.match(/^([A-Z0-9]{2,5})\s+([\d,]+)$/);
    if (match) {
      const code = match[1];
      const nums = match[2].split(',').map(n => n.trim()).filter(Boolean);
      result[code] = (result[code] || []).concat(nums.map(n => code + n));
    } else {
      // Try comma-separated IDs: MEX1,MEX2,FRA3
      const ids = line.split(',').map(s => s.trim()).filter(Boolean);
      ids.forEach(id => {
        // Extract code prefix (letters)
        const codeMatch = id.match(/^([A-Z]{2,5})/);
        if (codeMatch) {
          const code = codeMatch[1];
          result[code] = result[code] || [];
          result[code].push(id);
        }
      });
    }
  });

  return result;
}

/**
 * Analyze exchange possibilities between my collection and a colleague's list.
 * "Je peux lui donner" = my duplicates that match their missing
 * "Il peut me donner" = their duplicates that match my missing
 */
function analyzeExchange() {
  const inputText = document.getElementById('exchange-input').value.trim();
  if (!inputText) {
    showToast('Colle la liste du collègue avant d\'analyser', 'info');
    return;
  }

  // Parse two blocks: separated by blank line or "manquantes:" / "doublons:" labels
  let colleagueMissing = {};
  let colleagueDuplicates = {};

  // Smart split: look for "manquantes" / "doublons" keywords
  const lower = inputText.toLowerCase();
  let missingBlock = '', dupBlock = '';

  const dupIdx = Math.max(lower.indexOf('doublon'), lower.indexOf('doublons'));
  const misIdx = Math.max(lower.indexOf('manquante'), lower.indexOf('manquantes'));

  if (dupIdx !== -1 && misIdx !== -1) {
    if (misIdx < dupIdx) {
      missingBlock = inputText.substring(misIdx, dupIdx);
      dupBlock     = inputText.substring(dupIdx);
    } else {
      dupBlock     = inputText.substring(dupIdx, misIdx);
      missingBlock = inputText.substring(misIdx);
    }
    // Remove keywords from start of each block
    missingBlock = missingBlock.replace(/manquantes?:?\s*/i, '');
    dupBlock     = dupBlock.replace(/doublons?:?\s*/i, '');
  } else {
    // No labels: treat first half as missing, second as duplicates (split by blank line)
    const blocks = inputText.split(/\n\s*\n/);
    missingBlock = blocks[0] || '';
    dupBlock     = blocks[1] || '';
  }

  colleagueMissing    = parseListText(missingBlock);
  colleagueDuplicates = parseListText(dupBlock);

  // My own data
  const myDuplicates = stickers.filter(s => getState(s['ID']).status === 'duplicate');
  const myMissing    = stickers.filter(s => getState(s['ID']).status === 'missing');

  // What I can give: my duplicates that colleague needs (is missing)
  const allColleagueMissing = Object.values(colleagueMissing).flat();
  const iCanGive = myDuplicates.filter(s => allColleagueMissing.includes(s['ID']));

  // What colleague can give me: their duplicates that I'm missing
  const allColleagueDuplicates = Object.values(colleagueDuplicates).flat();
  const iCanReceive = myMissing.filter(s => allColleagueDuplicates.includes(s['ID']));

  renderExchangeResults(iCanGive, iCanReceive);
}

function renderExchangeResults(canGive, canReceive) {
  const container = document.getElementById('exchange-results');

  if (!canGive.length && !canReceive.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">😔</div>
        <p>Aucun échange possible détecté.<br>Vérifie le format de la liste.</p>
      </div>`;
    return;
  }

  const buildChips = (items, cls) => items.map(s =>
    `<span class="list-item-chip ${cls}" onclick="openModal('${s['ID']}')" title="${s['Nom']}">${s['ID']}</span>`
  ).join('');

  container.innerHTML = `
    <div class="exchange-section-title give">✅ Je peux lui donner (${canGive.length})</div>
    <div class="list-items" style="margin-bottom:20px">${canGive.length ? buildChips(canGive, 'chip-duplicate') : '<span style="color:var(--outline);font-size:11px;font-family:var(--font-mono)">Aucun</span>'}</div>

    <div class="exchange-section-title receive">📥 Il peut me donner (${canReceive.length})</div>
    <div class="list-items">${canReceive.length ? buildChips(canReceive, 'chip-missing') : '<span style="color:var(--outline);font-size:11px;font-family:var(--font-mono)">Aucun</span>'}</div>`;
}

// -------------------------------------------------------
// 15. MODAL
// -------------------------------------------------------

let currentModal = null;

function openModal(id) {
  const sticker = stickers.find(s => s['ID'] === id);
  if (!sticker) return;
  currentModal = id;

  document.getElementById('modal-flag').src = sticker['Drapeau'] || '';
  document.getElementById('modal-flag').alt = sticker['Nom'];
  document.getElementById('modal-id').textContent  = id;
  document.getElementById('modal-nom').textContent = sticker['Nom'];
  document.getElementById('modal-section').textContent = sticker['Section'] || '';
  document.getElementById('modal-type').textContent    = sticker['Type'] || '';

  const grp = document.getElementById('modal-group');
  if (sticker['Groupe']) {
    grp.textContent = 'Groupe ' + sticker['Groupe'];
    grp.style.display = 'inline-block';
  } else {
    grp.style.display = 'none';
  }

  updateModalStatus(id);
  document.getElementById('modal-overlay').classList.add('open');
}

function updateModalStatus(id) {
  const { status, count } = getState(id);
  const labels = {
    owned:     '✓ Possédée',
    missing:   '✗ Manquante',
    duplicate: `✌ Doublon ×${count}`
  };
  const el = document.getElementById('modal-current-status');
  el.textContent = labels[status] || '';
  el.style.color = status === 'owned' ? 'var(--green)' : status === 'missing' ? 'var(--red)' : 'var(--blue-light)';
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');

  // After closing, refresh relevant view
  if (activeTab === 'manquantes') renderMissingList();
  if (activeTab === 'doublons')   renderDuplicateList();
  if (activeTab === 'stats')      renderStats();
  if (activeTab === 'pays' && activeCountryCode) renderCountryDetail(activeCountryCode);

  updateHeaderStats();
  currentModal = null;
}

// -------------------------------------------------------
// 16. TOAST NOTIFICATIONS
// -------------------------------------------------------

let toastTimer = null;

/**
 * @param {string} message
 * @param {'ok'|'err'|'info'} type
 */
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast show toast-${type}`;

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 2500);
}

// -------------------------------------------------------
// 17. KEYBOARD SHORTCUTS
// -------------------------------------------------------

document.addEventListener('keydown', (e) => {
  // Escape: close modal
  if (e.key === 'Escape') closeModal();

  // Arrow navigation in album
  if (activeTab === 'album' && !document.getElementById('modal-overlay').classList.contains('open')) {
    if (e.key === 'ArrowRight') albumNextPage();
    if (e.key === 'ArrowLeft')  albumPrevPage();
  }

  // In modal, 1/2/3 keys for quick status set
  if (currentModal && document.getElementById('modal-overlay').classList.contains('open')) {
    if (e.key === '1') setStatus(currentModal, 'owned');
    if (e.key === '2') setStatus(currentModal, 'missing');
    if (e.key === '3') setStatus(currentModal, 'duplicate');
  }
});

// -------------------------------------------------------
// 18. START
// -------------------------------------------------------

// Wait for DOM ready then boot
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
