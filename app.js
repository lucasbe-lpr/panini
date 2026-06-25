// === ETAT GLOBAL ===
let stickers = [];
let collectionState = {}; 
// Format: { "FWC1": { count: 0 }, "MEX5": { count: 2 } }
let currentView = 'album';
let currentPage = '1';

// === INITIALISATION ===
document.addEventListener('DOMContentLoaded', () => {
    initApp();
    setupEventListeners();
});

async function initApp() {
    try {
        // Chargement du CSV
        const response = await fetch('database.csv');
        if (!response.ok) throw new Error("Impossible de charger le fichier database.csv");
        const csvText = await response.text();
        
        stickers = parseCSV(csvText);
        
        // Chargement du cache LocalStorage
        const cached = localStorage.getItem('paniniCollectionState');
        if (cached) {
            collectionState = JSON.parse(cached);
        } else {
            // Initialiser à 0
            stickers.forEach(s => {
                collectionState[s.ID] = { count: 0 };
            });
        }
        
        // Si c'est la première page, on initialise currentPage
        if (stickers.length > 0) {
            currentPage = stickers[0]['Page (album)'];
        }

        renderView();
    } catch (error) {
        document.getElementById('app-content').innerHTML = `
            <div style="color: red; padding: 20px; text-align: center; border: 4px solid red;">
                <h2>Erreur critique</h2>
                <p>${error.message}</p>
                <p>Assurez-vous que database.csv est bien à la racine du projet et que vous utilisez un serveur local.</p>
            </div>`;
    }
}

// === PARSER CSV BASIQUE ===
function parseCSV(text) {
    const lines = text.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim());
    const result = [];
    
    for (let i = 1; i < lines.length; i++) {
        // Regex simple pour gérer les virgules dans les guillemets si besoin, 
        // mais une séparation simple fonctionne si le CSV est propre.
        const currentline = lines[i].split(','); 
        if (currentline.length < headers.length) continue;
        
        const obj = {};
        for (let j = 0; j < headers.length; j++) {
            obj[headers[j]] = currentline[j] ? currentline[j].trim() : "";
        }
        result.push(obj);
    }
    return result;
}

// === GESTION D'ETAT ===
function updateCount(id, delta) {
    if (!collectionState[id]) collectionState[id] = { count: 0 };
    collectionState[id].count += delta;
    if (collectionState[id].count < 0) collectionState[id].count = 0;
    
    saveToLocal();
    renderView(); // Re-render la vue courante
}

function saveToLocal() {
    localStorage.setItem('paniniCollectionState', JSON.stringify(collectionState));
}

// === NAVIGATION & EVENTS ===
function setupEventListeners() {
    // Navigation Tabs
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentView = e.target.dataset.view;
            renderView();
        });
    });

    // Boutons Import / Export
    document.getElementById('btn-export-json').addEventListener('click', exportCollectionAsJSON);
    
    document.getElementById('btn-import-trigger').addEventListener('click', () => {
        document.getElementById('input-import-json').click();
    });
    document.getElementById('input-import-json').addEventListener('change', importCollectionFromJSON);

    // Modal Export Texte
    document.getElementById('btn-close-modal').addEventListener('click', () => {
        document.getElementById('text-export-modal').classList.add('hidden');
    });
}

// === MOTEUR DE RENDU ===
function renderView() {
    const content = document.getElementById('app-content');
    content.innerHTML = ''; // Clear
    
    if (currentView === 'album') renderAlbum(content);
    else if (currentView === 'country') renderCountryView(content);
    else if (currentView === 'missing') renderFilteredList(content, 'missing');
    else if (currentView === 'duplicates') renderFilteredList(content, 'duplicates');
    else if (currentView === 'stats') renderStats(content);
}

// 1. Vue Album
function renderAlbum(container) {
    // Trouver toutes les pages uniques
    const pages = [...new Set(stickers.map(s => s['Page (album)']))];
    const pageIndex = pages.indexOf(currentPage) > -1 ? pages.indexOf(currentPage) : 0;
    currentPage = pages[pageIndex];

    const pageStickers = stickers.filter(s => s['Page (album)'] === currentPage);

    let html = `
        <div class="controls-bar">
            <button class="btn btn-action" onclick="changePage('${pages[pageIndex - 1]}')" ${pageIndex === 0 ? 'disabled' : ''}>&lt; Page précédente</button>
            <h2>PAGE ${currentPage}</h2>
            <button class="btn btn-action" onclick="changePage('${pages[pageIndex + 1]}')" ${pageIndex === pages.length - 1 ? 'disabled' : ''}>Page suivante &gt;</button>
        </div>
        <div class="grid-container">
            ${pageStickers.map(s => createStickerCard(s)).join('')}
        </div>
    `;
    container.innerHTML = html;
}

window.changePage = function(newPage) {
    if (newPage && newPage !== 'undefined') {
        currentPage = newPage;
        renderView();
    }
}

// 2. Vue par Pays/Code
function renderCountryView(container) {
    const codes = [...new Set(stickers.map(s => s.Code).filter(c => c))];
    // Créer un selecteur
    let html = `
        <div class="controls-bar">
            <h2>Filtrer par Code Pays</h2>
            <select id="country-select" class="btn" onchange="renderCountryGrid(this.value)">
                <option value="">-- Sélectionnez un code --</option>
                ${codes.map(c => `<option value="${c}">${c}</option>`).join('')}
            </select>
        </div>
        <div id="country-grid" class="grid-container"></div>
    `;
    container.innerHTML = html;
}

window.renderCountryGrid = function(code) {
    const grid = document.getElementById('country-grid');
    if (!code) { grid.innerHTML = ''; return; }
    const filtered = stickers.filter(s => s.Code === code);
    grid.innerHTML = filtered.map(s => createStickerCard(s)).join('');
}

// 3 & 4. Vue Manquantes et Doublons
function renderFilteredList(container, type) {
    const isMissing = type === 'missing';
    const targetStickers = stickers.filter(s => {
        const count = collectionState[s.ID] ? collectionState[s.ID].count : 0;
        return isMissing ? count === 0 : count > 1;
    });

    let html = `
        <div class="controls-bar">
            <h2>${isMissing ? 'Mes Manquantes' : 'Mes Doublons'} (${targetStickers.length})</h2>
            <button class="btn btn-primary" onclick="exportText('${type}')">Copier en Texte</button>
        </div>
        <div class="grid-container">
            ${targetStickers.map(s => createStickerCard(s)).join('')}
        </div>
    `;
    container.innerHTML = html;
}

// 5. Vue Stats
function renderStats(container) {
    let total = stickers.length;
    let owned = 0;
    let missing = 0;
    let duplicatesTotal = 0;

    stickers.forEach(s => {
        const c = collectionState[s.ID] ? collectionState[s.ID].count : 0;
        if (c === 0) missing++;
        if (c > 0) owned++;
        if (c > 1) duplicatesTotal += (c - 1);
    });

    const percent = total > 0 ? Math.round((owned / total) * 100) : 0;

    let html = `
        <div class="controls-bar"><h2>Statistiques de la collection</h2></div>
        <div class="stats-grid">
            <div class="stat-box"><h3>Complétion</h3><p>${percent}%</p></div>
            <div class="stat-box"><h3>Possédées uniques</h3><p>${owned} / ${total}</p></div>
            <div class="stat-box"><h3>Manquantes</h3><p>${missing}</p></div>
            <div class="stat-box"><h3>Doublons (volume)</h3><p>${duplicatesTotal}</p></div>
        </div>
    `;
    container.innerHTML = html;
}

// === COMPOSANTS UI ===
function createStickerCard(sticker) {
    const state = collectionState[sticker.ID] || { count: 0 };
    const count = state.count;
    
    let statusClass = 'status-missing';
    if (count === 1) statusClass = 'status-owned';
    else if (count > 1) statusClass = 'status-duplicate';

    return `
        <div class="sticker-card ${statusClass}">
            <div class="sticker-header">${sticker.ID}</div>
            <div class="sticker-visual">
                ${sticker.Drapeau ? `<img src="${sticker.Drapeau}" alt="Drapeau">` : '🖼️'}
            </div>
            <div class="sticker-info">
                <strong>${sticker.Nom}</strong><br>
                ${sticker.Type !== 'Classique' ? `<em>${sticker.Type}</em><br>` : ''}
            </div>
            <div class="sticker-actions">
                <button class="btn btn-action" onclick="updateCount('${sticker.ID}', -1)">-</button>
                <span class="count-badge">${count}</span>
                <button class="btn btn-action" onclick="updateCount('${sticker.ID}', 1)">+</button>
            </div>
        </div>
    `;
}

// === EXPORT TEXTE (WANTLIST / DUPES) ===
window.exportText = function(type) {
    const isMissing = type === 'missing';
    const grouped = {};
    
    stickers.forEach(s => {
        const count = collectionState[s.ID] ? collectionState[s.ID].count : 0;
        const match = isMissing ? count === 0 : count > 1;
        
        if (match) {
            const code = s.Code || s.Section || 'AUTRE';
            if (!grouped[code]) grouped[code] = [];
            
            // Extraire le numéro de l'ID (ex: "MEX5" -> "5", "FWC12" -> "12")
            // Si l'ID commence par le code, on le retire
            let num = s.ID;
            if (s.Code && s.ID.startsWith(s.Code)) {
                num = s.ID.replace(s.Code, '');
            }
            grouped[code].push(num);
        }
    });

    let out = [];
    for (const code in grouped) {
        out.push(code);
        out.push(grouped[code].join(','));
    }

    const textarea = document.getElementById('text-export-area');
    textarea.value = out.join('\n');
    document.getElementById('text-export-modal').classList.remove('hidden');
}

// === IMPORT / EXPORT JSON ===

function exportCollectionAsJSON() {
    const jsonStr = JSON.stringify(collectionState, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `ma-collection-panini-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function importCollectionFromJSON(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const imported = JSON.parse(e.target.result);
            // Validation basique
            if (typeof imported !== 'object') throw new Error("Format JSON invalide");
            
            collectionState = imported;
            saveToLocal();
            renderView();
            alert("Collection importée avec succès !");
        } catch (error) {
            alert("Erreur lors de l'importation du fichier : " + error.message);
        }
        // Reset l'input pour permettre de re-sélectionner le même fichier si besoin
        event.target.value = '';
    };
    reader.readAsText(file);
}