// --- ÉTAT GLOBAL ---
let collectionState = JSON.parse(localStorage.getItem('fwc26_collection')) || {};
let currentView = 'album';
let friendCollection = null;
let currentTradeData = null; // Stockage temporaire de l'échange en cours

// Base de données fictive pour l'exemple (à remplacer par tes vraies données)
const database = [
  { id: 'FRA1', name: 'Mbappé' },
  { id: 'FRA2', name: 'Griezmann' },
  { id: 'BRA1', name: 'Vinicius Jr' },
  { id: 'ARG1', name: 'Messi' }
];

// --- INITIALISATION ---
document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initGlobalSearch();
  initMatchmaker();
  renderAlbum();
});

// --- NAVIGATION ---
function initNavigation() {
  document.getElementById('btnViewAlbum').addEventListener('click', () => switchView('album'));
  document.getElementById('btnViewTrades').addEventListener('click', () => switchView('trades'));
}

function switchView(viewName) {
  currentView = viewName;
  
  // Gestion des boutons
  document.getElementById('btnViewAlbum').classList.toggle('active', viewName === 'album');
  document.getElementById('btnViewTrades').classList.toggle('active', viewName === 'trades');
  
  // Gestion des sections
  document.getElementById('viewAlbum').classList.toggle('active', viewName === 'album');
  document.getElementById('viewTrades').classList.toggle('active', viewName === 'trades');
}

// --- RECHERCHE GLOBALE (Corrigée) ---
function initGlobalSearch() {
  const searchInput = document.getElementById('searchInput');
  
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    const searchActive = query.length > 0;
    
    // CORRECTION : Dès qu'une recherche est active, on bascule sur l'album si besoin
    if (searchActive && currentView !== 'album') {
      switchView('album');
    }
    
    applySearchFilter(query);
  });
}

function applySearchFilter(query) {
  const cards = document.querySelectorAll('.card');
  cards.forEach(card => {
    const name = card.dataset.name.toLowerCase();
    if (name.includes(query)) {
      card.classList.remove('hidden');
    } else {
      card.classList.add('hidden');
    }
  });
}

// --- RENDU ALBUM & INTERACTIONS (Bonus UX inclus) ---
function renderAlbum() {
  const grid = document.getElementById('gridContainer');
  grid.innerHTML = '';

  database.forEach(sticker => {
    const state = collectionState[sticker.id] || { status: 'missing', count: 0 };
    
    const card = document.createElement('div');
    card.className = `card ${state.status}`;
    card.dataset.id = sticker.id;
    card.dataset.name = sticker.name;
    
    let html = `<strong>${sticker.id}</strong><br><small>${sticker.name}</small>`;
    if (state.count > 1) {
      html += `<div class="count-badge">+${state.count - 1}</div>`;
    }
    card.innerHTML = html;

    // Événement Clic : Missing -> Owned -> Duplicate
    card.addEventListener('click', (e) => {
      // Ignorer si c'est un clic long (géré par touchstart/touchend)
      if (card.dataset.longPressTriggered === 'true') {
         card.dataset.longPressTriggered = 'false';
         return;
      }
      cycleStatus(sticker.id);
    });

    // BONUS PRO UX : Appui long (Mobile) ou Clic Droit (PC) pour ajouter des doublons rapidement
    let pressTimer;
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      addDuplicateFast(sticker.id);
    });
    card.addEventListener('touchstart', (e) => {
      pressTimer = window.setTimeout(() => {
        card.dataset.longPressTriggered = 'true';
        addDuplicateFast(sticker.id);
      }, 500); // 500ms d'appui
    }, {passive: true});
    card.addEventListener('touchend', () => clearTimeout(pressTimer));
    card.addEventListener('touchmove', () => clearTimeout(pressTimer));

    grid.appendChild(card);
  });
}

function cycleStatus(id) {
  const current = collectionState[id] || { status: 'missing', count: 0 };
  if (current.status === 'missing') {
    setStatus(id, 'owned', 1);
  } else if (current.status === 'owned') {
    setStatus(id, 'duplicate', 2);
  } else {
    setStatus(id, 'missing', 0);
  }
  saveAndRender();
}

// Fonction pour l'appui long : incrémente directement les doublons
function addDuplicateFast(id) {
  const current = collectionState[id] || { status: 'missing', count: 0 };
  if (current.status === 'missing') {
    setStatus(id, 'owned', 1);
  } else {
    setStatus(id, 'duplicate', (current.count || 1) + 1);
  }
  saveAndRender();
}

function setStatus(id, status, count = null) {
  if (!collectionState[id]) collectionState[id] = {};
  collectionState[id].status = status;
  if (count !== null) collectionState[id].count = count;
}

function saveAndRender() {
  localStorage.setItem('fwc26_collection', JSON.stringify(collectionState));
  renderAlbum();
  // Relancer la recherche si un filtre était actif
  const query = document.getElementById('searchInput').value.toLowerCase().trim();
  if (query.length > 0) applySearchFilter(query);
}

// --- MODULE ÉCHANGES (Matchmaker & Validation) ---
function initMatchmaker() {
  document.getElementById('btnRunMatchmaker').addEventListener('click', runMatchmaker);
  document.getElementById('btnValidateTrade').addEventListener('click', executeTrade);
}

function runMatchmaker() {
  const input = document.getElementById('friendDataInput').value;
  try {
    friendCollection = JSON.parse(input);
  } catch (e) {
    alert("Format de données invalide. Veuillez coller un JSON valide.");
    return;
  }

  const jeDonne = [];
  const ilDonne = [];

  // Analyse : Ce que je donne
  Object.keys(collectionState).forEach(id => {
    if (collectionState[id].status === 'duplicate') {
      const friendStatus = friendCollection[id]?.status || 'missing';
      if (friendStatus === 'missing') {
        jeDonne.push(id);
      }
    }
  });

  // Analyse : Ce qu'il me donne
  Object.keys(friendCollection).forEach(id => {
    if (friendCollection[id].status === 'duplicate') {
      const myStatus = collectionState[id]?.status || 'missing';
      if (myStatus === 'missing') {
        ilDonne.push(id);
      }
    }
  });

  // Affichage des résultats
  document.getElementById('giveCount').textContent = jeDonne.length;
  document.getElementById('receiveCount').textContent = ilDonne.length;
  
  document.getElementById('giveList').innerHTML = jeDonne.map(id => `<li>${id}</li>`).join('');
  document.getElementById('receiveList').innerHTML = ilDonne.map(id => `<li>${id}</li>`).join('');

  document.getElementById('matchmakerResults').classList.remove('hidden');

  // NOUVEAU : Stockage temporaire pour la validation
  window.currentTradeData = { jeDonne, ilDonne };
}

/**
 * NOUVEAU : Valide l'échange en cours, met à jour la collection et génère la sauvegarde pour l'ami.
 */
function executeTrade() {
  if (!window.currentTradeData) return;
  const { jeDonne, ilDonne } = window.currentTradeData;

  if (jeDonne.length === 0 && ilDonne.length === 0) {
    alert('⚠️ Aucun échange possible à valider.');
    return;
  }

  // 1. Mise à jour de MA collection
  jeDonne.forEach(id => {
    const currentCount = collectionState[id]?.count || 2;
    if (currentCount > 2) {
      setStatus(id, 'duplicate', currentCount - 1); 
    } else {
      setStatus(id, 'owned', 1); 
    }
  });

  ilDonne.forEach(id => {
    setStatus(id, 'owned', 1); 
  });

  // 2. Génération du fichier de sauvegarde pour L'AUTRE échangeur
  if (friendCollection) {
    jeDonne.forEach(id => { friendCollection[id] = { status: 'owned', count: 1 }; });
    ilDonne.forEach(id => {
      const fCount = friendCollection[id]?.count || 2;
      if (fCount > 2) {
        friendCollection[id].count = fCount - 1;
      } else {
        friendCollection[id] = { status: 'owned', count: 1 };
      }
    });

    try {
      const json = JSON.stringify(friendCollection, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `maj-collection-ami-fwc26.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Erreur génération sauvegarde ami", e);
    }
  }

  // 3. Nettoyage et rafraîchissement
  saveAndRender();
  
  // Reset de la vue Échanges
  document.getElementById('matchmakerResults').classList.add('hidden');
  document.getElementById('friendDataInput').value = '';
  window.currentTradeData = null;
  friendCollection = null;

  alert('✅ Échange validé ! Votre collection a été mise à jour et le fichier pour votre ami a été généré.');
}