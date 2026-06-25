/* ═══════════════════════════════════════════════════════════
   PANINI FIFA WORLD CUP 2026 — app.js (version corrigée)
   ─────────────────────────────────────────────────────────
   Modifications :
   - buildExportText : une ligne par pays, plus de doublons
   - Gestion des doublons avec Set
═══════════════════════════════════════════════════════════ */

// … (le reste du code est inchangé, seule la fonction buildExportText est remplacée)

/**
 * Construit le texte d'export au format :
 *   CODE num1,num2,...
 * Chaque vignette a un ID de type CODE+num (ex: FWC1, MEX5).
 * Pour les ID sans préfixe numérique, on les liste quand même.
 */
function buildExportText(items) {
  // Groupe par code
  const byCode = {};
  items.forEach(s => {
    if (!byCode[s.code]) byCode[s.code] = new Set(); // Utilisation d'un Set pour éviter les doublons
    byCode[s.code].add(s.id);
  });

  const lines = [];
  Object.entries(byCode).sort((a, b) => a[0].localeCompare(b[0])).forEach(([code, idSet]) => {
    // Convertir le Set en tableau et extraire les numéros
    const ids = Array.from(idSet);
    const nums = ids.map(id => {
      const match = id.match(/^[A-Za-z]+(\d+)$/);
      return match ? parseInt(match[1]) : id;
    });
    // Trier : d'abord les nombres, puis les non-numériques
    nums.sort((a, b) => {
      if (typeof a === 'number' && typeof b === 'number') return a - b;
      if (typeof a === 'number') return -1;
      if (typeof b === 'number') return 1;
      return String(a).localeCompare(String(b));
    });
    // Ligne unique : CODE suivi des numéros séparés par des virgules
    lines.push(code + ' ' + nums.join(','));
  });

  return lines.join('\n');
}

// … (le reste du code est inchangé)