/**
 * app.js – Gestionnaire de collection Panini WC26
 *
 * Structure :
 *   - stickers : tableau des vignettes chargé depuis database.json
 *   - collectionState : { [stickerID]: { status: 'missing'|'owned'|'duplicate', count: number } }
 *   - localStorage : sauvegarde automatique
 *   - export / import JSON
 */
"use strict";

// ============================================================
//  1. ÉTAT GLOBAL
// ============================================================
let stickers = [];
let collectionState = {};

// Éléments DOM
const views = {
  page: document.getElementById('view-page'),
  pays: document.getElementById('view-pays'),
  missing: document.getElementById('view-missing'),
  duplicates: document.getElementById('view-duplicates'),
  stats: document.getElementById('view-stats'),
  trade: document.getElementById('view-trade'),
};

const statusMsg = document.getElementById('statusMsg');
let currentPage = 1;
let stickersPerPage = 24; // ajustable

// Filtres pour manquantes / doublons
let filters = {
  code: 'all',
  section: 'all',
  type: 'all',
  groupe: 'all',
};

// ============================================================
//  2. CHARGEMENT DES DONNÉES
// ============================================================
async function loadData() {
  try {
    const resp = await fetch('database.json');
    if (!resp.ok) throw new Error('Fichier database.json introuvable');
    stickers = await resp.json();
    // Initialiser l'état de collection si vide
    initCollectionState();
    // Restaurer depuis localStorage
    restoreFromLocalStorage();
    // Rendre toutes les vues
    renderAll();
    statusMsg.textContent = '✅ Données chargées avec succès';
  } catch (err) {
    statusMsg.textContent = '❌ Erreur : ' + err.message;
    console.error(err);
  }
}

function initCollectionState() {
  stickers.forEach(s => {
    const id = s.ID;
    if (!collectionState[id]) {
      collectionState[id] = { status: 'missing', count: 0 };
    }
  });
}

// ============================================================
//  3. LOCAL STORAGE
// ============================================================
function saveToLocalStorage() {
  try {
    localStorage.setItem('panini_wc26_state', JSON.stringify(collectionState));
  } catch (e) {
    console.warn('localStorage non disponible', e);
  }
}

function restoreFromLocalStorage() {
  try {
    const saved = localStorage.getItem('panini_wc26_state');
    if (saved) {
      const parsed = JSON.parse(saved);
      // Ne garder que les stickers présents dans le JSON
      const validIds = new Set(stickers.map(s => s.ID));
      for (const [id, val] of Object.entries(parsed)) {
        if (validIds.has(id)) {
          collectionState[id] = val;
        }
      }
      saveToLocalStorage(); // nettoie les clés obsolètes
    }
  } catch (e) {
    console.warn('Erreur lecture localStorage', e);
  }
}

// ============================================================
//  4. EXPORT / IMPORT JSON
// ============================================================
function exportCollection() {
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
  statusMsg.textContent = '✅ Export terminé !';
}

function importCollectionFromFile(file) {
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const imported = JSON.parse(e.target.result);
      // Vérification basique
      if (typeof imported !== 'object' || Array.isArray(imported)) {
        throw new Error('Le fichier doit contenir un objet');
      }
      // Appliquer l'import
      const validIds = new Set(stickers.map(s => s.ID));
      let count = 0;
      for (const [id, val] of Object.entries(imported)) {
        if (validIds.has(id) && val.status && ['missing', 'owned', 'duplicate'].includes(val.status)) {
          collectionState[id] = {
            status: val.status,
            count: typeof val.count === 'number' ? val.count : 0,
          };
          count++;
        }
      }
      saveToLocalStorage();
      renderAll();
      statusMsg.textContent = `✅ Import réussi : ${count} vignettes mises à jour.`;
    } catch (err) {
      statusMsg.textContent = '❌ Erreur lors de l\'import : ' + err.message;
      console.error(err);
    }
  };
  reader.readAsText(file);
}

// Écouteur sur l'input file
document.getElementById('importFile').addEventListener('change', function (e) {
  if (this.files.length > 0) {
    importCollectionFromFile(this.files[0]);
    this.value = ''; // permet de réimporter le même fichier
  }
});

// ============================================================
//  5. GESTION DES STATUTS
// ============================================================
function setStickerStatus(id, status) {
  if (!collectionState[id]) return;
  collectionState[id].status = status;
  if (status !== 'duplicate') {
    collectionState[id].count = 0;
  }
  saveToLocalStorage();
  renderAll();
}

function incrementDuplicate(id) {
  if (!collectionState[id] || collectionState[id].status !== 'duplicate') return;
  collectionState[id].count = (collectionState[id].count || 0) + 1;
  saveToLocalStorage();
  renderAll();
}

function decrementDuplicate(id) {
  if (!collectionState[id] || collectionState[id].status !== 'duplicate') return;
  if (collectionState[id].count > 0) {
    collectionState[id].count--;
  }
  saveToLocalStorage();
  renderAll();
}

// Cycle de statut : missing -> owned -> duplicate -> missing
function cycleStatus(id) {
  const current = collectionState[id]?.status || 'missing';
  let next;
  switch (current) {
    case 'missing':
      next = 'owned';
      break;
    case 'owned':
      next = 'duplicate';
      break;
    case 'duplicate':
      next = 'missing';
      break;
    default:
      next = 'missing';
  }
  setStickerStatus(id, next);
}

// ============================================================
//  6. RENDU DES VUES
// ============================================================
function renderAll() {
  renderPageView();
  renderPaysView();
  renderMissingView();
  renderDuplicatesView();
  renderStatsView();
  renderTradeView();
}

// ---------- 6a. Album par page ----------
function renderPageView() {
  const container = views.page;
  // Pagination
  const totalPages = Math.ceil(stickers.length / stickersPerPage);
  if (currentPage < 1) currentPage = 1;
  if (currentPage > totalPages) currentPage = totalPages;

  const start = (currentPage - 1) * stickersPerPage;
  const pageStickers = stickers.slice(start, start + stickersPerPage);

  let html = `
    <div class="page-header">
      <span class="page-title">Album – Page ${currentPage} / ${totalPages || 1}</span>
      <div class="page-nav">
        <button class="btn" onclick="changePage(-1)" ${currentPage <= 1 ? 'disabled' : ''}>◀</button>
        <button class="btn" onclick="changePage(1)" ${currentPage >= totalPages ? 'disabled' : ''}>▶</button>
      </div>
    </div>
    <div class="sticker-grid">
  `;

  pageStickers.forEach(s => {
    html += stickerCardHTML(s);
  });

  html += `</div>`;
  container.innerHTML = html;
}

function changePage(delta) {
  currentPage += delta;
  renderPageView();
}

// ---------- 6b. Par pays ----------
function renderPaysView() {
  const container = views.pays;
  // Grouper par code pays
  const groups = {};
  stickers.forEach(s => {
    const code = s.Code || '?';
    if (!groups[code]) groups[code] = [];
    groups[code].push(s);
  });

  let html = `<h2 class="page-title">Pays participants</h2>`;
  const sortedCodes = Object.keys(groups).sort();
  sortedCodes.forEach(code => {
    const list = groups[code];
    html += `<div style="margin-top:24px; border-bottom:2px solid var(--panel-mid); padding-bottom:8px;">
      <span style="font-family:var(--font-display); font-size:20px; color:var(--blue-light);">${code}</span>
      <span style="font-family:var(--font-mono); font-size:12px; color:var(--outline); margin-left:8px;">${list.length} vignettes</span>
    </div>
    <div class="sticker-grid" style="margin-top:12px;">`;
    list.forEach(s => {
      html += stickerCardHTML(s);
    });
    html += `</div>`;
  });

  container.innerHTML = html;
}

// ---------- 6c. Manquantes ----------
function renderMissingView() {
  const container = views.missing;
  const filtered = getFilteredStickers('missing');
  const textExport = generateExportText(filtered);

  let html = `
    <h2 class="page-title">Mes manquantes (${filtered.length})</h2>
    <div class="filter-bar">
      ${filterControls()}
    </div>
    <div class="list-export">
      <button class="btn" onclick="copyExportText('missing')">📋 Copier la liste</button>
    </div>
    <textarea class="export-textarea" id="missingExportText" readonly>${textExport}</textarea>
    <div class="sticker-list" style="margin-top:16px;">
  `;

  filtered.forEach(s => {
    html += stickerListItemHTML(s);
  });

  html += `</div>`;
  container.innerHTML = html;
}

// ---------- 6d. Doublons ----------
function renderDuplicatesView() {
  const container = views.duplicates;
  const filtered = getFilteredStickers('duplicate');
  const textExport = generateExportText(filtered);

  let html = `
    <h2 class="page-title">Mes doublons (${filtered.length})</h2>
    <div class="filter-bar">
      ${filterControls()}
    </div>
    <div class="list-export">
      <button class="btn" onclick="copyExportText('duplicate')">📋 Copier la liste</button>
    </div>
    <textarea class="export-textarea" id="duplicateExportText" readonly>${textExport}</textarea>
    <div class="sticker-list" style="margin-top:16px;">
  `;

  filtered.forEach(s => {
    html += stickerListItemHTML(s);
  });

  html += `</div>`;
  container.innerHTML = html;
}

// ---------- 6e. Statistiques ----------
function renderStatsView() {
  const container = views.stats;
  const total = stickers.length;
  let owned = 0,
    missing = 0,
    duplicate = 0,
    totalDuplicates = 0;

  stickers.forEach(s => {
    const state = collectionState[s.ID];
    if (state) {
      if (state.status === 'owned') owned++;
      else if (state.status === 'missing') missing++;
      else if (state.status === 'duplicate') {
        duplicate++;
        totalDuplicates += (state.count || 0);
      }
    } else {
      missing++;
    }
  });

  const pctOwned = total ? Math.round((owned / total) * 100) : 0;

  // Stats par pays
  const byCode = {};
  stickers.forEach(s => {
    const code = s.Code || '?';
    if (!byCode[code]) byCode[code] = { total: 0, owned: 0 };
    byCode[code].total++;
    if (collectionState[s.ID]?.status === 'owned') byCode[code].owned++;
  });

  let html = `
    <h2 class="page-title">Statistiques</h2>
    <div class="stats-grid">
      <div class="stat-card"><div class="number">${owned}</div><div class="label">Possédées</div></div>
      <div class="stat-card"><div class="number">${missing}</div><div class="label">Manquantes</div></div>
      <div class="stat-card"><div class="number">${duplicate}</div><div class="label">Doublons (${totalDuplicates} ex.)</div></div>
      <div class="stat-card"><div class="number">${pctOwned}%</div><div class="label">Complétion</div></div>
    </div>
    <h3 style="font-family:var(--font-display); font-size:18px; color:var(--blue-light); margin: 20px 0 12px;">Par pays</h3>
    <div class="stats-detail">
  `;

  const sortedCodes = Object.keys(byCode).sort();
  sortedCodes.forEach(code => {
    const d = byCode[code];
    const pct = d.total ? Math.round((d.owned / d.total) * 100) : 0;
    html += `<div class="stats-detail-item">
      <span class="label">${code}</span>
      <span class="pct">${d.owned}/${d.total} (${pct}%)</span>
    </div>`;
  });

  html += `</div>`;
  container.innerHTML = html;
}

// ---------- 6f. Échanges ----------
function renderTradeView() {
  const container = views.trade;
  container.innerHTML = `
    <h2 class="page-title">Échanges</h2>
    <div class="trade-box">
      <p style="font-family:var(--font-mono); font-size:12px; color:var(--outline); margin-bottom:8px;">
        Collez ici la liste des <strong>manquantes</strong> de votre correspondant (format texte, ex: "RSA 1,2,3").
      </p>
      <textarea id="tradeInput" placeholder="Ex: FRA 5,12,23&#10;MEX 7,8,9"></textarea>
      <button class="btn" style="margin-top:10px;" onclick="computeTrade()">🔍 Trouver les échanges possibles</button>
    </div>
    <div id="tradeResult" class="trade-result hidden"></div>
  `;
}

function computeTrade() {
  const input = document.getElementById('tradeInput').value.trim();
  const resultDiv = document.getElementById('tradeResult');
  if (!input) {
    resultDiv.innerHTML = '<span style="color:var(--red);">Veuillez coller une liste.</span>';
    resultDiv.classList.remove('hidden');
    return;
  }

  // Parser la liste : on attend des lignes "CODE n1,n2,..."
  const lines = input.split('\n').filter(l => l.trim());
  const wanted = new Map(); // code -> Set de numéros
  lines.forEach(line => {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) return;
    const code = parts[0].toUpperCase();
    const nums = parts.slice(1).join('').split(',').map(n => n.trim()).filter(n => n !== '');
    if (!wanted.has(code)) wanted.set(code, new Set());
    nums.forEach(n => {
      if (n.match(/^\d+$/)) wanted.get(code).add(parseInt(n, 10));
    });
  });

  // Parcourir nos doublons pour trouver les correspondances
  let matches = [];
  stickers.forEach(s => {
    const state = collectionState[s.ID];
    if (!state || state.status !== 'duplicate') return;
    const code = s.Code;
    if (!wanted.has(code)) return;
    const num = s['N°'];
    if (!wanted.get(code).has(num)) return;
    matches.push({ code, num, name: s.Nom, duplicateCount: state.count || 0 });
  });

  if (matches.length === 0) {
    resultDiv.innerHTML = '❌ Aucun échange possible avec cette liste.';
  } else {
    let html = `✅ ${matches.length} échange(s) possible(s) :<ul style="margin-top:8px; list-style:none;">`;
    matches.forEach(m => {
      html += `<li style="padding:4px 0;">• ${m.code} n°${m.num} – ${m.name} (${m.duplicateCount} doublon${m.duplicateCount > 1 ? 's' : ''})</li>`;
    });
    html += '</ul>';
    resultDiv.innerHTML = html;
  }
  resultDiv.classList.remove('hidden');
}

// ============================================================
//  7. FONCTIONS UTILITAIRES
// ============================================================

// Génère le HTML d'une carte sticker
function stickerCardHTML(s) {
  const state = collectionState[s.ID] || { status: 'missing', count: 0 };
  const status = state.status;
  const count = state.count || 0;
  const statusLabel = { missing: 'Manquante', owned: 'Possédée', duplicate: `Doublon${count > 1 ? 's' : ''}` }[status] || 'Manquante';
  const statusClass = status;

  // Gérer les doublons : afficher le compteur
  let dupBadge = '';
  if (status === 'duplicate' && count > 0) {
    dupBadge = ` <span style="background:var(--orange);color:var(--dark);padding:0 6px;border-radius:2px;font-size:10px;font-weight:700;">×${count}</span>`;
  }

  return `
    <div class="sticker-card" onclick="cycleStatus('${s.ID}')" title="Cliquer pour changer le statut (${statusLabel})">
      <img class="flag" src="${s.Drapeau || ''}" alt="${s.Nom}" loading="lazy" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22160%22 height=%2250%22%3E%3Crect width=%22160%22 height=%2250%22 fill=%22%232a2a2a%22/%3E%3Ctext x=%2280%22 y=%2232%22 font-size=%2210%22 fill=%22%237A7A8A%22 text-anchor=%22middle%22 font-family=%22monospace%22%3ENO FLAG%3C/text%3E%3C/svg%3E'" />
      <div class="id">${s.ID}</div>
      <div class="name">${s.Nom}</div>
      <div class="meta">${s.Section || ''} ${s.Type || ''} ${s.Groupe ? '· Groupe '+s.Groupe : ''}</div>
      <div class="status-badge ${statusClass}">${statusLabel}${dupBadge}</div>
    </div>
  `;
}

// Génère le HTML d'un élément de liste (pour manquantes / doublons)
function stickerListItemHTML(s) {
  const state = collectionState[s.ID] || { status: 'missing', count: 0 };
  const count = state.count || 0;
  let extra = '';
  if (state.status === 'duplicate' && count > 0) {
    extra = `<span class="dup-count">×${count}</span>`;
  }
  return `
    <div class="sticker-list-item">
      <img class="flag-sm" src="${s.Drapeau || ''}" alt="" loading="lazy" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2232%22 height=%2222%22%3E%3Crect width=%2232%22 height=%2222%22 fill=%22%232a2a2a%22/%3E%3Ctext x=%2216%22 y=%2215%22 font-size=%228%22 fill=%22%237A7A8A%22 text-anchor=%22middle%22 font-family=%22monospace%22%3E?%3C/text%3E%3C/svg%3E'" />
      <div class="info">
        <span class="id-code">${s.Code || ''} ${s['N°'] || ''}</span>
        <span class="name">${s.Nom}</span>
        <span class="meta">${s.Section || ''} ${s.Type || ''}</span>
      </div>
      ${extra}
      <button class="btn" style="font-size:8px; padding:2px 10px;" onclick="event.stopPropagation(); cycleStatus('${s.ID}')">Changer</button>
    </div>
  `;
}

// Filtres communs
function filterControls() {
  const codes = [...new Set(stickers.map(s => s.Code).filter(Boolean))].sort();
  const sections = [...new Set(stickers.map(s => s.Section).filter(Boolean))].sort();
  const types = [...new Set(stickers.map(s => s.Type).filter(Boolean))].sort();
  const groupes = [...new Set(stickers.map(s => s.Groupe).filter(Boolean))].sort();

  return `
    <div class="filter-group">
      <label>Pays</label>
      <select id="filterCode" onchange="updateFilters()">
        <option value="all">Tous</option>
        ${codes.map(c => `<option value="${c}">${c}</option>`).join('')}
      </select>
    </div>
    <div class="filter-group">
      <label>Section</label>
      <select id="filterSection" onchange="updateFilters()">
        <option value="all">Toutes</option>
        ${sections.map(c => `<option value="${c}">${c}</option>`).join('')}
      </select>
    </div>
    <div class="filter-group">
      <label>Type</label>
      <select id="filterType" onchange="updateFilters()">
        <option value="all">Tous</option>
        ${types.map(c => `<option value="${c}">${c}</option>`).join('')}
      </select>
    </div>
    <div class="filter-group">
      <label>Groupe</label>
      <select id="filterGroupe" onchange="updateFilters()">
        <option value="all">Tous</option>
        ${groupes.map(c => `<option value="${c}">${c}</option>`).join('')}
      </select>
    </div>
  `;
}

function updateFilters() {
  filters.code = document.getElementById('filterCode').value;
  filters.section = document.getElementById('filterSection').value;
  filters.type = document.getElementById('filterType').value;
  filters.groupe = document.getElementById('filterGroupe').value;
  renderMissingView();
  renderDuplicatesView();
}

function getFilteredStickers(statusFilter) {
  return stickers.filter(s => {
    const state = collectionState[s.ID];
    if (!state) return false;
    if (state.status !== statusFilter) return false;
    if (filters.code !== 'all' && s.Code !== filters.code) return false;
    if (filters.section !== 'all' && s.Section !== filters.section) return false;
    if (filters.type !== 'all' && s.Type !== filters.type) return false;
    if (filters.groupe !== 'all' && s.Groupe !== filters.groupe) return false;
    return true;
  });
}

function generateExportText(stickerList) {
  // Grouper par code
  const groups = {};
  stickerList.forEach(s => {
    const code = s.Code || '?';
    if (!groups[code]) groups[code] = [];
    groups[code].push(s['N°']);
  });
  const lines = [];
  Object.keys(groups).sort().forEach(code => {
    const nums = groups[code].sort((a, b) => a - b);
    lines.push(`${code} ${nums.join(',')}`);
  });
  return lines.join('\n');
}

function copyExportText(type) {
  const textarea = document.getElementById(type === 'missing' ? 'missingExportText' : 'duplicateExportText');
  if (!textarea) return;
  navigator.clipboard?.writeText(textarea.value).then(() => {
    statusMsg.textContent = '✅ Liste copiée !';
  }).catch(() => {
    textarea.select();
    document.execCommand('copy');
    statusMsg.textContent = '✅ Liste copiée !';
  });
}

// ============================================================
//  8. NAVIGATION PAR ONGLETS
// ============================================================
function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  Object.keys(views).forEach(key => {
    views[key].classList.toggle('active', key === tabName);
  });
  // Re-render certaines vues si besoin
  if (tabName === 'page') renderPageView();
  if (tabName === 'pays') renderPaysView();
  if (tabName === 'missing') renderMissingView();
  if (tabName === 'duplicates') renderDuplicatesView();
  if (tabName === 'stats') renderStatsView();
  if (tabName === 'trade') renderTradeView();
}

// Écouteurs sur les onglets
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', function () {
    switchTab(this.dataset.tab);
  });
});

// ============================================================
//  9. INITIALISATION
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  loadData();
});

// Exposer certaines fonctions globalement pour les appels HTML
window.changePage = changePage;
window.cycleStatus = cycleStatus;
window.setStickerStatus = setStickerStatus;
window.incrementDuplicate = incrementDuplicate;
window.decrementDuplicate = decrementDuplicate;
window.exportCollection = exportCollection;
window.importCollectionFromFile = importCollectionFromFile;
window.switchTab = switchTab;
window.updateFilters = updateFilters;
window.copyExportText = copyExportText;
window.computeTrade = computeTrade;