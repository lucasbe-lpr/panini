/* ═══════════════════════════════════════════════════════════
   PANINI FIFA WORLD CUP 2026 — app.js (debug version)
═══════════════════════════════════════════════════════════ */

/* ──────────────────────────────────────────────────────────
   1. ÉTAT GLOBAL
────────────────────────────────────────────────────────── */
let stickers = [];
let collectionState = {};
let albumPages = [];
let currentPageIndex = 0;
let currentTab = 'album';
const LS_KEY = 'panini-wc2026-collection';

/* ──────────────────────────────────────────────────────────
   2. CHARGEMENT DES DONNÉES
────────────────────────────────────────────────────────── */

async function loadData() {
  console.log('🔄 loadData() appelée');
  try {
    // Vérifier la présence de stickers.json
    console.log('📡 Tentative de fetch stickers.json...');
    const response = await fetch('stickers.json');
    console.log('📡 Réponse reçue, status:', response.status);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} - ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('📦 Données JSON reçues, nombre d\'éléments:', data.length);

    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('Le fichier stickers.json est vide ou invalide.');
    }

    stickers = data;

    // Initialisation collectionState
    stickers.forEach(s => {
      if (!collectionState[s.id]) {
        collectionState[s.id] = { status: 'missing', count: 0 };
      }
    });
    console.log('✅ collectionState initialisé');

    // Chargement localStorage
    loadFromLocalStorage();
    console.log('📂 localStorage chargé');

    // Pages uniques
    albumPages = [...new Set(stickers.map(s => s.page))].sort((a, b) => {
      if (a === '/') return 1;
      if (b === '/') return -1;
      return parseInt(a) - parseInt(b);
    });
    console.log('📄 Pages de l\'album:', albumPages);

    // Masquer le message de chargement
    document.getElementById('loadingMsg').style.display = 'none';
    console.log('🖼️ Message de chargement masqué');

    // Peupler les filtres
    populateFilters();
    console.log('🔍 Filtres peuplés');

    // Afficher la vue initiale
    switchTab('album');
    updateGlobalProgress();
    console.log('✅ App prête !');

  } catch (err) {
    console.error('❌ Erreur dans loadData:', err);
    document.getElementById('loadingMsg').style.display = 'none';
    const errEl = document.getElementById('errorMsg');
    errEl.style.display = 'block';
    document.getElementById('errorText').textContent =
      `❌ Impossible de charger les données : ${err.message}. ` +
      `Assurez-vous que stickers.json est bien présent dans le même dossier que index.html.`;
  }
}

/* ─── Les autres fonctions restent identiques ─── */
/* (recopie toutes les autres fonctions depuis le code complet fourni précédemment) */

/* ──────────────────────────────────────────────────────────
   9. INIT
────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  console.log('🚀 DOM prêt, lancement loadData()');
  loadData();
});