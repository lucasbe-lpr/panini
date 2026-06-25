/* ═══════════════════════════════════════════════════════════
   PANINI FIFA WORLD CUP 2026 — app.js
   Application de suivi de collection (vanilla JS, single file)
═══════════════════════════════════════════════════════════ */

// ─── 1. ÉTAT GLOBAL ──────────────────────────────────────
let stickers = [];
let collectionState = {};
let albumPages = [];
let currentPageIndex = 0;
let currentTab = 'album';
const LS_KEY = 'panini-wc2026-collection';

// ─── 2. CHARGEMENT DES DONNÉES ──────────────────────────
async function loadData() {
  try {
    console.log('🔄 Chargement de stickers.json...');
    const response = await fetch('stickers.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('Le fichier stickers.json est vide ou invalide.');
    }

    stickers = data;

    // Initialisation de collectionState : toutes "missing"
    stickers.forEach(s => {
      if (!collectionState[s.id]) {
        collectionState[s.id] = { status: 'missing', count: 0 };
      }
    });

    // Chargement depuis localStorage (si disponible)
    loadFromLocalStorage();

    // Pages uniques
    albumPages = [...new Set(stickers.map(s => s.page))].sort((a, b) => {
      if (a === '/') return 1;
      if (b === '/') return -1;
      return parseInt(a) - parseInt(b);
    });

    // Masquer le loader
    document.getElementById('loadingMsg').style.display = 'none';

    // Peupler les filtres
    populateFilters();

    // Afficher la vue initiale
    switchTab('album');
    updateGlobalProgress();

    console.log('✅ Données chargées avec succès.');

  } catch (err) {
    document.getElementById('loadingMsg').style.display = 'none';
    const errEl = document.getElementById('errorMsg');
    errEl.style.display = 'block';
    document.getElementById('errorText').textContent =
      `❌ Erreur : ${err.message}. Vérifie que stickers.json est dans le même dossier que index.html.`;
    console.error('❌ Erreur de chargement :', err);
  }
}

// ─── 3. GESTION DE COLLECTION ──────────────────────────
function setStatus(id, status, countDelta = 0) {
  if (!collectionState[id]) {
    collectionState[id] = { status: 'missing', count: 0 };
  }
  if (status === 'duplicate') {
    collectionState[id].status = 'duplicate';
    collectionState[id].count = Math.max(1, (collectionState[id].count || 0) + countDelta);
  } else {
    collectionState[id].status = status;
    collectionState[id].count = 0;
  }
  saveToLocalStorage();
  updateGlobalProgress();
}

function getState(id) {
  return collectionState[id] || { status: 'missing', count: 0 };
}

// ─── 4. LOCALSTORAGE ────────────────────────────────────
function saveToLocalStorage() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(collectionState));
  } catch (e) {
    console.warn('localStorage indisponible :', e);
  }
}

function loadFromLocalStorage() {
  try {
    const stored = localStorage.getItem(LS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      Object.assign(collectionState, parsed);
    }
  } catch (e) {
    console.warn('Impossible de lire localStorage :', e);
  }
}

// ─── 5. EXPORT / IMPORT ──────────────────────────────────
function exportCollectionAsJSON() {
  try {
    const json = JSON.stringify(collectionState, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ma-collection-panini.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('✅ Collection exportée !');
  } catch (err) {
    showToast('❌ Erreur export : ' + err.message, true);
  }
}

function triggerImport() {
  document.getElementById('importFileInput').click();
}

function handleImportFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  importCollectionFromJSON(file);
  event.target.value = '';
}

function importCollectionFromJSON(file) {
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const imported = JSON.parse(e.target.result);
      if (typeof imported !== 'object' || Array.isArray(imported)) {
        throw new Error('Format invalide : objet attendu.');
      }
      const keys = Object.keys(imported);
      if (keys.length > 0) {
        const sample = imported[keys[0]];
        if (!sample.status) throw new Error('Propriété "status" manquante.');
      }
      collectionState = {};
      stickers.forEach(s => {
        collectionState[s.id] = { status: 'missing', count: 0 };
      });
      Object.assign(collectionState, imported);
      saveToLocalStorage();
      updateGlobalProgress();
      rerenderCurrentTab();
      showToast('✅ Collection importée !');
    } catch (err) {
      showToast('❌ Erreur import : ' + err.message, true);
    }
  };
  reader.onerror = () => showToast('❌ Impossible de lire le fichier.', true);
  reader.readAsText(file);
}

// ─── 6. VUES ─────────────────────────────────────────────

// 6a. ALBUM PAR PAGE
function populateAlbumSelect() {
  const sel = document.getElementById('albumPageSelect');
  sel.innerHTML = '';
  albumPages.forEach((page, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = page === '/' ? 'Extras (/)' : `Page ${page}`;
    sel.appendChild(opt);
  });
}

function renderAlbumPage() {
  const page = albumPages[currentPageIndex];
  const items = stickers.filter(s => s.page === page);
  document.getElementById('albumPageHeader').textContent = page === '/' ? 'Vignettes Extra' : `Page ${page}`;
  const sel = document.getElementById('albumPageSelect');
  if (sel) sel.value = currentPageIndex;
  const grid = document.getElementById('albumGrid');
  grid.innerHTML = '';
  items.forEach(s => grid.appendChild(createStickerCard(s, 'album')));
  document.getElementById('prevPageBtn').disabled = currentPageIndex === 0;
  document.getElementById('nextPageBtn').disabled = currentPageIndex === albumPages.length - 1;
}

function albumPrevPage() {
  if (currentPageIndex > 0) { currentPageIndex--; renderAlbumPage(); }
}
function albumNextPage() {
  if (currentPageIndex < albumPages.length - 1) { currentPageIndex++; renderAlbumPage(); }
}
function albumGoToPage(idx) {
  currentPageIndex = parseInt(idx);
  renderAlbumPage();
}

// 6b. PAR PAYS
function populatePaysSelect() {
  const sel = document.getElementById('paysSelect');
  sel.innerHTML = '';
  const seen = new Map();
  stickers.forEach(s => { if (!seen.has(s.code)) seen.set(s.code, s.section); });
  const sorted = [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], 'fr'));
  sorted.forEach(([code, section]) => {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = `${section} (${code})`;
    sel.appendChild(opt);
  });
}

function renderPaysView() {
  const code = document.getElementById('paysSelect').value;
  const items = stickers.filter(s => s.code === code);
  const header = document.getElementById('paysHeader');
  const sampleFlag = items[0]?.drapeau || '';
  const sampleSection = items[0]?.section || code;
  header.innerHTML = sampleFlag
    ? `<img src="${escHtml(sampleFlag)}" alt="" onerror="this.style.display='none'"> ${escHtml(sampleSection)}`
    : escHtml(sampleSection);
  const grid = document.getElementById('paysGrid');
  grid.innerHTML = '';
  items.forEach(s => grid.appendChild(createStickerCard(s, 'pays')));
}

// 6c. MANQUANTES
function renderWantlist() {
  const items = getFilteredByStatus('missing', {
    code: document.getElementById('wantFilterCode').value,
    section: document.getElementById('wantFilterSection').value,
    type: document.getElementById('wantFilterType').value,
    groupe: document.getElementById('wantFilterGroupe').value,
  });
  document.getElementById('wantCount').textContent = `${items.length} vignette(s) manquante(s)`;
  const grid = document.getElementById('wantGrid');
  grid.innerHTML = '';
  items.forEach(s => grid.appendChild(createStickerCard(s, 'want')));
  document.getElementById('wantTextareaWrap').style.display = 'none';
}

function exportWantlistText() {
  const items = getFilteredByStatus('missing', {
    code: document.getElementById('wantFilterCode').value,
    section: document.getElementById('wantFilterSection').value,
    type: document.getElementById('wantFilterType').value,
    groupe: document.getElementById('wantFilterGroupe').value,
  });
  const text = buildExportText(items);
  document.getElementById('wantTextarea').value = text;
  document.getElementById('wantTextareaWrap').style.display = 'block';
  document.getElementById('wantTextareaWrap').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// 6d. DOUBLONS
function renderDoublons() {
  const items = getFilteredByStatus('duplicate', {
    code: document.getElementById('dubFilterCode').value,
    section: document.getElementById('dubFilterSection').value,
    type: document.getElementById('dubFilterType').value,
    groupe: document.getElementById('dubFilterGroupe').value,
  });
  document.getElementById('dubCount').textContent = `${items.length} vignette(s) en doublon`;
  const grid = document.getElementById('dubGrid');
  grid.innerHTML = '';
  items.forEach(s => grid.appendChild(createStickerCard(s, 'dup')));
  document.getElementById('dubTextareaWrap').style.display = 'none';
}

function exportDoublonsText() {
  const items = getFilteredByStatus('duplicate', {
    code: document.getElementById('dubFilterCode').value,
    section: document.getElementById('dubFilterSection').value,
    type: document.getElementById('dubFilterType').value,
    groupe: document.getElementById('dubFilterGroupe').value,
  });
  const text = buildExportText(items);
  document.getElementById('dubTextarea').value = text;
  document.getElementById('dubTextareaWrap').style.display = 'block';
  document.getElementById('dubTextareaWrap').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// 6e. STATS
function renderStats() {
  const grid = document.getElementById('statsGrid');
  grid.innerHTML = '';
  const total = stickers.length;
  const owned = stickers.filter(s => getState(s.id).status === 'owned').length;
  const missing = stickers.filter(s => getState(s.id).status === 'missing').length;
  const duplicate = stickers.filter(s => getState(s.id).status === 'duplicate').length;
  const pct = total > 0 ? Math.round((owned / total) * 100) : 0;

  // Bloc global
  const globalBlock = document.createElement('div');
  globalBlock.className = 'stats-block';
  globalBlock.innerHTML = `
    <div class="stats-block-header">🏆 Résumé global</div>
    <div class="stats-block-content">
      <div class="stat-global-numbers">
        <div class="stat-number-block">
          <span class="stat-number s-owned">${owned}</span>
          <span class="stat-number-label">possédées</span>
        </div>
        <div class="stat-number-block">
          <span class="stat-number s-missing">${missing}</span>
          <span class="stat-number-label">manquantes</span>
        </div>
        <div class="stat-number-block">
          <span class="stat-number s-duplicate">${duplicate}</span>
          <span class="stat-number-label">doublons</span>
        </div>
      </div>
      <div class="stat-progress-row">
        <span class="stat-progress-label">Complétion album</span>
        <div class="stat-bar-wrap">
          <div class="stat-bar-fill" style="width:${pct}%"></div>
        </div>
        <span class="stat-bar-pct">${pct}%</span>
      </div>
      <div style="font-size:11px;color:var(--c-sky);text-align:center">
        ${owned} / ${total} vignettes possédées
      </div>
    </div>
  `;
  grid.appendChild(globalBlock);

  // Bloc par pays
  const paysBlock = document.createElement('div');
  paysBlock.className = 'stats-block';
  let paysRows = '';
  const codeMap = {};
  stickers.forEach(s => {
    if (!codeMap[s.code]) codeMap[s.code] = { section: s.section, total: 0, owned: 0 };
    codeMap[s.code].total++;
    if (getState(s.id).status === 'owned') codeMap[s.code].owned++;
  });
  Object.entries(codeMap)
    .sort((a, b) => a[1].section.localeCompare(b[1].section, 'fr'))
    .forEach(([code, info]) => {
      const p = info.total > 0 ? Math.round((info.owned / info.total) * 100) : 0;
      paysRows += `
        <div class="stat-progress-row">
          <span class="stat-progress-label" title="${escHtml(info.section)}">${escHtml(info.section)}</span>
          <div class="stat-bar-wrap">
            <div class="stat-bar-fill" style="width:${p}%"></div>
          </div>
          <span class="stat-bar-pct">${p}%</span>
        </div>`;
    });
  paysBlock.innerHTML = `
    <div class="stats-block-header">🌍 Complétion par pays</div>
    <div class="stats-block-content">${paysRows}</div>
  `;
  grid.appendChild(paysBlock);

  // Bloc par section
  const sectionBlock = document.createElement('div');
  sectionBlock.className = 'stats-block';
  let sectionRows = '';
  const secMap = {};
  stickers.forEach(s => {
    if (!secMap[s.section]) secMap[s.section] = { total: 0, owned: 0 };
    secMap[s.section].total++;
    if (getState(s.id).status === 'owned') secMap[s.section].owned++;
  });
  Object.entries(secMap)
    .sort((a, b) => a[0].localeCompare(b[0], 'fr'))
    .forEach(([sec, info]) => {
      const p = info.total > 0 ? Math.round((info.owned / info.total) * 100) : 0;
      sectionRows += `
        <div class="stat-progress-row">
          <span class="stat-progress-label" title="${escHtml(sec)}">${escHtml(sec)}</span>
          <div class="stat-bar-wrap">
            <div class="stat-bar-fill" style="width:${p}%"></div>
          </div>
          <span class="stat-bar-pct">${p}%</span>
        </div>`;
    });
  sectionBlock.innerHTML = `
    <div class="stats-block-header">📋 Complétion par section</div>
    <div class="stats-block-content">${sectionRows}</div>
  `;
  grid.appendChild(sectionBlock);
}

// ─── 7. NAVIGATION ──────────────────────────────────────
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
  document.getElementById(`tab-${tab}`).style.display = 'block';
  switch (tab) {
    case 'album': populateAlbumSelect(); renderAlbumPage(); break;
    case 'pays': populatePaysSelect(); renderPaysView(); break;
    case 'manquantes': renderWantlist(); break;
    case 'doublons': renderDoublons(); break;
    case 'stats': renderStats(); break;
  }
}

function rerenderCurrentTab() {
  switchTab(currentTab);
}

// ─── 8. UTILITAIRES ──────────────────────────────────────
function createStickerCard(s, context) {
  const state = getState(s.id);
  const status = state.status;
  const card = document.createElement('div');
  card.className = `sticker-card ${status}`;
  card.dataset.id = s.id;
  const typeClass = {
    'Spécial': 'type-special',
    'Classique': 'type-classique',
    'Extra': 'type-extra',
  }[s.type] || 'type-classique';
  const dupBadge = (status === 'duplicate' && state.count > 0)
    ? `<div class="sticker-dup-badge">×${state.count}</div>`
    : '';
  card.innerHTML = `
    <div class="sticker-status-bar"></div>
    <div class="sticker-img-wrap">
      <img class="sticker-flag"
           src="${escHtml(s.drapeau)}"
           alt="${escHtml(s.code)}"
           loading="lazy"
           onerror="this.style.display='none'" />
    </div>
    <div class="sticker-body">
      <div class="sticker-id">${escHtml(s.id)}</div>
      <div class="sticker-nom">${escHtml(s.nom)}</div>
      <div class="sticker-section">${escHtml(s.section)}</div>
      <span class="sticker-type ${typeClass}">${escHtml(s.type)}</span>
    </div>
    <div class="sticker-footer">
      <button class="sticker-btn btn-miss" title="Marquer manquante"
              onclick="onCardAction('${escHtml(s.id)}', 'missing')">✗</button>
      <button class="sticker-btn btn-own" title="Marquer possédée"
              onclick="onCardAction('${escHtml(s.id)}', 'owned')">✓</button>
      <button class="sticker-btn btn-dup" title="Ajouter un doublon"
              onclick="onCardAction('${escHtml(s.id)}', 'duplicate')">+1</button>
    </div>
    ${dupBadge}
  `;
  return card;
}

function onCardAction(id, action) {
  const current = getState(id);
  if (action === 'duplicate') {
    setStatus(id, 'duplicate', 1);
  } else if (action === 'missing') {
    if (current.status === 'duplicate' && current.count > 1) {
      collectionState[id].count--;
      saveToLocalStorage();
      updateGlobalProgress();
    } else {
      setStatus(id, 'missing');
    }
  } else {
    setStatus(id, action);
  }
  updateCardInDOM(id);
}

function updateCardInDOM(id) {
  const cards = document.querySelectorAll(`.sticker-card[data-id="${id}"]`);
  const sticker = stickers.find(s => s.id === id);
  if (!sticker) return;
  cards.forEach(card => {
    const context = card.closest('#albumGrid') ? 'album'
      : card.closest('#paysGrid') ? 'pays'
      : card.closest('#wantGrid') ? 'want'
      : 'dup';
    const newCard = createStickerCard(sticker, context);
    card.replaceWith(newCard);
  });
  if (currentTab === 'stats') renderStats();
  if (currentTab === 'manquantes') renderWantlist();
  if (currentTab === 'doublons') renderDoublons();
}

function getFilteredByStatus(status, filters = {}) {
  return stickers.filter(s => {
    if (getState(s.id).status !== status) return false;
    if (filters.code && s.code !== filters.code) return false;
    if (filters.section && s.section !== filters.section) return false;
    if (filters.type && s.type !== filters.type) return false;
    if (filters.groupe && s.groupe !== filters.groupe) return false;
    return true;
  });
}

function populateFilters() {
  const codes = [...new Set(stickers.map(s => s.code))].sort();
  const sections = [...new Set(stickers.map(s => s.section))].sort((a, b) => a.localeCompare(b, 'fr'));
  const types = [...new Set(stickers.map(s => s.type))].sort();
  const groupes = [...new Set(stickers.map(s => s.groupe).filter(Boolean))].sort();

  ['wantFilterCode', 'dubFilterCode'].forEach(selId => {
    const sel = document.getElementById(selId);
    codes.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      const sec = stickers.find(s => s.code === c)?.section || c;
      opt.textContent = `${sec} (${c})`;
      sel.appendChild(opt);
    });
  });
  ['wantFilterSection', 'dubFilterSection'].forEach(selId => {
    const sel = document.getElementById(selId);
    sections.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      sel.appendChild(opt);
    });
  });
  ['wantFilterType', 'dubFilterType'].forEach(selId => {
    const sel = document.getElementById(selId);
    types.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      sel.appendChild(opt);
    });
  });
  ['wantFilterGroupe', 'dubFilterGroupe'].forEach(selId => {
    const sel = document.getElementById(selId);
    groupes.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = `Groupe ${v}`;
      sel.appendChild(opt);
    });
  });
}

// ✨ FONCTION MODIFIÉE POUR L'EXPORT (correction des doublons)
function buildExportText(items) {
  const byPrefix = {};
  items.forEach(s => {
    const id = s.id;
    const match = id.match(/^([A-Za-z]+)(\d+)$/);
    const prefix = match ? match[1] : id;
    if (!byPrefix[prefix]) byPrefix[prefix] = [];
    byPrefix[prefix].push(id);
  });

  const lines = [];
  Object.entries(byPrefix)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([prefix, ids]) => {
      const nums = ids.map(id => {
        const match = id.match(/^[A-Za-z]+(\d+)$/);
        return match ? parseInt(match[1]) : id;
      });
      nums.sort((a, b) => {
        if (typeof a === 'number' && typeof b === 'number') return a - b;
        if (typeof a === 'number') return -1;
        if (typeof b === 'number') return 1;
        return String(a).localeCompare(String(b));
      });
      lines.push(prefix + ' ' + nums.join(','));
    });

  return lines.join('\n');
}

function copyTextarea(textareaId) {
  const ta = document.getElementById(textareaId);
  ta.select();
  try {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(ta.value).then(() => showToast('📋 Copié !'));
    } else {
      document.execCommand('copy');
      showToast('📋 Copié !');
    }
  } catch (e) {
    showToast('❌ Impossible de copier', true);
  }
}

function updateGlobalProgress() {
  const total = stickers.length;
  const owned = stickers.filter(s => getState(s.id).status === 'owned').length;
  const pct = total > 0 ? Math.round((owned / total) * 100) : 0;
  const bar = document.getElementById('globalProgressBar');
  const label = document.getElementById('globalProgressLabel');
  if (bar) bar.style.width = pct + '%';
  if (label) label.textContent = `${owned} / ${total} vignettes possédées (${pct}%)`;
}

function showToast(msg, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = 'toast' + (isError ? ' toast-error' : '');
  toast.style.display = 'block';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.display = 'none'; }, 2800);
}

function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── 9. INIT ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', loadData);
