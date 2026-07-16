/**
 * ═══════════════════════════════════════════════════════════════
 * PANINI WC 2026 — APPLICATION JAVASCRIPT COMPLÈTE
 * Logique métier, gestion d'état, rendu des vues, import/export
 * ═══════════════════════════════════════════════════════════════
 *
 * Architecture :
 *  - État global : `stickers` (données brutes) + `collectionState` (état utilisateur)
 *  - Navigation par vues (album, manquantes, doublons, stats, échanges)
 *  - Chaque vue est rendue à la demande (lazy rendering)
 *  - Persistance locale via localStorage (cache) + import/export fichier JSON
 */

'use strict';

/* ═══════════════════════════════════════════════════════════════
   1. CONFIGURATION GLOBALE
   ═══════════════════════════════════════════════════════════════ */

/** URL du fichier database.json — remplace par l'URL GitHub Pages en prod */
const DATABASE_URL = 'database.json';

/** Clé de stockage localStorage pour la collection */
const LS_KEY = 'panini_wc2026_collection';

/**
 * Vues dans lesquelles la barre de recherche est présente et où le filtre
 * de recherche doit s'appliquer (Statistiques et Échanges n'ont pas de
 * barre de recherche : la recherche n'y a aucun effet).
 */
const SEARCHABLE_VIEWS = ['album', 'manquantes', 'doublons'];

/* ═══════════════════════════════════════════════════════════════
   2. ÉTAT GLOBAL DE L'APPLICATION
   ═══════════════════════════════════════════════════════════════ */

/** Données brutes chargées depuis database.json */
let stickers = [];

/**
 * État utilisateur de la collection.
 * Structure : { [stickerID]: { status: 'owned'|'missing'|'duplicate', count: number } }
 */
let collectionState = {};

/** Vue actuellement affichée */
let currentView = 'album';

/** Page d'album actuellement affichée (index dans la liste des pages triées) */
let currentAlbumPageIndex = 0;

/** Liste triée des numéros de pages uniques */
let albumPages = [];

/** ID de la vignette actuellement ouverte dans la modale */
let modalStickerID = null;

/** Terme de recherche global actuel */
let searchQuery = '';

/** État actif de la recherche (vrai si filtre actif) */
let searchActive = false;

/** Toast anti-spam : compteur et timer */
let toastBatchCount = 0;
let toastBatchTimer = null;
let toastBatchMessage = '';

/* ═══════════════════════════════════════════════════════════════
   3. INITIALISATION AU CHARGEMENT
   ═══════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', async () => {
  // Affichage du spinner pendant le chargement
  showLoadingSpinner();

  try {
    // Chargement des données
    await loadDatabase();

    // Chargement de la collection depuis localStorage (cache auto)
    loadCollectionFromLocalStorage();

    // Construction de l'interface
    initNavigation();
    initAlbumPageSelect();
    initFilters();
    initExportImport();
    initModal();
    initGlobalSearch();
    initBoosterModal();
    initMatchmaker();

    // Place la barre de recherche dans la vue actuellement affichée
    moveSearchBarToView(currentView);

    // Rendu initial de la vue album
    renderCurrentView();
    updateGlobalProgress();

  } catch (err) {
    console.error('Erreur au démarrage :', err);
    showToast('Impossible de charger la base de données.', 4000);
    hideLoadingSpinner();
  }
});

/* ═══════════════════════════════════════════════════════════════
   4. CHARGEMENT DES DONNÉES
   ═══════════════════════════════════════════════════════════════ */

/**
 * Charge le fichier database.json et initialise la liste des pages.
 */
async function loadDatabase() {
  const response = await fetch(DATABASE_URL);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  stickers = await response.json();

  // Extraction des pages uniques, triées numériquement
  const pagesSet = new Set(stickers.map(s => s['Page']));
  albumPages = Array.from(pagesSet).sort((a, b) => a - b);

  // Initialisation de collectionState : toutes les vignettes en "missing" par défaut
  stickers.forEach(s => {
    if (!collectionState[s.ID]) {
      collectionState[s.ID] = { status: 'missing', count: 0 };
    }
  });

  hideLoadingSpinner();
}

/* ═══════════════════════════════════════════════════════════════
   5. GESTION DE L'ÉTAT DE LA COLLECTION
   ═══════════════════════════════════════════════════════════════ */

/**
 * Retourne le statut d'une vignette ('missing' par défaut).
 * @param {string} id - ID de la vignette
 */
function getStatus(id) {
  return collectionState[id]?.status || 'missing';
}

/**
 * Retourne le nombre de doublons d'une vignette.
 * @param {string} id - ID de la vignette
 */
function getDupCount(id) {
  return collectionState[id]?.count || 2;
}

/**
 * Met à jour le statut d'une vignette et sauvegarde dans localStorage.
 * @param {string} id - ID de la vignette
 * @param {string} status - 'missing' | 'owned' | 'duplicate'
 * @param {number} [count] - Nombre de doublons (si status === 'duplicate')
 */
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

/* ═══════════════════════════════════════════════════════════════
   6. PERSISTANCE : LOCALSTORAGE (cache automatique)
   ═══════════════════════════════════════════════════════════════ */

/** Sauvegarde l'état courant dans localStorage. */
function saveCollectionToLocalStorage() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(collectionState));
  } catch (e) {
    console.warn('Impossible de sauvegarder dans localStorage :', e);
  }
}

/** Charge l'état depuis localStorage s'il existe. */
function loadCollectionFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw);
    // Vérification minimale : doit être un objet
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Format invalide');
    }

    // Fusion avec l'état par défaut (les nouvelles vignettes restent "missing")
    Object.keys(parsed).forEach(id => {
      if (collectionState[id] !== undefined) {
        collectionState[id] = parsed[id];
      }
    });
  } catch (e) {
    console.warn('Données localStorage corrompues, réinitialisation :', e);
  }
}

/* ═══════════════════════════════════════════════════════════════
   7. PERSISTANCE : EXPORT / IMPORT FICHIER JSON
   ═══════════════════════════════════════════════════════════════ */

/**
 * Déclenche le téléchargement d'un objet sérialisé en JSON.
 * @param {Object} data - Objet à sérialiser (format collectionState)
 * @param {string} filename - Nom du fichier téléchargé
 */
function downloadJSONFile(data, filename) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);
}

/**
 * Exporte la collection en tant que fichier JSON téléchargeable.
 * Sérialise collectionState via JSON.stringify, crée un Blob et déclenche le téléchargement.
 */
function exportCollectionAsJSON() {
  try {
    downloadJSONFile(collectionState, 'ma-collection-wc2026.json');
    showToast('Collection exportée avec succès.');
  } catch (e) {
    console.error('Erreur lors de l\'export :', e);
    showToast('Erreur lors de l\'export.');
  }
}

/**
 * Importe une collection depuis un fichier JSON sélectionné par l'utilisateur.
 * Utilise FileReader, vérifie la structure, puis écrase collectionState.
 * @param {File} file - Fichier .json sélectionné
 */
function importCollectionFromJSON(file) {
  if (!file) return;

  const reader = new FileReader();

  reader.onload = (event) => {
    try {
      const parsed = JSON.parse(event.target.result);

      // Vérification minimale de structure
      if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Le fichier ne contient pas un objet JSON valide.');
      }

      // Vérification que les clés correspondent à des IDs de stickers connus
      const knownIDs = new Set(stickers.map(s => s.ID));
      const importedKeys = Object.keys(parsed);
      const validKeys = importedKeys.filter(k => knownIDs.has(k));

      if (validKeys.length === 0) {
        throw new Error('Aucun sticker reconnu dans ce fichier.');
      }

      // Réinitialisation vers "missing" pour tous
      stickers.forEach(s => {
        collectionState[s.ID] = { status: 'missing', count: 0 };
      });

      // Application des données importées (uniquement les IDs connus)
      validKeys.forEach(id => {
        const entry = parsed[id];
        if (entry && typeof entry.status === 'string') {
          collectionState[id] = {
            status: ['owned', 'missing', 'duplicate'].includes(entry.status) ? entry.status : 'missing',
            count: typeof entry.count === 'number' ? entry.count : 0,
          };
        }
      });

      // Sauvegarde dans localStorage
      saveCollectionToLocalStorage();

      // Re-rendu complet
      renderCurrentView();
      updateGlobalProgress();

      showToast(`Collection importée (${validKeys.length} vignettes chargées).`);
    } catch (e) {
      console.error('Erreur lors de l\'import :', e);
      showToast(`Erreur d'import : ${e.message}`);
    }
  };

  reader.onerror = () => {
    showToast('Impossible de lire le fichier.');
  };

  reader.readAsText(file);
}

/* ═══════════════════════════════════════════════════════════════
   8. NAVIGATION ENTRE LES VUES
   ═══════════════════════════════════════════════════════════════ */

/**
 * Initialise les boutons de navigation (desktop + mobile).
 */
function initNavigation() {
  // Tous les boutons nav (desktop et mobile)
  const navBtns = document.querySelectorAll('[data-view]');

  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      switchView(view);
    });
  });
}

/**
 * Bascule vers une vue donnée.
 * @param {string} viewName - Identifiant de la vue
 */
function switchView(viewName) {
  currentView = viewName;

  // Mise à jour des boutons actifs
  document.querySelectorAll('[data-view]').forEach(btn => {
    const isActive = btn.dataset.view === viewName;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });

  // Affichage / masquage des sections
  document.querySelectorAll('.view').forEach(view => {
    view.classList.toggle('hidden', view.id !== `view-${viewName}`);
  });

  // La barre de recherche vit désormais dans les vues elles-mêmes (et non
  // plus dans le header) : on la déplace vers la vue qui vient de s'afficher.
  moveSearchBarToView(viewName);

  // Rendu de la vue (avec filtre de recherche uniquement sur les vues qui
  // possèdent une barre de recherche — Statistiques et Échanges s'affichent
  // toujours normalement)
  if (searchActive && SEARCHABLE_VIEWS.includes(viewName)) {
    applySearchFilter();
  } else {
    renderCurrentView();
  }
}

/**
 * Déclenche le rendu de la vue courante.
 */
function renderCurrentView() {
  switch (currentView) {
    case 'album':      renderAlbumView();      break;
    case 'manquantes': renderManquantesView();  break;
    case 'doublons':   renderDoublonsView();    break;
    case 'stats':      renderStatsView();       break;
    case 'echanges':   /* rien à rendre d'emblée */ break;
    default: break;
  }
}

/* ═══════════════════════════════════════════════════════════════
   9. VUE ALBUM
   ═══════════════════════════════════════════════════════════════ */

/**
 * Initialise le sélecteur de page d'album.
 */
function initAlbumPageSelect() {
  const select = document.getElementById('albumPageSelect');
  select.innerHTML = '';

  albumPages.forEach((page, idx) => {
    // On construit le label à partir des stickers de cette page
    const pageStickers = stickers.filter(s => s['Page'] === page);
    const section = pageStickers[0]?.Section || `Page ${page}`;
    const opt = document.createElement('option');
    opt.value = idx;
    opt.textContent = `{section}`;
    select.appendChild(opt);
  });

  select.addEventListener('change', () => {
    currentAlbumPageIndex = parseInt(select.value, 10);
    renderAlbumView();
  });

  // Boutons précédent / suivant
  document.getElementById('btnPagePrev').addEventListener('click', () => {
    if (currentAlbumPageIndex > 0) {
      currentAlbumPageIndex--;
      renderAlbumView();
    }
  });

  document.getElementById('btnPageNext').addEventListener('click', () => {
    if (currentAlbumPageIndex < albumPages.length - 1) {
      currentAlbumPageIndex++;
      renderAlbumView();
    }
  });

  // Mise à jour du total affiché : l'album physique compte 106 pages,
  // même si seules certaines d'entre elles contiennent des vignettes
  // recensées dans la base (la navigation, elle, ne porte que sur ces
  // dernières — cf. albumPages ci-dessus).
  document.getElementById('albumPageTotal').textContent = 106;
}

/**
 * Rend la vue album pour la page courante.
 */
function renderAlbumView() {
  const pageNum = albumPages[currentAlbumPageIndex];
  const pageStickers = stickers.filter(s => s['Page'] === pageNum);

  // Mise à jour de l'indicateur de page
  document.getElementById('albumPageCurrent').textContent = pageNum;
  document.getElementById('albumPageSelect').value = currentAlbumPageIndex;

  // Boutons prev/next
  document.getElementById('btnPagePrev').disabled = currentAlbumPageIndex === 0;
  document.getElementById('btnPageNext').disabled = currentAlbumPageIndex === albumPages.length - 1;

  // En-tête de section
  renderAlbumSectionHeader(pageStickers);

  // Grille de vignettes — DocumentFragment pour éviter les reflows multiples
  const grid = document.getElementById('stickerGrid');
  const fragment = document.createDocumentFragment();

  pageStickers.forEach(sticker => {
    fragment.appendChild(buildStickerCard(sticker));
  });

  grid.innerHTML = '';
  grid.appendChild(fragment);
}

/**
 * Nombre de variantes de couleur disponibles pour .section-banner
 * (cf. classes .section-banner--0 à --5 dans styles.css).
 */
const SECTION_BANNER_COLOR_COUNT = 6;

/**
 * Calcule un index de couleur stable pour une section donnée, afin que
 * la même section affiche toujours la même couleur de bandeau.
 * @param {string} sectionName
 * @returns {number}
 */
function getSectionBannerColorIndex(sectionName) {
  let hash = 0;
  const str = sectionName || '';
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash % SECTION_BANNER_COLOR_COUNT;
}

/**
 * Retourne une classe CSS basée sur la section ou le groupe.
 * @param {string} section - Nom de la section (ex: "Panini")
 * @param {string} group - Groupe (ex: "A", "B", …)
 * @returns {string} - Nom de classe normalisé
 */
function getSectionClass(section, group) {
  const specialSections = {
    'Panini': 'panini',
    'Histoire de la Coupe du monde': 'histoire-de-la-coupe-du-monde'
  };
  if (specialSections[section]) return specialSections[section];
  if (group) return `groupe-${group.toLowerCase()}`;
  return 'default';
}

/**
 * Construit le bandeau de section en haut de la page d'album.
 * @param {Array} pageStickers - Vignettes de la page courante
 */
function renderAlbumSectionHeader(pageStickers) {
  const container = document.getElementById('albumSectionHeader');

  if (!pageStickers.length) {
    container.innerHTML = '';
    return;
  }

  // Récupération des sections uniques sur cette page
  const sections = [...new Set(pageStickers.map(s => s['Section']))];
  const firstSection = sections[0];
  const flagURL = pageStickers[0]?.Drapeau || '';
  const groupe = pageStickers[0]?.Groupe || '';
  const colorClass = getSectionClass(firstSection, groupe);

  container.innerHTML = `
    <div class="section-banner section-banner-${colorClass}">
      ${flagURL ? `<img src="${escHtml(flagURL)}" alt="${escHtml(firstSection)}" />` : ''}
      <span>${escHtml(firstSection)}</span>
      ${groupe ? `<span style="font-size:12px;opacity:0.7;letter-spacing:0.1em;">Groupe ${escHtml(groupe)}</span>` : ''}
    </div>
  `;
}

/**
 * Construit et retourne un élément DOM représentant une vignette.
 * @param {Object} sticker - Données d'une vignette
 * @returns {HTMLElement}
 */
function buildStickerCard(sticker) {
  const status = getStatus(sticker.ID);
  const dupCount = getDupCount(sticker.ID);

  const article = document.createElement('article');
  article.className = `sticker-card ${status}`;
  article.setAttribute('role', 'listitem');
  article.setAttribute('aria-label', `${sticker.ID} — ${sticker.Nom} (${statusLabel(status)})`);
  article.dataset.id = sticker.ID;
  article.dataset.type = sticker.Type || '';

  // Ajout de classes pour le type (SPEC / STD)
  if (sticker.Type === 'Spécial') {
    article.classList.add('type-special');
  } else {
    article.classList.add('type-classic');
  }

  // Badge doublon
  const dupBadge = status === 'duplicate'
    ? `<div class="dup-badge" aria-label="${dupCount} doublons">x${dupCount}</div>`
    : '';

  // Couleur de header selon le type
  const typeColor = sticker.Type === 'Spécial' ? 'var(--purple-psycho)' : '';
  const typeStyle = typeColor ? `style="background:${typeColor};color:#fff;"` : '';

  article.innerHTML = `
    ${dupBadge}
    <div class="sticker-header" ${typeStyle}>
      <span class="sticker-id">${escHtml(sticker.ID)}</span>
      <span class="sticker-type-badge">${escHtml(sticker.Type === 'Spécial' ? 'SPEC' : 'STD')}</span>
    </div>
    <div class="sticker-flag-wrap">
      <img
        class="sticker-flag"
        src="${escHtml(sticker.Drapeau || '')}"
        alt="${escHtml(sticker.Section)}"
        loading="lazy"
        onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2260%22 height=%2240%22><rect width=%2260%22 height=%2240%22 fill=%22%23DEE3F7%22/></svg>'"
      />
    </div>
    <div class="sticker-footer">
      <div class="sticker-name">${escHtml(sticker.Nom)}</div>
      <div class="sticker-section-label">${escHtml(sticker.Section)}</div>
    </div>
  `;

  // Clic → ouverture de la modale
  article.addEventListener('click', () => openModal(sticker.ID));

  return article;
}

/* ═══════════════════════════════════════════════════════════════
   11. VUE MANQUANTES
   ═══════════════════════════════════════════════════════════════ */

/**
 * Initialise les filtres communs aux vues manquantes et doublons.
 */
function initFilters() {
  // Filtres manquantes
  document.getElementById('manqSectionFilter').addEventListener('change', renderManquantesView);

  // Filtres doublons
  document.getElementById('dblSectionFilter').addEventListener('change', renderDoublonsView);

  // Peuplement des filtres
  populateFilterSelects();
}

/**
 * Peuple les <select> de filtres avec les codes et sections uniques.
 */
function populateFilterSelects() {
  const sections = [...new Set(stickers.map(s => s.Section))].sort();

  const manqSec  = document.getElementById('manqSectionFilter');
  const dblSec   = document.getElementById('dblSectionFilter');

  sections.forEach(sec => {
    [manqSec, dblSec].forEach(sel => {
      const opt = document.createElement('option');
      opt.value = sec;
      opt.textContent = sec;
      sel.appendChild(opt);
    });
  });
}

/**
 * Rend la vue "Mes manquantes".
 */
function renderManquantesView() {
  const filterSection = document.getElementById('manqSectionFilter').value;

  let missing = stickers.filter(s => getStatus(s.ID) === 'missing');

  if (filterSection) missing = missing.filter(s => s.Section === filterSection);

  // Compteur
  document.getElementById('manqCount').innerHTML =
    `<span>${missing.length}</span> vignette${missing.length > 1 ? 's' : ''} manquante${missing.length > 1 ? 's' : ''}`;

  // Rendu de la liste
  renderStickerList(document.getElementById('manqList'), missing);

  // Masquer la zone d'export si on change les filtres
  document.getElementById('manqExportZone').classList.add('hidden');
}

/**
 * Rend la vue "Mes doublons".
 */
function renderDoublonsView() {
  const filterSection = document.getElementById('dblSectionFilter').value;

  let duplicates = stickers.filter(s => getStatus(s.ID) === 'duplicate');

  if (filterSection) duplicates = duplicates.filter(s => s.Section === filterSection);

  // Compteur
  document.getElementById('dblCount').innerHTML =
    `<span>${duplicates.length}</span> vignette${duplicates.length > 1 ? 's' : ''} en doublon`;

  // Rendu de la liste
  renderStickerList(document.getElementById('dblList'), duplicates, true);

  // Masquer la zone d'export
  document.getElementById('dblExportZone').classList.add('hidden');
}

/**
 * Rend une liste de vignettes groupées par pays.
 * @param {HTMLElement} container - Conteneur de la liste
 * @param {Array} stickersList - Vignettes à afficher
 * @param {boolean} showDupCount - Afficher le compteur de doublons
 */
function renderStickerList(container, stickersList, showDupCount = false) {
  // DocumentFragment pour éviter les reflows multiples
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

  // Groupement par Code (pays)
  const grouped = {};
  stickersList.forEach(s => {
    if (!grouped[s.Code]) grouped[s.Code] = [];
    grouped[s.Code].push(s);
  });

  Object.entries(grouped).forEach(([code, items]) => {
    const sectionName = items[0]?.Section || code;
    const flagURL     = items[0]?.Drapeau || '';
    const group       = items[0]?.Groupe || '';
    const sectionClass = getSectionClass(sectionName, group);

    const header = document.createElement('div');
    header.className = `list-group-header list-group-header-${sectionClass}`;
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
        <img class="list-item-flag" src="${escHtml(s.Drapeau || '')}" alt="" loading="lazy"
             onerror="this.style.display='none'" />
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

/* ═══════════════════════════════════════════════════════════════
   12. EXPORT TEXTE (wantlist / tradelist)
   ═══════════════════════════════════════════════════════════════ */

/**
 * Génère le texte d'export au format "CODE N°1,N°2,N°3".
 * @param {Array} stickersList - Vignettes à exporter
 * @returns {string} - Texte formaté
 */
function generateExportText(stickersList) {
  // Groupement par code pays
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

/**
 * Initialise les boutons d'export texte et de copie.
 */
function initExportImport() {
  // --- Export / Import global (JSON) ---
  document.getElementById('btnExport').addEventListener('click', exportCollectionAsJSON);

  document.getElementById('inputImport').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) importCollectionFromJSON(file);
    e.target.value = ''; // Reset pour permettre un nouvel import du même fichier
  });

  // --- Export texte Manquantes ---
  document.getElementById('btnExportManq').addEventListener('click', () => {
    const filterSection = document.getElementById('manqSectionFilter').value;

    let missing = stickers.filter(s => getStatus(s.ID) === 'missing');
    if (filterSection) missing = missing.filter(s => s.Section === filterSection);

    const text = generateExportText(missing);
    document.getElementById('manqTextarea').value = text || '(Aucune vignette manquante)';
    document.getElementById('manqExportZone').classList.remove('hidden');
    document.getElementById('manqExportZone').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  document.getElementById('btnCopyManq').addEventListener('click', () => {
    copyTextarea('manqTextarea');
  });

  document.getElementById('btnCloseManqExport').addEventListener('click', () => {
    document.getElementById('manqExportZone').classList.add('hidden');
  });

  // --- Export texte Doublons ---
  document.getElementById('btnExportDbl').addEventListener('click', () => {
    const filterSection = document.getElementById('dblSectionFilter').value;

    let duplicates = stickers.filter(s => getStatus(s.ID) === 'duplicate');
    if (filterSection) duplicates = duplicates.filter(s => s.Section === filterSection);

    const text = generateExportText(duplicates);
    document.getElementById('dblTextarea').value = text || '(Aucun doublon)';
    document.getElementById('dblExportZone').classList.remove('hidden');
    document.getElementById('dblExportZone').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  document.getElementById('btnCopyDbl').addEventListener('click', () => {
    copyTextarea('dblTextarea');
  });

  document.getElementById('btnCloseDblExport').addEventListener('click', () => {
    document.getElementById('dblExportZone').classList.add('hidden');
  });
}

/**
 * Copie le contenu d'un textarea dans le presse-papier.
 * @param {string} textareaId - ID du textarea
 */
function copyTextarea(textareaId) {
  const textarea = document.getElementById(textareaId);
  navigator.clipboard.writeText(textarea.value)
    .then(() => showToast('Liste copiée dans le presse-papier.'))
    .catch(() => {
      // Fallback pour les environnements sans clipboard API
      textarea.select();
      document.execCommand('copy');
      showToast('Liste copiée.');
    });
}

/* ═══════════════════════════════════════════════════════════════
   13. VUE STATISTIQUES
   ═══════════════════════════════════════════════════════════════ */

/**
 * Rend la vue Statistiques.
 */
function renderStatsView() {
  const total     = stickers.length;
  const owned     = stickers.filter(s => getStatus(s.ID) === 'owned').length;
  const duplicates = stickers.filter(s => getStatus(s.ID) === 'duplicate').length;
  const missing   = stickers.filter(s => getStatus(s.ID) === 'missing').length;
  // Les doublons comptent comme "possédées" pour le % de complétion
  const ownedTotal = owned + duplicates;
  const pct = Math.round((ownedTotal / total) * 100);

  // Cartes globales
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

  // Barres par pays
  renderStatsBars();
}

/**
 * Rend les barres de complétion par pays/section.
 */
function renderStatsBars() {
  const container = document.getElementById('statsBars');
  container.innerHTML = '';

  // Groupement par Code pays
  const grouped = {};
  stickers.forEach(s => {
    if (!grouped[s.Code]) grouped[s.Code] = { section: s.Section, flag: s.Drapeau, stickers: [] };
    grouped[s.Code].stickers.push(s);
  });

  // Tri par taux de complétion décroissant
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

/* ═══════════════════════════════════════════════════════════════
   14. MODULE ÉCHANGES — utilitaires partagés
   ═══════════════════════════════════════════════════════════════ */

/**
 * Parse une liste texte au format "CODE N°1,N°2,N°3" et retourne un Set d'IDs.
 * @param {string} text - Texte brut à analyser
 * @returns {Set<string>} - Ensemble des IDs reconnus
 */
function parseTextList(text) {
  const ids = new Set();
  const knownIDs = new Set(stickers.map(s => s.ID));

  // Chaque ligne : "CODE n1,n2,n3" ou "CODE n1, n2, n3"
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  lines.forEach(line => {
    // Tente de matcher "CODE NUMS"
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

/* ═══════════════════════════════════════════════════════════════
   15. MODALE VIGNETTE
   ═══════════════════════════════════════════════════════════════ */

/**
 * Initialise la modale et ses contrôles.
 */
function initModal() {
  // Fermeture
  document.getElementById('btnModalClose').addEventListener('click', closeModal);
  document.getElementById('stickerModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalStickerID) closeModal();
  });

  // Boutons de statut
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

  // Contrôles de compteur doublons
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
    if (current <= 2) return; // minimum 2 pour un doublon
    const newCount = current - 1;
    setStatus(modalStickerID, 'duplicate', newCount);
    document.getElementById('dupCountDisplay').textContent = newCount;
    // Mettre à jour l'état disabled
    document.getElementById('btnDupMinus').disabled = (newCount <= 2);
    refreshStickerInView(modalStickerID);
  });
}

/**
 * Met à jour l'état disabled du bouton Moins en fonction du count actuel.
 */
function updateDupMinusState() {
  const btnMinus = document.getElementById('btnDupMinus');
  if (!modalStickerID) { btnMinus.disabled = false; return; }
  const count = collectionState[modalStickerID]?.count || 2;
  btnMinus.disabled = (count <= 2);
}

/**
 * Ouvre la modale pour une vignette donnée.
 * @param {string} id - ID de la vignette
 */
function openModal(id) {
  const sticker = stickers.find(s => s.ID === id);
  if (!sticker) return;

  modalStickerID = id;
  const status = getStatus(id);

  // Remplissage des informations
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

  // Couleur de l'en-tête selon le statut
  const headerColors = {
    owned:     { bg: 'var(--green-deep)',      fg: 'var(--yellow-lime)' },
    missing:   { bg: 'var(--surface-mid)',     fg: 'var(--outline)' },
    duplicate: { bg: 'var(--orange-vibrant)',  fg: '#fff' },
  };
  const colors = headerColors[status] || headerColors.missing;
  const header = document.getElementById('modalHeader');
  header.style.background = colors.bg;
  header.style.color = colors.fg;

  // Boutons de statut
  updateModalStatusButtons(status);

  // Compteur doublons
  const dupControls = document.getElementById('modalDupControls');
  if (status === 'duplicate') {
    dupControls.classList.remove('hidden');
    document.getElementById('dupCountDisplay').textContent = getDupCount(id);
    updateDupMinusState();
  } else {
    dupControls.classList.add('hidden');
  }

  // Affichage de la modale
  document.getElementById('stickerModal').classList.remove('hidden');
  document.getElementById('btnModalClose').focus();
}

/**
 * Ferme la modale.
 */
function closeModal() {
  document.getElementById('stickerModal').classList.add('hidden');
  modalStickerID = null;
}

/**
 * Met à jour l'état visuel des boutons de statut dans la modale.
 * @param {string} activeStatus - Statut actuellement actif
 */
function updateModalStatusButtons(activeStatus) {
  document.querySelectorAll('.btn-status').forEach(btn => {
    btn.classList.toggle('active-status', btn.dataset.status === activeStatus);
  });
}

/**
 * Met à jour une vignette dans la vue courante sans re-rendre toute la grille.
 * @param {string} id - ID de la vignette à rafraîchir
 */
function refreshStickerInView(id) {
  // On re-rend uniquement si la vue courante affiche cette vignette
  // Pour la vue album, on cherche la card existante et on la remplace
  const existingCards = document.querySelectorAll(`.sticker-card[data-id="${id}"]`);
  if (existingCards.length > 0) {
    const sticker = stickers.find(s => s.ID === id);
    if (!sticker) return;
    const newCard = buildStickerCard(sticker);
    existingCards.forEach(card => card.parentNode.replaceChild(newCard.cloneNode(true), card));
    // Ré-attacher les événements sur le clone
    document.querySelectorAll(`.sticker-card[data-id="${id}"]`).forEach(card => {
      card.addEventListener('click', () => openModal(id));
    });
  }

  // Mise à jour des vues liste si elles sont actives
  if (currentView === 'manquantes') renderManquantesView();
  if (currentView === 'doublons')   renderDoublonsView();
  if (currentView === 'stats')      renderStatsView();
}

/* ═══════════════════════════════════════════════════════════════
   16. BARRE DE PROGRESSION GLOBALE
   ═══════════════════════════════════════════════════════════════ */

/**
 * Met à jour la barre de progression globale dans l'en-tête.
 */
function updateGlobalProgress() {
  const total = stickers.length;
  const owned = stickers.filter(s => getStatus(s.ID) !== 'missing').length;
  const pct   = total > 0 ? Math.round((owned / total) * 100) : 0;

  document.getElementById('progressOwned').textContent = owned;
  document.getElementById('progressTotal').textContent = total;
  document.getElementById('progressPct').textContent = `${pct}%`;
  document.getElementById('progressFill').style.width = `${pct}%`;
}

/* ═══════════════════════════════════════════════════════════════
   17. UTILITAIRES
   ═══════════════════════════════════════════════════════════════ */

/**
 * Échappe les caractères HTML pour prévenir les injections XSS.
 * @param {string} str - Chaîne à échapper
 * @returns {string}
 */
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

/**
 * Retourne la date du jour au format AAAA-MM-JJ, utilisable dans un nom de fichier.
 * @returns {string}
 */
function dateStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Retourne un libellé lisible pour un statut.
 * @param {string} status
 * @returns {string}
 */
function statusLabel(status) {
  const labels = { owned: 'Possédée', missing: 'Manquante', duplicate: 'Doublon' };
  return labels[status] || status;
}

/* ─── Toast ─── */

let toastTimer = null;

/**
 * Affiche un message toast temporaire.
 * Anti-spam : si plusieurs toasts identiques s'enchaînent rapidement,
 * un seul toast est affiché et mis à jour avec un compteur.
 * @param {string} message - Message à afficher
 * @param {number} [duration=2500] - Durée en ms
 * @param {boolean} [batchable=false] - Si true, regroupe les appels rapides
 */
function showToast(message, duration = 2500, batchable = false) {
  const toast = document.getElementById('toast');

  if (batchable) {
    // Mode batch : on incrémente un compteur au lieu d'empiler les toasts
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

  // Mode normal
  toastBatchCount = 0;
  toastBatchMessage = '';
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

/* ─── Spinner de chargement ─── */

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

function hideLoadingSpinner() {
  // Le spinner disparaîtra au prochain renderAlbumView()
}


/* ═══════════════════════════════════════════════════════════════
   18. RECHERCHE GLOBALE
   ═══════════════════════════════════════════════════════════════ */

/**
 * Initialise la barre de recherche globale.
 * La barre (#viewSearchBar) vit directement dans les vues (et non plus
 * dans le header) : elle est déplacée d'une vue à l'autre par
 * moveSearchBarToView(), appelée au chargement et à chaque switchView().
 * Filtre la vue actuellement affichée en temps réel.
 */
function initGlobalSearch() {
  const input  = document.getElementById('globalSearch');
  const clearBtn = document.getElementById('searchClear');

  if (!input) return;

  input.addEventListener('input', () => {
    searchQuery = input.value.trim().toLowerCase();
    searchActive = searchQuery.length > 0;
    clearBtn.classList.toggle('hidden', !searchActive);
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

/**
 * Déplace la barre de recherche (#viewSearchBar) dans le slot dédié de la
 * vue donnée, afin qu'elle apparaisse toujours au sein de la vue affichée
 * plutôt que dans le header.
 * @param {string} viewName
 */
function moveSearchBarToView(viewName) {
  const bar = document.getElementById('viewSearchBar');
  const slot = document.getElementById(`searchSlot-${viewName}`);
  if (bar && slot) {
    slot.appendChild(bar);
  }
}

/**
 * Applique le filtre de recherche sur la vue courante.
 * Seules les vues Album, Manquantes et Doublons possèdent une barre de
 * recherche (cf. SEARCHABLE_VIEWS) : Statistiques et Échanges ne sont
 * jamais affectées.
 */
function applySearchFilter() {
  // Supprimer tout bandeau de recherche existant
  document.querySelectorAll('.search-results-banner').forEach(b => b.remove());

  if (!searchActive) {
    // Restaurer la vue normale
    renderCurrentView();
    return;
  }

  const q = searchQuery;

  // Filtrer parmi TOUTES les vignettes connues
  const matched = stickers.filter(s => {
    const idMatch   = s.ID.toLowerCase().includes(q);
    const nomMatch  = (s.Nom || '').toLowerCase().includes(q);
    const codeMatch = (s.Code || '').toLowerCase().includes(q);
    return idMatch || nomMatch || codeMatch;
  });

  // Afficher selon la vue courante
  if (currentView === 'album') {
    renderSearchResultsGrid(matched, q);
  } else if (currentView === 'manquantes') {
    const filtered = matched.filter(s => getStatus(s.ID) === 'missing');
    renderSearchResultsList(filtered, q, false);
  } else if (currentView === 'doublons') {
    const filtered = matched.filter(s => getStatus(s.ID) === 'duplicate');
    renderSearchResultsList(filtered, q, true);
  }
}

/**
 * Affiche les résultats de recherche sous forme de grille.
 * @param {Array} results - Vignettes correspondantes
 * @param {string} q - Terme recherché
 */
function renderSearchResultsGrid(results, q) {
  // Trouver le conteneur de grille actif
  const grid = document.getElementById('stickerGrid');
  const container = document.getElementById('view-album');

  if (!grid || !container) return;

  // Bandeau résultat
  const banner = createSearchBanner(results.length, q);
  grid.parentNode.insertBefore(banner, grid);

  // Grille filtrée avec DocumentFragment
  const frag = document.createDocumentFragment();
  results.forEach(s => frag.appendChild(buildStickerCard(s)));
  grid.innerHTML = '';
  grid.appendChild(frag);
}

/**
 * Affiche les résultats de recherche sous forme de liste.
 * @param {Array} results
 * @param {string} q
 * @param {boolean} showDupCount
 */
function renderSearchResultsList(results, q, showDupCount) {
  const listId = currentView === 'manquantes' ? 'manqList' : 'dblList';
  const listEl = document.getElementById(listId);
  if (!listEl) return;

  const banner = createSearchBanner(results.length, q);
  listEl.parentNode.insertBefore(banner, listEl);

  renderStickerList(listEl, results, showDupCount);
}

/**
 * Crée un bandeau d'info de résultat de recherche.
 * @param {number} count
 * @param {string} q
 * @returns {HTMLElement}
 */
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


/* ═══════════════════════════════════════════════════════════════
   19. MODE OUVERTURE DE BOOSTER
   ═══════════════════════════════════════════════════════════════ */

/**
 * Initialise le bouton "Ouvrir un booster" (désormais dans le header,
 * ex-bouton flottant) et sa modale.
 */
function initBoosterModal() {
  const fab     = document.getElementById('fabBooster');
  const modal   = document.getElementById('boosterModal');
  const btnClose   = document.getElementById('btnBoosterClose');
  const btnCancel  = document.getElementById('btnBoosterCancel');
  const btnValidate = document.getElementById('btnBoosterValidate');
  const input   = document.getElementById('boosterInput');
  const preview = document.getElementById('boosterPreview');

  if (!fab || !modal) return;

  // Ouverture
  fab.addEventListener('click', () => {
    input.value = '';
    preview.innerHTML = '';
    modal.classList.remove('hidden');
    input.focus();
  });

  // Fermeture
  [btnClose, btnCancel].forEach(btn => {
    btn && btn.addEventListener('click', closeBoosterModal);
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeBoosterModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeBoosterModal();
  });

  // Prévisualisation en temps réel
  input.addEventListener('input', () => {
    updateBoosterPreview(input.value, preview);
  });

  // Validation
  btnValidate.addEventListener('click', () => {
    const ids = parseBoosterInput(input.value);
    if (ids.valid.length === 0) {
      showToast('Aucun ID reconnu dans la saisie.');
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
    showToast(`${ids.valid.length} vignette${ids.valid.length > 1 ? 's' : ''} ajoutée${ids.valid.length > 1 ? 's' : ''}.`, 3000);
  });
}

function closeBoosterModal() {
  document.getElementById('boosterModal').classList.add('hidden');
}

/**
 * Parse une chaîne de saisie booster (IDs séparés par espaces).
 * @param {string} raw
 * @returns {{ valid: string[], invalid: string[] }}
 */
function parseBoosterInput(raw) {
  const knownIDs = new Set(stickers.map(s => s.ID));
  const tokens = raw.trim().toUpperCase().split(/\s+/).filter(Boolean);
  const valid = [];
  const invalid = [];

  tokens.forEach(t => {
    if (knownIDs.has(t)) {
      valid.push(t);
    } else {
      invalid.push(t);
    }
  });

  return { valid, invalid };
}

/**
 * Met à jour la prévisualisation des IDs dans la modale booster.
 * @param {string} raw
 * @param {HTMLElement} preview
 */
function updateBoosterPreview(raw, preview) {
  if (!raw.trim()) {
    preview.innerHTML = '';
    return;
  }
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


/* ═══════════════════════════════════════════════════════════════
   20. MATCHMAKER — REFONTE DES ÉCHANGES
   ═══════════════════════════════════════════════════════════════ */

/** Collection parsée de l'ami (Map: id → entry) */
let friendCollection = null;

/**
 * Initialise le module Matchmaker.
 */
function initMatchmaker() {
  const inputFriendJSON = document.getElementById('inputFriendJSON');
  const btnExportMatch = document.getElementById('btnExportMatch');
  const btnCopyMatch   = document.getElementById('btnCopyMatch');
  const btnCopyMatchText = document.getElementById('btnCopyMatchText');
  const btnCloseMatchExport = document.getElementById('btnCloseMatchExport');
  const btnValidateExchange = document.getElementById('btnValidateExchange');
  const btnSelectAllMatches = document.getElementById('btnSelectAllMatches');
  const btnSelectNoneMatches = document.getElementById('btnSelectNoneMatches');
  const resultsEl = document.getElementById('matchmakerResults');

  if (!inputFriendJSON) return;

  // Bascule entre les deux modes de saisie (import JSON / manuel)
  const modeBtnImport = document.getElementById('modeBtnImport');
  const modeBtnManual = document.getElementById('modeBtnManual');
  const modePanelImport = document.getElementById('modePanel-import');
  const modePanelManual = document.getElementById('modePanel-manual');

  function setMatchmakerMode(mode) {
    const isManual = mode === 'manual';
    modeBtnImport && modeBtnImport.classList.toggle('active', !isManual);
    modeBtnManual && modeBtnManual.classList.toggle('active', isManual);
    modeBtnImport && modeBtnImport.setAttribute('aria-selected', String(!isManual));
    modeBtnManual && modeBtnManual.setAttribute('aria-selected', String(isManual));
    modePanelImport && modePanelImport.classList.toggle('hidden', isManual);
    modePanelManual && modePanelManual.classList.toggle('hidden', !isManual);
  }

  modeBtnImport && modeBtnImport.addEventListener('click', () => setMatchmakerMode('import'));
  modeBtnManual && modeBtnManual.addEventListener('click', () => setMatchmakerMode('manual'));

  // Analyse à partir de la saisie manuelle (doublons / manquantes séparés)
  const btnAnalyseManual = document.getElementById('btnAnalyseManual');
  btnAnalyseManual && btnAnalyseManual.addEventListener('click', runMatchmakerManual);

  // Import fichier JSON ami : lit le fichier et lance directement l'analyse
  inputFriendJSON.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      runMatchmakerFromJSON(ev.target.result);
    };
    reader.onerror = () => {
      showToast('Impossible de lire le fichier.');
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  // Export récap texte
  btnExportMatch && btnExportMatch.addEventListener('click', exportMatchSummary);
  btnCopyMatch && btnCopyMatch.addEventListener('click', exportMatchSummary);

  btnCopyMatchText && btnCopyMatchText.addEventListener('click', () => {
    copyTextarea('matchTextarea');
  });

  // Cases à cocher "carte échangée" : mise à jour du style + du compteur
  resultsEl && resultsEl.addEventListener('change', (e) => {
    if (!e.target.classList.contains('match-tag-check')) return;
    const tag = e.target.closest('.match-tag');
    tag && tag.classList.toggle('excluded', !e.target.checked);
    updateValidateHint();
  });

  // Tout cocher / tout décocher
  btnSelectAllMatches && btnSelectAllMatches.addEventListener('click', () => setAllMatchChecks(true));
  btnSelectNoneMatches && btnSelectNoneMatches.addEventListener('click', () => setAllMatchChecks(false));

  // Validation de l'échange effectué
  btnValidateExchange && btnValidateExchange.addEventListener('click', validateExchange);

  btnCloseMatchExport && btnCloseMatchExport.addEventListener('click', () => {
    document.getElementById('matchExportZone').classList.add('hidden');
  });
}

/**
 * Parse la collection d'un ami depuis un JSON exporté par l'app.
 * @param {string} raw
 * @returns {Object|null} - collectionState-like object ou null si erreur
 */
function parseFriendCollection(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed; // Format JSON (collectionState)
    }
  } catch (e) {
    // JSON invalide
  }
  return null;
}

/**
 * Exécute l'analyse de correspondance (matchmaking) à partir du contenu
 * JSON importé (fichier de collection d'un ami).
 * @param {string} raw - Contenu brut du fichier JSON importé
 */
function runMatchmakerFromJSON(raw) {
  const parsed = parseFriendCollection(raw);

  if (!parsed) {
    showToast('Fichier JSON invalide ou non reconnu.');
    return;
  }

  friendCollection = parsed;
  refreshMatchResults();
}

/**
 * Construit une collection d'ami à partir de deux listes saisies
 * séparément : ses doublons et ses manquantes (format CODE 1,2,3 chacune).
 * Toute vignette non mentionnée est considérée comme simplement possédée
 * par l'ami (ni doublon, ni manquante), donc neutre pour le matchmaking.
 * @param {string} duplicatesRaw
 * @param {string} missingRaw
 * @returns {Object|null}
 */
function parseFriendManual(duplicatesRaw, missingRaw) {
  const dupIds = parseTextList(duplicatesRaw);
  const missIds = parseTextList(missingRaw);

  if (dupIds.size === 0 && missIds.size === 0) return null;

  const result = {};
  stickers.forEach(s => {
    result[s.ID] = { status: 'owned', count: 0 };
  });
  missIds.forEach(id => {
    result[id] = { status: 'missing', count: 0 };
  });
  dupIds.forEach(id => {
    result[id] = { status: 'duplicate', count: 0 };
  });

  return result;
}

/**
 * Exécute l'analyse de correspondance à partir des deux listes saisies
 * manuellement (doublons de l'ami / manquantes de l'ami).
 */
function runMatchmakerManual() {
  const duplicatesRaw = document.getElementById('friendDuplicatesInput').value.trim();
  const missingRaw = document.getElementById('friendMissingInput').value.trim();

  if (!duplicatesRaw && !missingRaw) {
    showToast('La liste de ton ami est vide.');
    return;
  }

  const parsed = parseFriendManual(duplicatesRaw, missingRaw);

  if (!parsed) {
    showToast('Aucun ID reconnu. Utilise le format CODE 1,2,3.');
    return;
  }

  friendCollection = parsed;
  refreshMatchResults();
}

/**
 * Recalcule et réaffiche les correspondances (give/receive) à partir de
 * l'état courant de `collectionState` et `friendCollection`, sans reparser
 * le texte collé. Utilisé après l'analyse initiale, mais aussi après une
 * validation d'échange pour rafraîchir les listes sans perdre les
 * changements déjà appliqués à `friendCollection`.
 */
function refreshMatchResults() {
  if (!friendCollection) return;

  const resultsEl = document.getElementById('matchmakerResults');
  const emptyEl   = document.getElementById('echangeResults');

  // Mes manquantes
  const mesManquantes = new Set(
    stickers.filter(s => getStatus(s.ID) === 'missing').map(s => s.ID)
  );

  // Mes doublons
  const mesDoublons = new Set(
    stickers.filter(s => getStatus(s.ID) === 'duplicate').map(s => s.ID)
  );

  // Manquantes de l'ami (statut missing dans sa collection)
  const amiManquantes = new Set(
    stickers.filter(s => {
      const entry = friendCollection[s.ID];
      return !entry || entry.status === 'missing';
    }).map(s => s.ID)
  );

  // Doublons de l'ami
  const amiDoublons = new Set(
    stickers.filter(s => {
      const entry = friendCollection[s.ID];
      return entry && entry.status === 'duplicate';
    }).map(s => s.ID)
  );

  // Ce que je peux lui donner : mes doublons croisés avec ses manquantes
  const jeDonne = [...mesDoublons].filter(id => amiManquantes.has(id));

  // Ce qu'il/elle peut me donner : ses doublons croisés avec mes manquantes
  const ilDonne = [...mesManquantes].filter(id => amiDoublons.has(id));

  // Affichage
  emptyEl.classList.add('hidden');
  resultsEl.classList.remove('hidden');

  // Résumé
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

  // Compteurs
  document.getElementById('giveCount').textContent = jeDonne.length;
  document.getElementById('receiveCount').textContent = ilDonne.length;

  // Listes tags (cases à cocher, toutes cochées par défaut)
  renderMatchTags(document.getElementById('giveList'), jeDonne);
  renderMatchTags(document.getElementById('receiveList'), ilDonne);

  // Cacher l'export précédent
  document.getElementById('matchExportZone').classList.add('hidden');

  updateValidateHint();
}

/**
 * Rend les tags de correspondance (avec case à cocher "sera échangée")
 * dans un panneau. Une carte cochée sera prise en compte lors de la
 * validation de l'échange ; décocher permet d'exclure une carte qui, en
 * pratique, n'a pas été échangée.
 * @param {HTMLElement} container
 * @param {string[]} ids
 */
function renderMatchTags(container, ids) {
  const frag = document.createDocumentFragment();

  if (ids.length === 0) {
    const empty = document.createElement('p');
    empty.style.cssText = 'color:var(--outline);font-size:13px;font-style:italic;padding:4px;';
    empty.textContent = 'Aucune vignette correspondante.';
    frag.appendChild(empty);
  } else {
    ids.forEach(id => {
      const s = stickers.find(x => x.ID === id);
      const tag = document.createElement('label');
      tag.className = 'match-tag';
      tag.dataset.id = id;
      tag.title = `${id} — ${s?.Nom || ''} (décoche si non échangée)`;
      tag.innerHTML = `
        <input type="checkbox" class="match-tag-check" checked />
        <span class="match-tag-code">${escHtml(id)}</span>
        <span class="tag-name">${escHtml(s?.Nom || '')}</span>
      `;
      frag.appendChild(tag);
    });
  }

  container.innerHTML = '';
  container.appendChild(frag);
}

/**
 * Coche ou décoche toutes les cases "carte échangée" des deux panneaux.
 * @param {boolean} checked
 */
function setAllMatchChecks(checked) {
  document.querySelectorAll('#matchmakerResults .match-tag-check').forEach(cb => {
    cb.checked = checked;
    cb.closest('.match-tag')?.classList.toggle('excluded', !checked);
  });
  updateValidateHint();
}

/**
 * Met à jour le texte d'aide au-dessus du bouton de validation, en
 * fonction du nombre de cartes actuellement cochées.
 */
function updateValidateHint() {
  const hint = document.getElementById('validateHint');
  if (!hint) return;

  const giveChecked = document.querySelectorAll('#giveList .match-tag-check:checked').length;
  const receiveChecked = document.querySelectorAll('#receiveList .match-tag-check:checked').length;
  const total = giveChecked + receiveChecked;

  if (total === 0) {
    hint.textContent = 'Décoche les cartes qui n\'ont pas été échangées, puis valide pour mettre à jour ta collection.';
  } else {
    hint.textContent = `${total} vignette${total > 1 ? 's' : ''} seront marquées comme échangées : ${giveChecked} donnée${giveChecked > 1 ? 's' : ''}, ${receiveChecked} reçue${receiveChecked > 1 ? 's' : ''}.`;
  }
}

/**
 * Valide l'échange : met à jour ma collection en fonction des cartes
 * cochées, met à jour en mémoire la collection de l'ami, puis génère et
 * télécharge un fichier JSON prêt à être importé par l'ami dans son
 * propre tracker.
 */
function validateExchange() {
  if (!friendCollection) {
    showToast('Analyse d\'abord la collection de ton ami.');
    return;
  }

  const selectedGive = Array.from(document.querySelectorAll('#giveList .match-tag'))
    .filter(tag => tag.querySelector('.match-tag-check')?.checked)
    .map(tag => tag.dataset.id);

  const selectedReceive = Array.from(document.querySelectorAll('#receiveList .match-tag'))
    .filter(tag => tag.querySelector('.match-tag-check')?.checked)
    .map(tag => tag.dataset.id);

  if (selectedGive.length === 0 && selectedReceive.length === 0) {
    showToast('Sélectionne au moins une vignette échangée.');
    return;
  }

  // 1. Mise à jour de MA collection ---------------------------------------
  selectedGive.forEach(id => {
    // Je donne un de mes doublons : je perds une copie
    const current = collectionState[id]?.count || 2;
    const next = current - 1;
    if (next <= 1) {
      setStatus(id, 'owned');
    } else {
      setStatus(id, 'duplicate', next);
    }
  });

  selectedReceive.forEach(id => {
    // Je reçois une vignette qui me manquait
    setStatus(id, 'owned');
  });

  // 2. Mise à jour (en mémoire) de la collection de mon ami ---------------
  selectedGive.forEach(id => {
    // Il/elle reçoit ce que je lui donne
    friendCollection[id] = { status: 'owned', count: 0 };
  });

  selectedReceive.forEach(id => {
    // Il/elle donne un de ses doublons : il/elle perd une copie
    const entry = friendCollection[id];
    const current = entry?.count || 2;
    const next = current - 1;
    friendCollection[id] = next <= 1
      ? { status: 'owned', count: 0 }
      : { status: 'duplicate', count: next };
  });

  // 3. Génération et téléchargement du fichier pour l'ami -----------------
  downloadJSONFile(friendCollection, `collection-ami-apres-echange-${dateStamp()}.json`);

  // 4. Rafraîchissement de l'UI --------------------------------------------
  renderCurrentView();
  updateGlobalProgress();
  refreshMatchResults();

  const total = selectedGive.length + selectedReceive.length;
  showToast(`Échange validé : ${total} vignette${total > 1 ? 's' : ''} mise${total > 1 ? 's' : ''} à jour. Fichier pour ton ami téléchargé.`, 3500);
}

/**
 * Génère et affiche l'export texte du récapitulatif d'échange.
 * Ne reprend que les vignettes actuellement cochées (celles qui seront/ont
 * été réellement échangées).
 */
function exportMatchSummary() {
  const giveList = Array.from(document.getElementById('giveList').querySelectorAll('.match-tag'))
    .filter(t => t.querySelector('.match-tag-check')?.checked)
    .map(t => t.dataset.id);
  const receiveList = Array.from(document.getElementById('receiveList').querySelectorAll('.match-tag'))
    .filter(t => t.querySelector('.match-tag-check')?.checked)
    .map(t => t.dataset.id);

  const giveText    = giveList.length ? giveList.join(', ') : 'Aucun doublon à donner';
  const receiveText = receiveList.length ? receiveList.join(', ') : 'Aucune vignette à recevoir';

  const text = [
    '=== RÉCAPITULATIF ÉCHANGE PANINI WC2026 ===',
    '',
    `Ce que je peux te donner (${giveList.length}) :`,
    giveText,
    '',
    `Ce que tu peux me donner (${receiveList.length}) :`,
    receiveText,
    '',
    `Généré le ${new Date().toLocaleDateString('fr-FR')} via Panini WC2026 Tracker`,
  ].join('\n');

  document.getElementById('matchTextarea').value = text;
  const zone = document.getElementById('matchExportZone');
  zone.classList.remove('hidden');
  zone.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
