/* ═══════════════════════════════════════════════════════════
   PANINI WC2026 — Collection Tracker
   app.js — Logique principale
   ═══════════════════════════════════════════════════════════ */

/* ───────────────────────────────────────────────────────────
   1. ÉTAT GLOBAL
   ─────────────────────────────────────────────────────────── */

/** Données brutes du JSON, chargées au démarrage */
let stickers = [];

/**
 * État de la collection, par ID de vignette.
 * Format : { [stickerID]: { status: 'missing'|'owned'|'duplicate', count: number } }
 * 'missing' = manquante, 'owned' = possédée, 'duplicate' = doublon
 */
let collectionState = {};

/** Page de l'album actuellement affichée (index dans la liste des pages uniques) */
let albumCurrentPageIndex = 0;

/** Liste triée de toutes les pages d'album uniques */
let albumPages = [];

/** ID de la vignette ouverte dans la modal */
let modalCurrentID = null;

/** Vue courante */
let currentTab = 'album';

/* ───────────────────────────────────────────────────────────
   2. INITIALISATION
   ─────────────────────────────────────────────────────────── */

/**
 * Point d'entrée : charge le JSON, restaure depuis localStorage si dispo,
 * puis initialise toutes les vues.
 */
async function init() {
  try {
    const response = await fetch('database.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    stickers = await response.json();
  } catch (err) {
    showToast('Erreur : impossible de charger database.json', 'error');
    console.error(err);
    return;
  }

  // Restaurer l'état depuis localStorage si disponible
  const saved = localStorage.getItem('panini-wc26-collection');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      collectionState = sanitizeCollectionState(parsed);
    } catch (_) {
      collectionState = {};
    }
  }

  // S'assurer que chaque vignette a un état initial
  stickers.forEach(s => {
    if (!collectionState[s.ID]) {
      collectionState[s.ID] = { status: 'missing', count: 0 };
    }
  });

  // Construire la liste de pages et remplir les menus déroulants
  buildAlbumPageList();
  populateSelectFilters();

  // Afficher la première vue
  renderAlbumView();
  updateHeaderProgress();
}

/**
 * Valide et nettoie un objet collectionState importé.
 * Rejette les IDs invalides et normalise les statuts.
 */
function sanitizeCollectionState(obj) {
  if (typeof obj !== 'object' || Array.isArray(obj)) return {};
  const validStatuses = ['missing', 'owned', 'duplicate'];
  const clean = {};
  for (const [id, val] of Object.entries(obj)) {
    if (typeof val !== 'object' || val === null) continue;
    const status = validStatuses.includes(val.status) ? val.status : 'missing';
    const count = (status === 'duplicate' && Number.isInteger(val.count) && val.count > 0)
      ? val.count : (status === 'duplicate' ? 1 : 0);
    clean[id] = { status, count };
  }
  return clean;
}

/* ───────────────────────────────────────────────────────────
   3. PERSISTANCE
   ─────────────────────────────────────────────────────────── */

/** Sauvegarde l'état dans localStorage (cache automatique) */
function saveToLocalStorage() {
  try {
    localStorage.setItem('panini-wc26-collection', JSON.stringify(collectionState));
  } catch (_) { /* quota exceeded, ignorer */ }
}

/**
 * Exporte la collection complète dans un fichier JSON téléchargeable.
 * Encapsulé de façon autonome — ne dépend pas de l'UI.
 */
function exportCollectionAsJSON() {
  const json = JSON.stringify(collectionState, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'ma-collection-panini-wc26.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Collection exportée ✓', 'success');
}

/**
 * Déclenché quand l'utilisateur sélectionne un fichier via l'input.
 * @param {HTMLInputElement} input
 */
function handleImportFile(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  importCollectionFromJSON(file);
  input.value = ''; // reset pour permettre de re-importer le même fichier
}

/**
 * Lit un fichier JSON et remplace la collection courante.
 * @param {File} file
 */
function importCollectionFromJSON(file) {
  if (!file || file.type !== 'application/json' && !file.name.endsWith('.json')) {
    showToast('Fichier invalide — choisissez un .json', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const imported = JSON.parse(e.target.result);
      const clean = sanitizeCollectionState(imported);
      // Fusionner avec les IDs connus (ignorer les IDs inconnus du JSON)
      const knownIDs = new Set(stickers.map(s => s.ID));
      collectionState = {};
      stickers.forEach(s => {
        if (clean[s.ID] && knownIDs.has(s.ID)) {
          collectionState[s.ID] = clean[s.ID];
        } else {
          collectionState[s.ID] = { status: 'missing', count: 0 };
        }
      });
      saveToLocalStorage();
      refreshAllViews();
      showToast('Collection importée ✓', 'success');
    } catch (err) {
      showToast('JSON invalide — fichier corrompu ?', 'error');
      console.error('Import error:', err);
    }
  };
  reader.onerror = function() {
    showToast('Erreur de lecture du fichier', 'error');
  };
  reader.readAsText(file);
}

/* ───────────────────────────────────────────────────────────
   4. HELPERS DONNÉES
   ─────────────────────────────────────────────────────────── */

/** Retourne le statut d'une vignette (défaut : 'missing') */
function getStatus(id) {
  return collectionState[id] ? collectionState[id].status : 'missing';
}

/** Retourne le nombre de doublons (0 si non-doublon) */
function getDuplicateCount(id) {
  const s = collectionState[id];
  return (s && s.status === 'duplicate') ? (s.count || 1) : 0;
}

/** Met à jour le statut d'une vignette et sauvegarde */
function setStatus(id, status, count) {
  collectionState[id] = {
    status,
    count: status === 'duplicate' ? (count || 1) : 0
  };
  saveToLocalStorage();
  updateHeaderProgress();
}

/**
 * Calcule les stats globales.
 * @returns {{ total, owned, missing, duplicateTypes, duplicateTotal, pct }}
 */
function computeStats() {
  let owned = 0, missing = 0, duplicateTypes = 0, duplicateTotal = 0;
  const total = stickers.length;
  stickers.forEach(s => {
    const st = getStatus(s.ID);
    if (st === 'owned')     owned++;
    else if (st === 'missing') missing++;
    else if (st === 'duplicate') {
      duplicateTypes++;
      duplicateTotal += (collectionState[s.ID].count || 1);
    }
  });
  const pct = total > 0 ? Math.round(((owned + duplicateTypes) / total) * 100) : 0;
  return { total, owned, missing, duplicateTypes, duplicateTotal, pct };
}

/**
 * Stats par pays/section.
 * @returns {Array<{code, section, flag, total, ownedCount}>}
 */
function computeCountryStats() {
  // Grouper par Code
  const map = {};
  stickers.forEach(s => {
    if (!map[s.Code]) {
      map[s.Code] = { code: s.Code, section: s.Section, flag: s.Drapeau, total: 0, ownedCount: 0 };
    }
    map[s.Code].total++;
    const st = getStatus(s.ID);
    if (st === 'owned' || st === 'duplicate') map[s.Code].ownedCount++;
  });
  return Object.values(map).sort((a, b) => b.ownedCount / b.total - a.ownedCount / a.total);
}

/** Retourne les vignettes filtrées selon les sélecteurs d'un groupe de filtres */
function getFilteredStickers({ status, pays, section, type, groupe }) {
  return stickers.filter(s => {
    const st = getStatus(s.ID);
    if (status && st !== status) return false;
    if (pays && s.Code !== pays) return false;
    if (section && s.Section !== section) return false;
    if (type && s.Type !== type) return false;
    if (groupe && s.Groupe !== groupe) return false;
    return true;
  });
}

/* ───────────────────────────────────────────────────────────
   5. NAVIGATION (ONGLETS)
   ─────────────────────────────────────────────────────────── */

function switchTab(tabName) {
  currentTab = tabName;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-content').forEach(el => {
    el.classList.toggle('active', el.id === `tab-${tabName}`);
  });

  // Render the relevant view
  if (tabName === 'album')      renderAlbumView();
  if (tabName === 'pays')       renderPaysView();
  if (tabName === 'manquantes') renderMissingView();
  if (tabName === 'doublons')   renderDuplicatesView();
  if (tabName === 'stats')      renderStatsView();
}

/** Rafraîchit toutes les vues (après import ou reset) */
function refreshAllViews() {
  renderAlbumView();
  if (currentTab === 'pays')       renderPaysView();
  if (currentTab === 'manquantes') renderMissingView();
  if (currentTab === 'doublons')   renderDuplicatesView();
  if (currentTab === 'stats')      renderStatsView();
  updateHeaderProgress();
}

/* ───────────────────────────────────────────────────────────
   6. REMPLISSAGE DES FILTRES
   ─────────────────────────────────────────────────────────── */

function buildAlbumPageList() {
  albumPages = [...new Set(stickers.map(s => s['Page (album)']))].sort((a, b) => a - b);
  const sel = document.getElementById('albumPageSelect');
  sel.innerHTML = '';
  // Regrouper les pages par section pour le select
  const pageLabels = {};
  stickers.forEach(s => {
    const p = s['Page (album)'];
    if (!pageLabels[p]) pageLabels[p] = s.Section;
  });
  albumPages.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `${p} — ${pageLabels[p] || ''}`;
    sel.appendChild(opt);
  });
  document.getElementById('albumPageTotal').textContent = `/ ${albumPages.length}`;
}

function populateSelectFilters() {
  const codes    = [...new Set(stickers.map(s => s.Code))].sort();
  const sections = [...new Set(stickers.map(s => s.Section))].sort();
  const groupes  = [...new Set(stickers.map(s => s.Groupe).filter(Boolean))].sort();

  // Pays view
  const paysSelect = document.getElementById('paysSelect');
  paysSelect.innerHTML = '<option value="">— Sélectionner —</option>';
  codes.forEach(code => {
    const section = stickers.find(s => s.Code === code)?.Section || code;
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = `${code} — ${section}`;
    paysSelect.appendChild(opt);
  });

  // Groupe filter for pays view
  const paysGroupeFilter = document.getElementById('paysGroupeFilter');
  paysGroupeFilter.innerHTML = '<option value="">Tous</option>';
  groupes.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g; opt.textContent = `Groupe ${g}`;
    paysGroupeFilter.appendChild(opt);
  });

  // Manquantes filters
  populatePaysFilter('manqPaysFilter', codes);
  populateSectionFilter('manqSectionFilter', sections);
  populateGroupeFilter('manqGroupeFilter', groupes);

  // Doublons filters
  populatePaysFilter('dblPaysFilter', codes);
  populateSectionFilter('dblSectionFilter', sections);
  populateGroupeFilter('dblGroupeFilter', groupes);
}

function populatePaysFilter(id, codes) {
  const el = document.getElementById(id);
  el.innerHTML = '<option value="">Tous</option>';
  codes.forEach(code => {
    const opt = document.createElement('option');
    opt.value = code; opt.textContent = code;
    el.appendChild(opt);
  });
}
function populateSectionFilter(id, sections) {
  const el = document.getElementById(id);
  el.innerHTML = '<option value="">Toutes</option>';
  sections.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s; opt.textContent = s;
    el.appendChild(opt);
  });
}
function populateGroupeFilter(id, groupes) {
  const el = document.getElementById(id);
  el.innerHTML = '<option value="">Tous</option>';
  groupes.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g; opt.textContent = `Groupe ${g}`;
    el.appendChild(opt);
  });
}

/* ───────────────────────────────────────────────────────────
   7. VUE ALBUM
   ─────────────────────────────────────────────────────────── */

function albumGoToPage(index) {
  albumCurrentPageIndex = Math.max(0, Math.min(index, albumPages.length - 1));
  document.getElementById('albumPageSelect').value = albumCurrentPageIndex;
  renderAlbumView();
}
function albumPrevPage() { albumGoToPage(albumCurrentPageIndex - 1); }
function albumNextPage() { albumGoToPage(albumCurrentPageIndex + 1); }

/** Rend la grille de vignettes pour la page courante */
function renderAlbumView() {
  if (!albumPages.length) return;
  const pageNum = albumPages[albumCurrentPageIndex];
  const pageStickers = stickers.filter(s => s['Page (album)'] === pageNum);

  const grid = document.getElementById('albumGrid');
  grid.innerHTML = '';

  pageStickers.forEach(s => {
    grid.appendChild(createStickerCard(s));
  });

  // Mise à jour navigation
  document.getElementById('prevPageBtn').disabled = (albumCurrentPageIndex === 0);
  document.getElementById('nextPageBtn').disabled = (albumCurrentPageIndex === albumPages.length - 1);
}

/** Crée un élément de carte vignette */
function createStickerCard(s) {
  const status = getStatus(s.ID);
  const dblCount = getDuplicateCount(s.ID);

  const card = document.createElement('div');
  card.className = `sticker-card status-${status}`;
  card.setAttribute('data-id', s.ID);
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', `${s.ID} — ${s.Nom}`);
  card.onclick = () => openModal(s.ID);
  card.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') openModal(s.ID); };

  card.innerHTML = `
    <div class="sticker-ribbon"></div>
    <div class="sticker-flag-wrap">
      <img class="sticker-flag" src="${s.Drapeau}" alt="${s.Code}" loading="lazy"
           onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 40 26%22><rect fill=%22%23333%22 width=%2240%22 height=%2226%22/><text x=%2250%%25%22 y=%2255%%25%22 font-size=%228%22 fill=%22%23888%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22>${s.Code}</text></svg>'">
    </div>
    <div class="sticker-info">
      <div class="sticker-id">${s.ID}</div>
      <div class="sticker-name">${s.Nom}</div>
    </div>
    ${status === 'duplicate' ? `<div class="sticker-dbl-badge">${dblCount}</div>` : ''}
    ${status === 'owned' ? `<div class="sticker-owned-mark">✓</div>` : ''}
  `;
  return card;
}

/* ───────────────────────────────────────────────────────────
   8. VUE PAR PAYS
   ─────────────────────────────────────────────────────────── */

function renderPaysView() {
  const code   = document.getElementById('paysSelect').value;
  const groupe = document.getElementById('paysGroupeFilter').value;
  const grid   = document.getElementById('paysGrid');
  grid.innerHTML = '';

  if (!code) {
    // Afficher tous les pays en accordéon
    const codes = [...new Set(stickers
      .filter(s => !groupe || s.Groupe === groupe)
      .map(s => s.Code)
    )].sort();

    if (!codes.length) {
      grid.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🌍</div>Aucun pays trouvé.</div>`;
      return;
    }

    codes.forEach(c => {
      const countryStickers = stickers.filter(s => s.Code === c && (!groupe || s.Groupe === groupe));
      grid.appendChild(createCountryAccordion(c, countryStickers));
    });
  } else {
    // Afficher les vignettes du pays sélectionné
    const filtered = stickers.filter(s => s.Code === code && (!groupe || s.Groupe === groupe));
    if (!filtered.length) {
      grid.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🔎</div>Aucune vignette trouvée.</div>`;
      return;
    }
    // Entête avec drapeau + progression
    const representative = filtered[0];
    const ownedCount = filtered.filter(s => getStatus(s.ID) !== 'missing').length;
    const pct = Math.round((ownedCount / filtered.length) * 100);

    const hdr = document.createElement('div');
    hdr.className = 'country-section-hdr open';
    hdr.style.cursor = 'default';
    hdr.innerHTML = `
      <img class="csec-flag" src="${representative.Drapeau}" alt="${code}">
      <span class="csec-name">${representative.Section}</span>
      <span class="csec-code">${code}</span>
      <div class="csec-progress">
        <div class="csec-bar-track"><div class="csec-bar-fill" style="width:${pct}%"></div></div>
        <span class="csec-pct">${pct}%</span>
      </div>
    `;
    grid.appendChild(hdr);

    filtered.forEach(s => grid.appendChild(createStickerRow(s)));
  }
}

/** Crée un accordéon de pays avec ses vignettes */
function createCountryAccordion(code, stickerList) {
  const rep = stickerList[0];
  const ownedCount = stickerList.filter(s => getStatus(s.ID) !== 'missing').length;
  const pct = Math.round((ownedCount / stickerList.length) * 100);

  const wrapper = document.createElement('div');

  const hdr = document.createElement('div');
  hdr.className = 'country-section-hdr';
  hdr.innerHTML = `
    <img class="csec-flag" src="${rep.Drapeau}" alt="${code}">
    <span class="csec-name">${rep.Section}</span>
    <span class="csec-code">${code}</span>
    <div class="csec-progress">
      <div class="csec-bar-track"><div class="csec-bar-fill" style="width:${pct}%"></div></div>
      <span class="csec-pct">${pct}%</span>
    </div>
    <span class="csec-chevron">▼</span>
  `;

  const panel = document.createElement('div');
  panel.className = 'country-stickers-panel';

  stickerList.forEach(s => panel.appendChild(createStickerRow(s)));

  hdr.onclick = () => {
    hdr.classList.toggle('open');
    panel.classList.toggle('open');
  };

  wrapper.appendChild(hdr);
  wrapper.appendChild(panel);
  return wrapper;
}

/** Crée une ligne de vignette (vue liste) */
function createStickerRow(s) {
  const status   = getStatus(s.ID);
  const dblCount = getDuplicateCount(s.ID);

  const badgeLabel = { missing: 'Manquante', owned: 'Possédée', duplicate: `×${dblCount} Doublon` };
  const badgeClass = { missing: 'badge-missing', owned: 'badge-owned', duplicate: 'badge-duplicate' };

  const row = document.createElement('div');
  row.className = `sticker-row status-${status}`;
  row.setAttribute('data-id', s.ID);
  row.setAttribute('role', 'button');
  row.setAttribute('tabindex', '0');
  row.onclick = () => openModal(s.ID);
  row.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') openModal(s.ID); };

  row.innerHTML = `
    <img class="row-flag" src="${s.Drapeau}" alt="${s.Code}" loading="lazy"
         onerror="this.style.display='none'">
    <span class="row-id">${s.ID}</span>
    <span class="row-name">${s.Nom}</span>
    <span class="row-meta">
      <span>${s.Type}</span>
      ${s.Groupe ? `<span>Gr.${s.Groupe}</span>` : ''}
    </span>
    <span class="row-status-badge ${badgeClass[status]}">${badgeLabel[status]}</span>
  `;
  return row;
}

/* ───────────────────────────────────────────────────────────
   9. VUE MANQUANTES
   ─────────────────────────────────────────────────────────── */

function renderMissingView() {
  const pays    = document.getElementById('manqPaysFilter').value;
  const section = document.getElementById('manqSectionFilter').value;
  const type    = document.getElementById('manqTypeFilter').value;
  const groupe  = document.getElementById('manqGroupeFilter').value;

  const filtered = getFilteredStickers({ status: 'missing', pays, section, type, groupe });
  const grid = document.getElementById('manqGrid');
  const countEl = document.getElementById('manqCount');
  grid.innerHTML = '';

  countEl.textContent = `${filtered.length} vignette(s) manquante(s)`;

  if (!filtered.length) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🎉</div>Aucune vignette manquante !<br>Collection complète (sur ces filtres).</div>`;
    return;
  }
  filtered.forEach(s => grid.appendChild(createStickerRow(s)));
}

/** Génère le texte de la wantlist et l'affiche dans le textarea */
function exportMissingAsText() {
  const pays    = document.getElementById('manqPaysFilter').value;
  const section = document.getElementById('manqSectionFilter').value;
  const type    = document.getElementById('manqTypeFilter').value;
  const groupe  = document.getElementById('manqGroupeFilter').value;

  const filtered = getFilteredStickers({ status: 'missing', pays, section, type, groupe });
  const text = buildExportText(filtered);

  const ta = document.getElementById('manqExportText');
  ta.style.display = 'block';
  ta.value = text;
  ta.select();
  navigator.clipboard.writeText(text).then(() => showToast('Copié dans le presse-papier ✓', 'success')).catch(() => {});
}

/* ───────────────────────────────────────────────────────────
   10. VUE DOUBLONS
   ─────────────────────────────────────────────────────────── */

function renderDuplicatesView() {
  const pays    = document.getElementById('dblPaysFilter').value;
  const section = document.getElementById('dblSectionFilter').value;
  const type    = document.getElementById('dblTypeFilter').value;
  const groupe  = document.getElementById('dblGroupeFilter').value;

  const filtered = getFilteredStickers({ status: 'duplicate', pays, section, type, groupe });
  const grid = document.getElementById('dblGrid');
  const countEl = document.getElementById('dblCount');
  grid.innerHTML = '';

  countEl.textContent = `${filtered.length} type(s) en doublon`;

  if (!filtered.length) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-state-icon">✌️</div>Aucun doublon pour ces filtres.</div>`;
    return;
  }
  filtered.forEach(s => grid.appendChild(createStickerRow(s)));
}

function exportDuplicatesAsText() {
  const pays    = document.getElementById('dblPaysFilter').value;
  const section = document.getElementById('dblSectionFilter').value;
  const type    = document.getElementById('dblTypeFilter').value;
  const groupe  = document.getElementById('dblGroupeFilter').value;

  const filtered = getFilteredStickers({ status: 'duplicate', pays, section, type, groupe });
  const text = buildExportText(filtered);

  const ta = document.getElementById('dblExportText');
  ta.style.display = 'block';
  ta.value = text;
  ta.select();
  navigator.clipboard.writeText(text).then(() => showToast('Copié dans le presse-papier ✓', 'success')).catch(() => {});
}

/**
 * Construit le texte d'export au format "CODE N°,N°,N°"
 * Exemple : RSA 1,2,3,4,5
 * @param {Array} stickerList
 * @returns {string}
 */
function buildExportText(stickerList) {
  // Grouper par Code
  const groups = {};
  stickerList.forEach(s => {
    if (!groups[s.Code]) groups[s.Code] = [];
    groups[s.Code].push(s['N°']);
  });
  return Object.entries(groups)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, nums]) => `${code} ${nums.join(',')}`)
    .join('\n');
}

/* ───────────────────────────────────────────────────────────
   11. VUE STATS
   ─────────────────────────────────────────────────────────── */

function renderStatsView() {
  const { total, owned, missing, duplicateTypes, duplicateTotal, pct } = computeStats();

  document.getElementById('statPct').textContent    = `${pct}%`;
  document.getElementById('statOwned').textContent  = `${owned + duplicateTypes} / ${total} vignettes`;
  document.getElementById('statBarOwned').style.width = `${pct}%`;
  document.getElementById('statOwnedCount').textContent    = owned;
  document.getElementById('statMissingCount').textContent  = missing;
  document.getElementById('statDuplicateCount').textContent = duplicateTypes;
  document.getElementById('statDuplicateTotal').textContent = `(${duplicateTotal} en tout)`;

  // Stats par pays
  const countryStats = computeCountryStats();
  const el = document.getElementById('statsCountry');
  el.innerHTML = '';
  countryStats.forEach(cs => {
    const pctC = cs.total > 0 ? Math.round((cs.ownedCount / cs.total) * 100) : 0;
    const row = document.createElement('div');
    row.className = 'stat-country-row';
    row.innerHTML = `
      <img class="stat-country-flag" src="${cs.flag}" alt="${cs.code}" loading="lazy">
      <span class="stat-country-name">${cs.section}</span>
      <div class="stat-country-bar-track">
        <div class="stat-country-bar-fill" style="width:${pctC}%"></div>
      </div>
      <span class="stat-country-pct">${pctC}%</span>
      <span class="stat-country-detail">${cs.ownedCount}/${cs.total}</span>
    `;
    el.appendChild(row);
  });
}

/* ───────────────────────────────────────────────────────────
   12. VUE ÉCHANGES
   ─────────────────────────────────────────────────────────── */

/**
 * Parse une liste texte au format "CODE N°,N°,N°" en Map<code, Set<num>>
 */
function parseExchangeText(text) {
  const map = new Map();
  const lines = text.trim().split('\n').filter(l => l.trim());
  lines.forEach(line => {
    const match = line.trim().match(/^([A-Z0-9]+)\s+(.+)$/);
    if (!match) return;
    const code = match[1];
    const nums = match[2].split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
    if (!map.has(code)) map.set(code, new Set());
    nums.forEach(n => map.get(code).add(n));
  });
  return map;
}

/** Calcule les échanges possibles */
function computeExchange() {
  const friendMissingText = document.getElementById('friendMissing').value;
  const friendDupText     = document.getElementById('friendDuplicates').value;

  const friendMissing    = parseExchangeText(friendMissingText);
  const friendDuplicates = parseExchangeText(friendDupText);

  // Ce que je peux donner : mes doublons que l'ami cherche
  const myDuplicates = stickers.filter(s => getStatus(s.ID) === 'duplicate');
  const iCanGive = myDuplicates.filter(s => {
    const set = friendMissing.get(s.Code);
    return set && set.has(s['N°']);
  });

  // Ce que l'ami peut me donner : ses doublons que je cherche (mes manquantes)
  const myMissing = stickers.filter(s => getStatus(s.ID) === 'missing');
  const iReceive = myMissing.filter(s => {
    const set = friendDuplicates.get(s.Code);
    return set && set.has(s['N°']);
  });

  // Afficher
  const giveEl    = document.getElementById('exchangeGive');
  const receiveEl = document.getElementById('exchangeReceive');

  if (!iCanGive.length) {
    giveEl.innerHTML = '<p class="exchange-empty">Aucun échange possible dans ce sens (tes doublons ne correspondent pas à ses manquantes).</p>';
  } else {
    giveEl.textContent = buildExportText(iCanGive);
  }

  if (!iReceive.length) {
    receiveEl.innerHTML = '<p class="exchange-empty">Aucun échange possible dans ce sens (ses doublons ne correspondent pas à tes manquantes).</p>';
  } else {
    receiveEl.textContent = buildExportText(iReceive);
  }

  showToast('Échanges calculés ✓', 'success');
}

/** Copie le contenu d'un div de résultat dans le presse-papier */
function copyExchangeResult(containerId) {
  const el = document.getElementById(containerId);
  const text = el.textContent.trim();
  if (!text || el.querySelector('.exchange-empty')) {
    showToast('Rien à copier', 'error');
    return;
  }
  navigator.clipboard.writeText(text)
    .then(() => showToast('Copié ✓', 'success'))
    .catch(() => showToast('Copie échouée', 'error'));
}

/* ───────────────────────────────────────────────────────────
   13. MODAL DE STATUT
   ─────────────────────────────────────────────────────────── */

function openModal(id) {
  const s = stickers.find(st => st.ID === id);
  if (!s) return;
  modalCurrentID = id;

  document.getElementById('modalFlag').src = s.Drapeau;
  document.getElementById('modalFlag').alt = s.Code;
  document.getElementById('modalId').textContent  = s.ID;
  document.getElementById('modalTitle').textContent = s.Nom;
  document.getElementById('modalMeta').innerHTML = `
    Section : ${s.Section}<br>
    Type : ${s.Type}${s.Groupe ? ` • Groupe ${s.Groupe}` : ''}<br>
    Page album : ${s['Page (album)']}
  `;

  const status = getStatus(id);
  updateModalStatusUI(status);

  const dbl = getDuplicateCount(id);
  document.getElementById('modalDuplicateCount').textContent = dbl || 1;

  const overlay = document.getElementById('stickerModal');
  overlay.classList.add('open');
  overlay.querySelector('.modal-box').focus && overlay.querySelector('.modal-close').focus();
}

function closeModal(event) {
  if (event.target === event.currentTarget) closeModalDirect();
}
function closeModalDirect() {
  document.getElementById('stickerModal').classList.remove('open');
  modalCurrentID = null;
}

function setModalStatus(status) {
  if (!modalCurrentID) return;
  const countEl = document.getElementById('modalDuplicateCount');
  const count = parseInt(countEl.textContent) || 1;
  setStatus(modalCurrentID, status, count);
  updateModalStatusUI(status);
  // Rafraîchir la carte dans la vue album si visible
  refreshStickerCard(modalCurrentID);
  // Rafraîchir les rows dans les autres vues
  refreshStickerRow(modalCurrentID);
}

function updateModalStatusUI(status) {
  document.getElementById('modalBtnMissing').classList.toggle('active',   status === 'missing');
  document.getElementById('modalBtnOwned').classList.toggle('active',     status === 'owned');
  document.getElementById('modalBtnDuplicate').classList.toggle('active', status === 'duplicate');

  const ctrl = document.getElementById('modalDuplicateCtrl');
  ctrl.classList.toggle('visible', status === 'duplicate');
}

function changeDuplicateCount(delta) {
  if (!modalCurrentID) return;
  const countEl = document.getElementById('modalDuplicateCount');
  const current = parseInt(countEl.textContent) || 1;
  const next = Math.max(1, current + delta);
  countEl.textContent = next;
  // Appliquer immédiatement si statut = duplicate
  if (getStatus(modalCurrentID) === 'duplicate') {
    setStatus(modalCurrentID, 'duplicate', next);
    refreshStickerCard(modalCurrentID);
    refreshStickerRow(modalCurrentID);
  }
}

/** Met à jour une carte dans la grille album sans tout re-rendre */
function refreshStickerCard(id) {
  const existing = document.querySelector(`.sticker-card[data-id="${id}"]`);
  if (!existing) return;
  const s = stickers.find(st => st.ID === id);
  if (!s) return;
  const newCard = createStickerCard(s);
  existing.parentNode.replaceChild(newCard, existing);
}

/** Met à jour une row de liste sans tout re-rendre */
function refreshStickerRow(id) {
  const rows = document.querySelectorAll(`.sticker-row[data-id="${id}"]`);
  if (!rows.length) return;
  const s = stickers.find(st => st.ID === id);
  if (!s) return;
  const newRow = createStickerRow(s);
  rows.forEach(row => row.parentNode.replaceChild(newRow.cloneNode(true), row));
  // Re-attacher les handlers (cloneNode les perd)
  document.querySelectorAll(`.sticker-row[data-id="${id}"]`).forEach(row => {
    row.onclick = () => openModal(id);
    row.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') openModal(id); };
  });
}

/* ───────────────────────────────────────────────────────────
   14. HEADER PROGRESS
   ─────────────────────────────────────────────────────────── */

function updateHeaderProgress() {
  const { total, owned, duplicateTypes, pct } = computeStats();
  const collected = owned + duplicateTypes;
  document.getElementById('headerProgressLabel').textContent = `${collected} / ${total}`;
  document.getElementById('headerProgressFill').style.width  = `${pct}%`;
  document.getElementById('headerProgressPct').textContent   = `${pct}%`;
}

/* ───────────────────────────────────────────────────────────
   15. TOAST
   ─────────────────────────────────────────────────────────── */

let toastTimer = null;

/**
 * Affiche une notification temporaire.
 * @param {string} message
 * @param {'default'|'success'|'error'} type
 */
function showToast(message, type = 'default') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast show' + (type !== 'default' ? ` toast-${type}` : '');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 2500);
}

/* ───────────────────────────────────────────────────────────
   16. KEYBOARD SHORTCUTS
   ─────────────────────────────────────────────────────────── */

document.addEventListener('keydown', (e) => {
  // Fermer la modal avec Escape
  if (e.key === 'Escape') {
    const modal = document.getElementById('stickerModal');
    if (modal.classList.contains('open')) closeModalDirect();
  }
  // Naviguer entre les pages de l'album avec les flèches (si pas dans un input)
  if (document.activeElement.tagName === 'INPUT' ||
      document.activeElement.tagName === 'TEXTAREA' ||
      document.activeElement.tagName === 'SELECT') return;
  if (currentTab === 'album') {
    if (e.key === 'ArrowLeft')  albumPrevPage();
    if (e.key === 'ArrowRight') albumNextPage();
  }
});

/* ───────────────────────────────────────────────────────────
   17. DÉMARRAGE
   ─────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', init);
