/* ═══════════════════════════════════════════════════════════
   PANINI FIFA WORLD CUP 2026 — app.js
   Application de suivi de collection (vanilla JS, single file)
   ─────────────────────────────────────────────────────────
   Structure :
     1. État global
     2. Chargement des données (stickers.json)
     3. Gestion de collectionState (statuts)
     4. localStorage (cache auto)
     5. Export / Import JSON
     6. Rendu des vues
        a) Album par page
        b) Par pays
        c) Manquantes (wantlist)
        d) Doublons
        e) Stats
     7. Navigation / onglets
     8. Utilitaires (toast, filtres, …)
     9. Init
═══════════════════════════════════════════════════════════ */

/* ──────────────────────────────────────────────────────────
   1. ÉTAT GLOBAL
────────────────────────────────────────────────────────── */

/**
 * stickers : tableau de tous les objets vignettes chargés depuis stickers.json
 * Chaque objet a les clés : page, id, nom, section, type, groupe, code, drapeau
 */
let stickers = [];

/**
 * collectionState : objet indexé par stickerID
 * Structure : { [id]: { status: 'owned' | 'missing' | 'duplicate', count: number } }
 * count est le nombre de doublons (pertinent uniquement si status === 'duplicate')
 */
let collectionState = {};

/** Pages uniques de l'album (triées) */
let albumPages = [];

/** Index de la page courante dans albumPages */
let currentPageIndex = 0;

/** Onglet actif */
let currentTab = 'album';

const LS_KEY = 'panini-wc2026-collection';

/* ──────────────────────────────────────────────────────────
   2. CHARGEMENT DES DONNÉES
────────────────────────────────────────────────────────── */

/**
 * Charge le fichier stickers.json et initialise l'app.
 */
async function loadData() {
  try {
    const response = await fetch('stickers.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('Le fichier stickers.json est vide ou invalide.');
    }

    stickers = data;

    // Initialise collectionState : toutes les vignettes sont "manquantes" par défaut
    stickers.forEach(s => {
      if (!collectionState[s.id]) {
        collectionState[s.id] = { status: 'missing', count: 0 };
      }
    });

    // Essaye de restaurer depuis localStorage
    loadFromLocalStorage();

    // Calcule les pages uniques triées (traitement spécial pour '/')
    albumPages = [...new Set(stickers.map(s => s.page))].sort((a, b) => {
      if (a === '/') return 1;
      if (b === '/') return -1;
      return parseInt(a) - parseInt(b);
    });

    // Masque le message de chargement
    document.getElementById('loadingMsg').style.display = 'none';

    // Peuple les selects de filtres
    populateFilters();

    // Affiche la vue initiale
    switchTab('album');
    updateGlobalProgress();

  } catch (err) {
    document.getElementById('loadingMsg').style.display = 'none';
    const errEl = document.getElementById('errorMsg');
    errEl.style.display = 'block';
    document.getElementById('errorText').textContent =
      `❌ Impossible de charger les données : ${err.message}. ` +
      `Assurez-vous que stickers.json est bien présent dans le même dossier que index.html.`;
    console.error(err);
  }
}

/* ──────────────────────────────────────────────────────────
   3. GESTION DU collectionState
────────────────────────────────────────────────────────── */

/**
 * Met à jour le statut d'une vignette.
 * @param {string} id - identifiant de la vignette
 * @param {'owned'|'missing'|'duplicate'} status
 * @param {number} [countDelta=0] - si doublon, incrément du compteur
 */
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

/**
 * Retourne l'état d'une vignette (avec fallback 'missing').
 */
function getState(id) {
  return collectionState[id] || { status: 'missing', count: 0 };
}

/* ──────────────────────────────────────────────────────────
   4. LOCALSTORAGE (cache auto)
────────────────────────────────────────────────────────── */

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
      // Merge avec l'état courant (les nouvelles vignettes restent 'missing')
      Object.assign(collectionState, parsed);
    }
  } catch (e) {
    console.warn('Impossible de lire localStorage :', e);
  }
}

/* ──────────────────────────────────────────────────────────
   5. EXPORT / IMPORT JSON
────────────────────────────────────────────────────────── */

/**
 * Exporte collectionState en fichier JSON téléchargeable.
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
    showToast('✅ Collection exportée !');
  } catch (err) {
    showToast('❌ Erreur export : ' + err.message, true);
  }
}

/**
 * Déclenche l'input file pour l'import.
 */
function triggerImport() {
  document.getElementById('importFileInput').click();
}

/**
 * Handler pour l'événement change sur l'input file d'import.
 * @param {Event} event
 */
function handleImportFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  importCollectionFromJSON(file);
  // Réinitialise l'input pour permettre de réimporter le même fichier
  event.target.value = '';
}

/**
 * Lit et importe un fichier JSON de collection.
 * @param {File} file
 */
function importCollectionFromJSON(file) {
  const reader = new FileReader();

  reader.onload = function (e) {
    try {
      const imported = JSON.parse(e.target.result);

      // Validation minimale
      if (typeof imported !== 'object' || Array.isArray(imported)) {
        throw new Error('Format invalide : l\'objet racine doit être un dictionnaire.');
      }

      // Vérifie quelques clés au hasard pour s'assurer du format
      const keys = Object.keys(imported);
      if (keys.length > 0) {
        const sample = imported[keys[0]];
        if (!sample.status) throw new Error('Format invalide : propriété "status" manquante.');
      }

      // Écrase l'état courant
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

  reader.onerror = function () {
    showToast('❌ Impossible de lire le fichier.', true);
  };

  reader.readAsText(file);
}

/* ──────────────────────────────────────────────────────────
   6a. VUE ALBUM PAR PAGE
────────────────────────────────────────────────────────── */

/**
 * Peuple le <select> de pages d'album.
 */
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

/**
 * Affiche la page courante de l'album.
 */
function renderAlbumPage() {
  const page   = albumPages[currentPageIndex];
  const items  = stickers.filter(s => s.page === page);

  // En-tête de page
  const header = document.getElementById('albumPageHeader');
  header.textContent = page === '/' ? 'Vignettes Extra' : `Page ${page}`;

  // Mise à jour du select
  const sel = document.getElementById('albumPageSelect');
  if (sel) sel.value = currentPageIndex;

  // Rendu grille
  const grid = document.getElementById('albumGrid');
  grid.innerHTML = '';
  items.forEach(s => grid.appendChild(createStickerCard(s, 'album')));

  // Boutons prev/next
  document.getElementById('prevPageBtn').disabled = currentPageIndex === 0;
  document.getElementById('nextPageBtn').disabled = currentPageIndex === albumPages.length - 1;
}

function albumPrevPage() {
  if (currentPageIndex > 0) {
    currentPageIndex--;
    renderAlbumPage();
  }
}

function albumNextPage() {
  if (currentPageIndex < albumPages.length - 1) {
    currentPageIndex++;
    renderAlbumPage();
  }
}

function albumGoToPage(idx) {
  currentPageIndex = parseInt(idx);
  renderAlbumPage();
}

/* ──────────────────────────────────────────────────────────
   6b. VUE PAR PAYS
────────────────────────────────────────────────────────── */

/**
 * Peuple le select de pays.
 */
function populatePaysSelect() {
  const sel = document.getElementById('paysSelect');
  sel.innerHTML = '';

  // Codes uniques avec section associée
  const seen = new Map();
  stickers.forEach(s => {
    if (!seen.has(s.code)) seen.set(s.code, s.section);
  });

  // Trie alphabétiquement sur la section
  const sorted = [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], 'fr'));
  sorted.forEach(([code, section]) => {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = `${section} (${code})`;
    sel.appendChild(opt);
  });
}

/**
 * Affiche la grille pour le pays sélectionné.
 */
function renderPaysView() {
  const code  = document.getElementById('paysSelect').value;
  const items = stickers.filter(s => s.code === code);

  // En-tête pays
  const header = document.getElementById('paysHeader');
  const sampleFlag = items[0] ? items[0].drapeau : '';
  const sampleSection = items[0] ? items[0].section : code;
  header.innerHTML = sampleFlag
    ? `<img src="${escHtml(sampleFlag)}" alt="" onerror="this.style.display='none'"> ${escHtml(sampleSection)}`
    : escHtml(sampleSection);

  // Grille
  const grid = document.getElementById('paysGrid');
  grid.innerHTML = '';
  items.forEach(s => grid.appendChild(createStickerCard(s, 'pays')));
}

/* ──────────────────────────────────────────────────────────
   6c. VUE MANQUANTES (WANTLIST)
────────────────────────────────────────────────────────── */

function renderWantlist() {
  const items = getFilteredByStatus('missing', {
    code:    document.getElementById('wantFilterCode').value,
    section: document.getElementById('wantFilterSection').value,
    type:    document.getElementById('wantFilterType').value,
    groupe:  document.getElementById('wantFilterGroupe').value,
  });

  document.getElementById('wantCount').textContent = `${items.length} vignette(s) manquante(s)`;

  const grid = document.getElementById('wantGrid');
  grid.innerHTML = '';
  items.forEach(s => grid.appendChild(createStickerCard(s, 'want')));

  // Masque le textarea si ouvert
  document.getElementById('wantTextareaWrap').style.display = 'none';
}

/**
 * Génère le texte de la wantlist et l'affiche dans le textarea.
 */
function exportWantlistText() {
  const items = getFilteredByStatus('missing', {
    code:    document.getElementById('wantFilterCode').value,
    section: document.getElementById('wantFilterSection').value,
    type:    document.getElementById('wantFilterType').value,
    groupe:  document.getElementById('wantFilterGroupe').value,
  });

  const text = buildExportText(items);
  const wrap = document.getElementById('wantTextareaWrap');
  document.getElementById('wantTextarea').value = text;
  wrap.style.display = 'block';
  wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ──────────────────────────────────────────────────────────
   6d. VUE DOUBLONS
────────────────────────────────────────────────────────── */

function renderDoublons() {
  const items = getFilteredByStatus('duplicate', {
    code:    document.getElementById('dubFilterCode').value,
    section: document.getElementById('dubFilterSection').value,
    type:    document.getElementById('dubFilterType').value,
    groupe:  document.getElementById('dubFilterGroupe').value,
  });

  document.getElementById('dubCount').textContent = `${items.length} vignette(s) en doublon`;

  const grid = document.getElementById('dubGrid');
  grid.innerHTML = '';
  items.forEach(s => grid.appendChild(createStickerCard(s, 'dup')));

  document.getElementById('dubTextareaWrap').style.display = 'none';
}

function exportDoublonsText() {
  const items = getFilteredByStatus('duplicate', {
    code:    document.getElementById('dubFilterCode').value,
    section: document.getElementById('dubFilterSection').value,
    type:    document.getElementById('dubFilterType').value,
    groupe:  document.getElementById('dubFilterGroupe').value,
  });

  const text = buildExportText(items);
  const wrap = document.getElementById('dubTextareaWrap');
  document.getElementById('dubTextarea').value = text;
  wrap.style.display = 'block';
  wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ──────────────────────────────────────────────────────────
   6e. VUE STATS
────────────────────────────────────────────────────────── */

function renderStats() {
  const grid = document.getElementById('statsGrid');
  grid.innerHTML = '';

  const total     = stickers.length;
  const owned     = stickers.filter(s => getState(s.id).status === 'owned').length;
  const missing   = stickers.filter(s => getState(s.id).status === 'missing').length;
  const duplicate = stickers.filter(s => getState(s.id).status === 'duplicate').length;
  const possessed = owned + duplicate;
  const pct       = total > 0 ? Math.round((possessed / total) * 100) : 0;

  // ── Bloc global ──
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
      <div class="stat-progress-row album-row">
        <span class="stat-progress-label">Complétion</span>
        <div class="stat-bar-wrap">
          <div class="stat-bar-fill" style="width:${pct}%"></div>
        </div>
        <span class="stat-bar-pct">${pct}%</span>
      </div>
      <div class="stat-total-label">${possessed} / ${total} vignettes possédées (dont ${duplicate} en doublon)</div>
    </div>
  `;
  grid.appendChild(globalBlock);

  // ── Bloc par pays (code) ──
  const paysBlock = document.createElement('div');
  paysBlock.className = 'stats-block';
  let paysRows = '';
  const codeMap = {};
  stickers.forEach(s => {
    if (!codeMap[s.code]) codeMap[s.code] = { section: s.section, total: 0, owned: 0 };
    codeMap[s.code].total++;
    if (getState(s.id).status === 'owned' || getState(s.id).status === 'duplicate') codeMap[s.code].owned++;
  });
  const sortedCodes = Object.entries(codeMap).sort((a, b) => a[1].section.localeCompare(b[1].section, 'fr'));
  sortedCodes.forEach(([code, info]) => {
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

  // ── Bloc par section ──
  const sectionBlock = document.createElement('div');
  sectionBlock.className = 'stats-block';
  let sectionRows = '';
  const secMap = {};
  stickers.forEach(s => {
    if (!secMap[s.section]) secMap[s.section] = { total: 0, owned: 0 };
    secMap[s.section].total++;
    if (getState(s.id).status === 'owned' || getState(s.id).status === 'duplicate') secMap[s.section].owned++;
  });
  Object.entries(secMap).sort((a, b) => a[0].localeCompare(b[0], 'fr')).forEach(([sec, info]) => {
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

/* ──────────────────────────────────────────────────────────
   7. NAVIGATION / ONGLETS
────────────────────────────────────────────────────────── */

/**
 * Active un onglet et affiche la vue correspondante.
 * @param {'album'|'pays'|'manquantes'|'doublons'|'stats'} tab
 */
function switchTab(tab) {
  currentTab = tab;

  // Active le bon bouton
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  // Masque tous les panneaux
  document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');

  // Affiche le panneau actif
  document.getElementById(`tab-${tab}`).style.display = 'block';

  // Rendu spécifique
  switch (tab) {
    case 'album':
      populateAlbumSelect();
      renderAlbumPage();
      break;
    case 'pays':
      populatePaysSelect();
      renderPaysView();
      break;
    case 'manquantes':
      renderWantlist();
      break;
    case 'doublons':
      renderDoublons();
      break;
    case 'stats':
      renderStats();
      break;
  }
}

/**
 * Ré-affiche la vue courante (après import par exemple).
 */
function rerenderCurrentTab() {
  switchTab(currentTab);
}

/* ──────────────────────────────────────────────────────────
   8. UTILITAIRES
────────────────────────────────────────────────────────── */

/**
 * Crée une carte de vignette.
 * @param {Object} s - objet vignette
 * @param {string} context - contexte d'utilisation ('album', 'pays', 'want', 'dup')
 * @returns {HTMLElement}
 */
function createStickerCard(s, context) {
  const state  = getState(s.id);
  const status = state.status;

  const card = document.createElement('div');
  card.className = `sticker-card ${status}`;
  card.dataset.id = s.id;

  // Classe CSS pour le type
  const typeClass = {
    'Spécial':   'type-special',
    'Classique': 'type-classique',
    'Extra':     'type-extra',
  }[s.type] || 'type-classique';

  // Badge doublon
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

/**
 * Handler des boutons d'action sur une carte.
 * Gère la mise à jour du statut + re-render de la carte.
 * @param {string} id
 * @param {'owned'|'missing'|'duplicate'} action
 */
function onCardAction(id, action) {
  const current = getState(id);

  if (action === 'duplicate') {
    // Incrémenter si déjà doublon, sinon passer à doublon avec count = 1
    if (current.status === 'duplicate') {
      setStatus(id, 'duplicate', 1);
    } else {
      setStatus(id, 'duplicate', 1);
    }
  } else if (action === 'missing') {
    // Si doublon : décrémenter, puis passer à missing si count = 0
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

  // Mise à jour de la carte sans re-render complet
  updateCardInDOM(id);
}

/**
 * Met à jour une carte dans le DOM après changement de statut.
 * @param {string} id
 */
function updateCardInDOM(id) {
  const cards = document.querySelectorAll(`.sticker-card[data-id="${id}"]`);
  const sticker = stickers.find(s => s.id === id);
  if (!sticker) return;

  cards.forEach(card => {
    const context = card.closest('#albumGrid') ? 'album'
      : card.closest('#paysGrid')   ? 'pays'
      : card.closest('#wantGrid')   ? 'want'
      : 'dup';

    const newCard = createStickerCard(sticker, context);
    card.replaceWith(newCard);
  });

  // Re-render stats si actif
  if (currentTab === 'stats') renderStats();

  // Re-render wantlist/doublons si actif (pour retirer les cartes changées)
  if (currentTab === 'manquantes') renderWantlist();
  if (currentTab === 'doublons')   renderDoublons();
}

/**
 * Filtre les vignettes par statut + filtres optionnels.
 */
function getFilteredByStatus(status, filters = {}) {
  return stickers.filter(s => {
    if (getState(s.id).status !== status) return false;
    if (filters.code    && s.code    !== filters.code)    return false;
    if (filters.section && s.section !== filters.section) return false;
    if (filters.type    && s.type    !== filters.type)    return false;
    if (filters.groupe  && s.groupe  !== filters.groupe)  return false;
    return true;
  });
}

/**
 * Peuple les selects de filtres (wantlist + doublons).
 */
function populateFilters() {
  // Codes uniques
  const codes    = [...new Set(stickers.map(s => s.code))].sort();
  const sections = [...new Set(stickers.map(s => s.section))].sort((a, b) => a.localeCompare(b, 'fr'));
  const types    = [...new Set(stickers.map(s => s.type))].sort();
  const groupes  = [...new Set(stickers.map(s => s.groupe).filter(Boolean))].sort();

  ['wantFilterCode', 'dubFilterCode'].forEach(selId => {
    const sel = document.getElementById(selId);
    codes.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      // Trouve la section associée pour un label lisible
      const sec = stickers.find(s => s.code === c)?.section || c;
      opt.textContent = `${sec} (${c})`;
      sel.appendChild(opt);
    });
  });

  ['wantFilterSection', 'dubFilterSection'].forEach(selId => {
    const sel = document.getElementById(selId);
    sections.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v; opt.textContent = v;
      sel.appendChild(opt);
    });
  });

  ['wantFilterType', 'dubFilterType'].forEach(selId => {
    const sel = document.getElementById(selId);
    types.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v; opt.textContent = v;
      sel.appendChild(opt);
    });
  });

  ['wantFilterGroupe', 'dubFilterGroupe'].forEach(selId => {
    const sel = document.getElementById(selId);
    groupes.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v; opt.textContent = `Groupe ${v}`;
      sel.appendChild(opt);
    });
  });
}

/**
 * Construit le texte d'export au format :
 *   CODE 1,2,3,4,...
 * Groupe par section (nom du pays) pour éviter les bugs de code
 * mal assigné dans le JSON. Utilise le code de la première vignette
 * de chaque section comme préfixe.
 */
function buildExportText(items) {
  // Groupe par section (nom du pays) — plus fiable que s.code
  const bySection = {};
  items.forEach(s => {
    const key = s.section;
    if (!bySection[key]) bySection[key] = { ids: [], refCode: null };
    // Le "bon" code d'une vignette est le préfixe de son propre ID
    const idMatch = s.id.match(/^([A-Za-z]+)\d+$/);
    if (idMatch && !bySection[key].refCode) {
      bySection[key].refCode = idMatch[1];
    } else if (!bySection[key].refCode) {
      bySection[key].refCode = s.id; // fallback pour IDs sans numéro (LM, JB…)
    }
    bySection[key].ids.push(s.id);
  });

  const lines = [];
  Object.entries(bySection)
    .sort((a, b) => a[0].localeCompare(b[0], 'fr'))
    .forEach(([, { ids, refCode }]) => {
      // Extrait les numéros depuis les IDs (ex: BRA12 → 12)
      const nums = ids.map(id => {
        const match = id.match(/^[A-Za-z]+(\d+)$/);
        return match ? parseInt(match[1]) : id;
      });
      // Déduplique et trie
      const unique = [...new Set(nums)];
      unique.sort((a, b) => {
        if (typeof a === 'number' && typeof b === 'number') return a - b;
        if (typeof a === 'number') return -1;
        if (typeof b === 'number') return 1;
        return String(a).localeCompare(String(b));
      });
      // Tout sur une seule ligne : CODE 1,2,3,...
      lines.push(`${refCode} ${unique.join(',')}`);
    });

  return lines.join('\n');
}

/**
 * Copie le contenu d'un textarea dans le presse-papier.
 */
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

/**
 * Met à jour la barre de progression globale dans le header.
 */
function updateGlobalProgress() {
  const total = stickers.length;
  const owned = stickers.filter(s => {
    const st = getState(s.id).status;
    return st === 'owned' || st === 'duplicate';
  }).length;
  const pct = total > 0 ? Math.round((owned / total) * 100) : 0;

  const bar   = document.getElementById('globalProgressBar');
  const label = document.getElementById('globalProgressLabel');
  if (bar)   bar.style.width = pct + '%';
  if (label) label.textContent = `${owned} / ${total} vignettes possédées (${pct}%)`;
}

/**
 * Affiche un toast de notification.
 * @param {string} msg
 * @param {boolean} [isError=false]
 */
function showToast(msg, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className   = 'toast' + (isError ? ' toast-error' : '');
  toast.style.display = 'block';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.display = 'none'; }, 2800);
}

/**
 * Échappe les caractères HTML dangereux.
 * @param {string} str
 * @returns {string}
 */
function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ──────────────────────────────────────────────────────────
   9. INIT
────────────────────────────────────────────────────────── */

// Lance le chargement au démarrage
document.addEventListener('DOMContentLoaded', loadData);
