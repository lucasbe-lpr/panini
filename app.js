/**
 * ═══════════════════════════════════════════════════════════
 *  PANINI WORLD CUP 2026 — APP.JS
 *  Application de suivi de collection, un seul utilisateur.
 *
 *  Structure :
 *   • stickers[]       : métadonnées (chargées depuis stickers.json)
 *   • collectionState  : { [stickerID]: { status, count } }
 *
 *  Vues : Album | Par pays | Manquantes | Doublons | Stats
 *  Stockage : localStorage (cache auto) + export/import JSON
 * ═══════════════════════════════════════════════════════════
 */

'use strict';

// ─── ÉTAT GLOBAL ────────────────────────────────────────────
let stickers = [];          // tableau de toutes les vignettes (du JSON)
let collectionState = {};   // { [id]: { status: 'missing'|'owned'|'duplicate', count: number } }

// Index de navigation album
let albumPageIndex = 0;     // index dans albumPages[]
let albumPages = [];        // liste ordonnée des valeurs "page"

// Valeur actuelle du filtre pays
let currentPaysCode = '';

// ─── CONSTANTES ─────────────────────────────────────────────
const LS_KEY = 'panini-wc2026-collection';
const STATUS = { MISSING: 'missing', OWNED: 'owned', DUPLICATE: 'duplicate' };

// ═══════════════════════════════════════════════════════════
//  1. INITIALISATION
// ═══════════════════════════════════════════════════════════

/**
 * Point d'entrée : charge les données, restaure l'état, initialise l'UI.
 */
async function init() {
  drawBgKinetic();      // fond Op-Art

  try {
    const response = await fetch('./stickers.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    stickers = await response.json();
  } catch (err) {
    showToast('Erreur : impossible de charger stickers.json — ' + err.message, true);
    return;
  }

  // Restaurer depuis localStorage si disponible
  const saved = localStorage.getItem(LS_KEY);
  if (saved) {
    try {
      collectionState = JSON.parse(saved);
    } catch {
      collectionState = {};
    }
  }

  // Assurer que chaque vignette a un état initial
  ensureAllStickersHaveState();

  // Construire les index utiles
  buildAlbumPages();

  // Initialiser l'interface
  initNavigation();
  initAlbumView();
  initPaysView();
  initFilterSelects();
  initExportImport();

  // Rendu initial
  renderAlbumPage();
  updateGlobalProgress();
}

/**
 * S'assure que toutes les vignettes ont un état dans collectionState.
 */
function ensureAllStickersHaveState() {
  stickers.forEach(s => {
    if (!collectionState[s.id]) {
      collectionState[s.id] = { status: STATUS.MISSING, count: 0 };
    }
  });
}

/**
 * Construit la liste ordonnée des pages d'album.
 */
function buildAlbumPages() {
  const pageSet = new Set(stickers.map(s => s.page));
  albumPages = Array.from(pageSet).sort((a, b) => {
    if (a === '/') return 1;
    if (b === '/') return -1;
    return parseInt(a, 10) - parseInt(b, 10);
  });
}

// ═══════════════════════════════════════════════════════════
//  2. FOND CINÉTIQUE OP-ART
// ═══════════════════════════════════════════════════════════

/**
 * Génère un fond SVG avec des rubans concentriques animés.
 */
function drawBgKinetic() {
  const svg = document.getElementById('bg-svg');
  const colors = ['#1B2789','#375AFE','#8DBAFE','#801211','#DC0203','#FE4502','#025649','#04CF5C','#BAEE06'];
  const W = 1200, H = 800;
  const cx = W / 2, cy = H / 2;
  let paths = '';
  const nRibbons = 18;

  for (let i = 0; i < nRibbons; i++) {
    const r1 = 40 + i * 55;
    const r2 = r1 + 30;
    const col = colors[i % colors.length];
    // Arc complet = cercle SVG simplifié via path
    // On alterne cercles pleins et arcs découpés pour l'effet Op-Art
    if (i % 2 === 0) {
      paths += `<circle cx="${cx}" cy="${cy}" r="${r1}" fill="none" stroke="${col}" stroke-width="${r2 - r1}"/>`;
    } else {
      // Ellipse déformée pour effet ondulatoire
      const rx = r1 * 1.1 + (i % 3) * 20;
      const ry = r1 * 0.9 - (i % 3) * 15;
      paths += `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="${col}" stroke-width="${r2 - r1}" opacity="0.7"/>`;
    }
  }

  // Lignes diagonales style Op-Art
  for (let j = 0; j < 12; j++) {
    const col = colors[(j + 3) % colors.length];
    const x1 = (j * 110) - 100;
    paths += `<line x1="${x1}" y1="0" x2="${x1 + 400}" y2="${H}" stroke="${col}" stroke-width="18" opacity="0.18"/>`;
  }

  svg.innerHTML = paths;
}

// ═══════════════════════════════════════════════════════════
//  3. NAVIGATION PAR ONGLETS
// ═══════════════════════════════════════════════════════════

function initNavigation() {
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const viewId = tab.dataset.view;
      switchView(viewId);
    });
  });
}

function switchView(viewId) {
  // Désactiver tous les onglets et views
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

  // Activer le bon onglet et view
  const tab = document.querySelector(`.nav-tab[data-view="${viewId}"]`);
  if (tab) tab.classList.add('active');
  const view = document.getElementById(`view-${viewId}`);
  if (view) view.classList.add('active');

  // Rendu spécifique à chaque vue
  if (viewId === 'album')      renderAlbumPage();
  if (viewId === 'pays')       renderPaysView();
  if (viewId === 'manquantes') renderListView('manquantes');
  if (viewId === 'doublons')   renderListView('doublons');
  if (viewId === 'stats')      renderStats();
}

// ═══════════════════════════════════════════════════════════
//  4. VUE ALBUM
// ═══════════════════════════════════════════════════════════

function initAlbumView() {
  const select = document.getElementById('album-page-select');
  albumPages.forEach((page, idx) => {
    const opt = document.createElement('option');
    opt.value = idx;
    opt.textContent = page === '/' ? 'Vignettes Bonus' : `Page ${page}`;
    select.appendChild(opt);
  });

  select.addEventListener('change', () => {
    albumPageIndex = parseInt(select.value, 10);
    renderAlbumPage();
  });

  document.getElementById('album-prev').addEventListener('click', () => {
    if (albumPageIndex > 0) { albumPageIndex--; renderAlbumPage(); }
  });

  document.getElementById('album-next').addEventListener('click', () => {
    if (albumPageIndex < albumPages.length - 1) { albumPageIndex++; renderAlbumPage(); }
  });
}

function renderAlbumPage() {
  const page = albumPages[albumPageIndex];
  const pageStickers = stickers.filter(s => s.page === page);

  // Mettre à jour le sélecteur
  const select = document.getElementById('album-page-select');
  select.value = albumPageIndex;

  // Titre
  const title = document.getElementById('album-page-title');
  if (page === '/') {
    title.textContent = '⭐ Vignettes Bonus';
  } else {
    // Trouver la section dominante de la page
    const section = pageStickers[0]?.section || '';
    const code = pageStickers[0]?.code || '';
    title.textContent = `Page ${page} — ${section}${code && code !== 'FWC' && code !== '00' ? ` (${code})` : ''}`;
  }

  // Boutons prev/next
  document.getElementById('album-prev').disabled = albumPageIndex === 0;
  document.getElementById('album-next').disabled = albumPageIndex === albumPages.length - 1;

  // Grille
  renderStickerGrid(document.getElementById('album-grid'), pageStickers);
}

// ═══════════════════════════════════════════════════════════
//  5. VUE PAR PAYS
// ═══════════════════════════════════════════════════════════

function initPaysView() {
  const select = document.getElementById('pays-select');

  // Construire la liste des pays uniques (code → section/nom)
  const codesMap = {}; // code → { label, drapeau }
  stickers.forEach(s => {
    if (!codesMap[s.code]) {
      codesMap[s.code] = { label: s.section || s.code, drapeau: s.drapeau };
    }
  });

  // Trier par label
  const sortedCodes = Object.entries(codesMap).sort((a, b) => a[1].label.localeCompare(b[1].label));

  sortedCodes.forEach(([code, info]) => {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = `${info.label} (${code})`;
    select.appendChild(opt);
  });

  // Sélectionner la première valeur
  if (sortedCodes.length > 0) currentPaysCode = sortedCodes[0][0];
  select.value = currentPaysCode;

  select.addEventListener('change', () => {
    currentPaysCode = select.value;
    renderPaysView();
  });
}

function renderPaysView() {
  const grid = document.getElementById('pays-grid');
  const pageStickers = stickers.filter(s => s.code === currentPaysCode);
  renderStickerGrid(grid, pageStickers);
}

// ═══════════════════════════════════════════════════════════
//  6. RENDU D'UNE GRILLE DE VIGNETTES
// ═══════════════════════════════════════════════════════════

/**
 * Génère les cartes de vignettes dans un conteneur DOM.
 * @param {HTMLElement} container
 * @param {Array} list - tableau de vignettes
 */
function renderStickerGrid(container, list) {
  container.innerHTML = '';
  list.forEach(sticker => {
    container.appendChild(createStickerCard(sticker));
  });
}

/**
 * Crée une carte de vignette interactive.
 */
function createStickerCard(sticker) {
  const state = collectionState[sticker.id] || { status: STATUS.MISSING, count: 0 };
  const isBrillant = sticker.type === 'Brillant';

  const card = document.createElement('div');
  card.className = `sticker-card ${state.status}${isBrillant ? ' brillant' : ''}`;
  card.dataset.id = sticker.id;

  // Image drapeau
  const img = document.createElement('img');
  img.className = 'sticker-flag';
  img.src = sticker.drapeau;
  img.alt = sticker.code;
  img.loading = 'lazy';
  img.onerror = () => { img.style.opacity = '0.3'; };

  // Corps
  const body = document.createElement('div');
  body.className = 'sticker-body';

  const idEl = document.createElement('div');
  idEl.className = 'sticker-id';
  idEl.textContent = sticker.id + (isBrillant ? ' ✦' : '');

  const nomEl = document.createElement('div');
  nomEl.className = 'sticker-nom';
  nomEl.textContent = sticker.nom;

  const metaEl = document.createElement('div');
  metaEl.className = 'sticker-meta';
  metaEl.textContent = `${sticker.section} · ${sticker.type}`;

  // Boutons de statut
  const controls = document.createElement('div');
  controls.className = 'sticker-controls';

  const btnOwned   = makeStatusBtn('✔', 'Possédée',  STATUS.OWNED,     state.status === STATUS.OWNED,    's-owned');
  const btnMissing = makeStatusBtn('✗', 'Manquante', STATUS.MISSING,   state.status === STATUS.MISSING,  's-missing');
  const btnDup     = makeStatusBtn('×2', 'Doublon',  STATUS.DUPLICATE, state.status === STATUS.DUPLICATE,'s-dup');

  [btnOwned, btnMissing, btnDup].forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      setStatus(sticker.id, btn.dataset.status);
      refreshCard(card, sticker);
    });
  });

  controls.append(btnOwned, btnMissing, btnDup);

  // Contrôles doublons (affichés uniquement si status = duplicate)
  const dupControls = document.createElement('div');
  dupControls.className = 'dup-controls';
  dupControls.style.display = state.status === STATUS.DUPLICATE ? 'flex' : 'none';

  const btnMinus = document.createElement('button');
  btnMinus.className = 'dup-btn';
  btnMinus.textContent = '−';
  btnMinus.addEventListener('click', (e) => {
    e.stopPropagation();
    changeDupCount(sticker.id, -1);
    refreshCard(card, sticker);
  });

  const dupCountEl = document.createElement('span');
  dupCountEl.className = 'dup-count';
  dupCountEl.textContent = state.count || 1;

  const btnPlus = document.createElement('button');
  btnPlus.className = 'dup-btn';
  btnPlus.textContent = '+';
  btnPlus.addEventListener('click', (e) => {
    e.stopPropagation();
    changeDupCount(sticker.id, +1);
    refreshCard(card, sticker);
  });

  dupControls.append(btnMinus, dupCountEl, btnPlus);

  body.append(idEl, nomEl, metaEl, controls, dupControls);
  card.append(img, body);
  return card;
}

function makeStatusBtn(label, title, status, isActive, cls) {
  const btn = document.createElement('button');
  btn.className = `status-btn${isActive ? ' ' + cls : ''}`;
  btn.title = title;
  btn.textContent = label;
  btn.dataset.status = status;
  return btn;
}

/**
 * Rafraîchit une carte existante après changement d'état.
 */
function refreshCard(card, sticker) {
  const state = collectionState[sticker.id];
  // Mettre à jour les classes de statut
  card.classList.remove('missing', 'owned', 'duplicate');
  card.classList.add(state.status);

  // Mettre à jour les boutons
  const btns = card.querySelectorAll('.status-btn');
  btns.forEach(btn => {
    btn.classList.remove('s-owned', 's-missing', 's-dup');
    if (btn.dataset.status === state.status) {
      if (state.status === STATUS.OWNED)     btn.classList.add('s-owned');
      if (state.status === STATUS.MISSING)   btn.classList.add('s-missing');
      if (state.status === STATUS.DUPLICATE) btn.classList.add('s-dup');
    }
  });

  // Afficher/masquer les contrôles doublons
  const dupControls = card.querySelector('.dup-controls');
  if (dupControls) {
    dupControls.style.display = state.status === STATUS.DUPLICATE ? 'flex' : 'none';
    const countEl = dupControls.querySelector('.dup-count');
    if (countEl) countEl.textContent = state.count || 1;
  }

  updateGlobalProgress();
}

// ═══════════════════════════════════════════════════════════
//  7. GESTION DE L'ÉTAT
// ═══════════════════════════════════════════════════════════

function setStatus(id, newStatus) {
  if (!collectionState[id]) collectionState[id] = { status: STATUS.MISSING, count: 0 };
  collectionState[id].status = newStatus;
  if (newStatus === STATUS.DUPLICATE && !collectionState[id].count) {
    collectionState[id].count = 1;
  }
  saveToLocalStorage();
}

function changeDupCount(id, delta) {
  if (!collectionState[id]) return;
  const current = collectionState[id].count || 1;
  const next = Math.max(1, current + delta);
  collectionState[id].count = next;
  saveToLocalStorage();
}

function saveToLocalStorage() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(collectionState));
  } catch (e) {
    // localStorage plein ou indisponible : silencieux
  }
}

// ═══════════════════════════════════════════════════════════
//  8. PROGRESS GLOBAL
// ═══════════════════════════════════════════════════════════

function updateGlobalProgress() {
  const total = stickers.length;
  const owned = stickers.filter(s => {
    const st = collectionState[s.id];
    return st && (st.status === STATUS.OWNED || st.status === STATUS.DUPLICATE);
  }).length;

  const pct = total > 0 ? Math.round((owned / total) * 100) : 0;

  document.getElementById('global-progress-bar').style.width = pct + '%';
  document.getElementById('global-progress-label').textContent = `${owned} / ${total} (${pct}%)`;
}

// ═══════════════════════════════════════════════════════════
//  9. VUES MANQUANTES & DOUBLONS
// ═══════════════════════════════════════════════════════════

/**
 * Initialise les selects de filtres pour les vues manquantes et doublons.
 */
function initFilterSelects() {
  // Collecter les valeurs uniques
  const pays    = [...new Set(stickers.map(s => s.section))].sort();
  const sections = [...new Set(stickers.map(s => s.section))].sort();
  const types   = [...new Set(stickers.map(s => s.type))].sort();
  const groupes = [...new Set(stickers.map(s => s.groupe))].sort();

  populateSelect('manq-pays',    pays,    s => s);
  populateSelect('manq-section', sections, s => s);
  populateSelect('manq-type',   types,   s => s);
  populateSelect('manq-groupe', groupes, s => s);

  populateSelect('dbl-pays',    pays,    s => s);
  populateSelect('dbl-section', sections, s => s);
  populateSelect('dbl-type',   types,   s => s);
  populateSelect('dbl-groupe', groupes, s => s);

  // Boutons filtrer
  document.getElementById('manq-apply').addEventListener('click', () => renderListView('manquantes'));
  document.getElementById('dbl-apply').addEventListener('click',  () => renderListView('doublons'));

  // Boutons exporter
  document.getElementById('manq-export').addEventListener('click', () => exportListAsText('manquantes'));
  document.getElementById('dbl-export').addEventListener('click',  () => exportListAsText('doublons'));

  // Boutons copier
  document.getElementById('manq-copy').addEventListener('click', () => {
    copyTextarea('manq-textarea');
  });
  document.getElementById('dbl-copy').addEventListener('click', () => {
    copyTextarea('dbl-textarea');
  });
}

function populateSelect(id, values, labelFn) {
  const sel = document.getElementById(id);
  const defaultOpt = sel.querySelector('option[value=""]');
  sel.innerHTML = '';
  if (defaultOpt) sel.appendChild(defaultOpt.cloneNode(true));
  else {
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = '— Tous —';
    sel.appendChild(empty);
  }
  values.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = labelFn(v);
    sel.appendChild(opt);
  });
}

/**
 * Filtre les vignettes selon le mode ('manquantes' ou 'doublons') et les selects.
 */
function getFilteredList(mode) {
  const prefix = mode === 'manquantes' ? 'manq' : 'dbl';
  const targetStatus = mode === 'manquantes' ? STATUS.MISSING : STATUS.DUPLICATE;

  const fPays    = document.getElementById(`${prefix}-pays`).value;
  const fSection = document.getElementById(`${prefix}-section`).value;
  const fType    = document.getElementById(`${prefix}-type`).value;
  const fGroupe  = document.getElementById(`${prefix}-groupe`).value;

  return stickers.filter(s => {
    const state = collectionState[s.id];
    if (!state || state.status !== targetStatus) return false;
    if (fPays    && s.section !== fPays)    return false;
    if (fSection && s.section !== fSection) return false;
    if (fType    && s.type    !== fType)    return false;
    if (fGroupe  && s.groupe  !== fGroupe)  return false;
    return true;
  });
}

function renderListView(mode) {
  const prefix    = mode === 'manquantes' ? 'manq' : 'dbl';
  const list      = getFilteredList(mode);
  const container = document.getElementById(`${prefix}-list`);
  const countEl   = document.getElementById(`${prefix}-count`);

  container.innerHTML = '';

  if (mode === 'manquantes') {
    countEl.textContent = `${list.length} vignette${list.length > 1 ? 's' : ''} manquante${list.length > 1 ? 's' : ''}`;
  } else {
    const totalDup = list.reduce((acc, s) => acc + (collectionState[s.id]?.count || 1), 0);
    countEl.textContent = `${list.length} vignette${list.length > 1 ? 's' : ''} en doublon (${totalDup} exemplaire${totalDup > 1 ? 's' : ''})`;
  }

  list.forEach(sticker => {
    const state = collectionState[sticker.id] || {};
    const row = document.createElement('div');
    row.className = 'sticker-row';

    const img = document.createElement('img');
    img.className = 'sticker-row-flag';
    img.src = sticker.drapeau;
    img.alt = sticker.code;
    img.loading = 'lazy';
    img.onerror = () => { img.style.opacity = '0.3'; };

    const info = document.createElement('div');
    info.className = 'sticker-row-info';

    const idEl = document.createElement('div');
    idEl.className = 'sticker-row-id';
    idEl.textContent = sticker.id + (sticker.type === 'Brillant' ? ' ✦' : '');

    const nomEl = document.createElement('div');
    nomEl.className = 'sticker-row-nom';
    nomEl.textContent = sticker.nom;

    const metaEl = document.createElement('div');
    metaEl.className = 'sticker-row-meta';
    metaEl.textContent = `${sticker.section} · ${sticker.type} · Groupe ${sticker.groupe}`;

    info.append(idEl, nomEl, metaEl);

    // Badge doublon avec count
    if (mode === 'doublons') {
      const badge = document.createElement('span');
      badge.className = 'sticker-row-badge';
      badge.textContent = `×${state.count || 1}`;
      row.append(img, info, badge);
    } else {
      row.append(img, info);
    }

    container.appendChild(row);
  });

  // Masquer la zone d'export si elle était visible
  document.getElementById(`${prefix}-export-area`).style.display = 'none';
}

/**
 * Génère le texte d'export et l'affiche dans la textarea.
 */
function exportListAsText(mode) {
  const prefix = mode === 'manquantes' ? 'manq' : 'dbl';
  const list = getFilteredList(mode);

  const lines = list.map(s => {
    const state = collectionState[s.id] || {};
    const dupNote = mode === 'doublons' ? ` [×${state.count || 1}]` : '';
    return `${s.id} — ${s.nom} (${s.section}, ${s.type}, Grp ${s.groupe})${dupNote}`;
  });

  const title = mode === 'manquantes'
    ? `=== WANTLIST — ${list.length} vignette(s) manquante(s) ===`
    : `=== DOUBLONS — ${list.length} vignette(s) en doublon ===`;

  const text = [title, '', ...lines].join('\n');

  const textarea = document.getElementById(`${prefix}-textarea`);
  textarea.value = text;
  document.getElementById(`${prefix}-export-area`).style.display = 'flex';
  textarea.focus();
  textarea.select();
}

function copyTextarea(id) {
  const ta = document.getElementById(id);
  ta.select();
  navigator.clipboard.writeText(ta.value).then(() => {
    showToast('Liste copiée dans le presse-papiers !');
  }).catch(() => {
    document.execCommand('copy');
    showToast('Liste copiée !');
  });
}

// ═══════════════════════════════════════════════════════════
//  10. VUE STATS
// ═══════════════════════════════════════════════════════════

function renderStats() {
  const total     = stickers.length;
  const owned     = stickers.filter(s => collectionState[s.id]?.status === STATUS.OWNED).length;
  const duplicate = stickers.filter(s => collectionState[s.id]?.status === STATUS.DUPLICATE).length;
  const missing   = stickers.filter(s => collectionState[s.id]?.status === STATUS.MISSING).length;
  const pct       = total > 0 ? ((owned + duplicate) / total * 100).toFixed(1) : '0.0';
  const totalDups = stickers.reduce((acc, s) => {
    return acc + (collectionState[s.id]?.status === STATUS.DUPLICATE ? (collectionState[s.id].count || 1) : 0);
  }, 0);

  const cardsData = [
    { label: 'Complété',    value: pct + '%',    color: 'var(--c-lime)' },
    { label: 'Possédées',   value: owned,         color: 'var(--c-green)' },
    { label: 'Manquantes',  value: missing,       color: 'var(--c-red)' },
    { label: 'Doublons',    value: duplicate,     color: 'var(--c-orange)' },
    { label: 'Exemplaires', value: totalDups,     color: 'var(--c-orange)' },
    { label: 'Total',       value: total,         color: 'var(--c-skyblue)' },
  ];

  const cardsEl = document.getElementById('stats-cards');
  cardsEl.innerHTML = '';
  cardsData.forEach(({ label, value, color }) => {
    const card = document.createElement('div');
    card.className = 'stat-card';
    card.innerHTML = `
      <div class="stat-card-value" style="color:${color}">${value}</div>
      <div class="stat-card-label">${label}</div>
    `;
    cardsEl.appendChild(card);
  });

  // Complétion par section (on regroupe par "section")
  const sections = {};
  stickers.forEach(s => {
    if (!sections[s.section]) {
      sections[s.section] = { total: 0, collected: 0, drapeau: s.drapeau, code: s.code };
    }
    sections[s.section].total++;
    const st = collectionState[s.id];
    if (st && (st.status === STATUS.OWNED || st.status === STATUS.DUPLICATE)) {
      sections[s.section].collected++;
    }
  });

  // Trier par % complété DESC
  const sortedSections = Object.entries(sections).sort((a, b) => {
    const pa = a[1].collected / a[1].total;
    const pb = b[1].collected / b[1].total;
    return pb - pa;
  });

  const breakdownEl = document.getElementById('stats-breakdown');
  breakdownEl.innerHTML = '';

  sortedSections.forEach(([section, data]) => {
    const pctSection = data.total > 0 ? Math.round((data.collected / data.total) * 100) : 0;
    const row = document.createElement('div');
    row.className = 'stats-row';

    const img = document.createElement('img');
    img.className = 'stats-row-flag';
    img.src = data.drapeau;
    img.alt = data.code;
    img.loading = 'lazy';
    img.onerror = () => { img.style.opacity = '0.3'; };

    row.innerHTML = `
      <div class="stats-row-name">${section}</div>
      <div class="stats-row-track">
        <div class="stats-row-fill" style="width:${pctSection}%"></div>
      </div>
      <div class="stats-row-pct">${pctSection}%</div>
      <div style="font-size:11px;color:var(--c-skyblue);min-width:60px;text-align:right">${data.collected}/${data.total}</div>
    `;
    row.prepend(img);
    breakdownEl.appendChild(row);
  });
}

// ═══════════════════════════════════════════════════════════
//  11. EXPORT / IMPORT JSON
// ═══════════════════════════════════════════════════════════

/**
 * Exporte la collection sous forme de fichier JSON téléchargeable.
 */
function exportCollectionAsJSON() {
  try {
    const json = JSON.stringify(collectionState, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href     = url;
    a.download = 'ma-collection-panini.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('Collection exportée avec succès !');
  } catch (err) {
    showToast('Erreur lors de l\'export : ' + err.message, true);
  }
}

/**
 * Importe une collection depuis un fichier JSON sélectionné par l'utilisateur.
 * @param {File} file
 */
function importCollectionFromJSON(file) {
  if (!file) return;

  // Vérification basique du type
  if (!file.name.endsWith('.json') && file.type !== 'application/json') {
    showToast('Fichier invalide : veuillez sélectionner un fichier .json', true);
    return;
  }

  const reader = new FileReader();

  reader.onload = function(event) {
    try {
      const imported = JSON.parse(event.target.result);

      // Validation minimale : doit être un objet non-null
      if (typeof imported !== 'object' || Array.isArray(imported) || imported === null) {
        throw new Error('Format de fichier non reconnu.');
      }

      // Appliquer la collection importée
      collectionState = imported;

      // S'assurer que les nouvelles vignettes ont un état par défaut
      ensureAllStickersHaveState();

      // Sauvegarder et re-render
      saveToLocalStorage();
      updateGlobalProgress();

      // Re-render la vue courante
      const activeView = document.querySelector('.nav-tab.active')?.dataset.view;
      if (activeView) switchView(activeView);

      showToast('Collection importée avec succès !');
    } catch (err) {
      showToast('Erreur d\'import : ' + err.message + '. Vérifiez le fichier JSON.', true);
    }
  };

  reader.onerror = function() {
    showToast('Erreur lors de la lecture du fichier.', true);
  };

  reader.readAsText(file);
}

function initExportImport() {
  document.getElementById('btn-export').addEventListener('click', exportCollectionAsJSON);

  const fileInput = document.getElementById('file-import');
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      importCollectionFromJSON(file);
      // Réinitialiser l'input pour permettre de re-sélectionner le même fichier
      fileInput.value = '';
    }
  });
}

// ═══════════════════════════════════════════════════════════
//  12. TOAST NOTIFICATION
// ═══════════════════════════════════════════════════════════

let toastTimer = null;

function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.add('show');

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// ═══════════════════════════════════════════════════════════
//  DÉMARRAGE
// ═══════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', init);
