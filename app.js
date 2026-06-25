/**
 * Construit le texte d'export au format :
 *   CODE 1,2,3,4,...
 * Groupe par code pays extrait de l'ID, ignore les IDs sans chiffre (extras)
 */
function buildExportText(items) {
  const byCode = {};
  items.forEach(s => {
    const match = s.id.match(/^([A-Za-z]+)(\d+)$/);
    if (!match) return; // on ignore les IDs sans numéro (ex: LM, JD)
    const code = match[1];
    const num = parseInt(match[2]);
    if (!byCode[code]) byCode[code] = new Set();
    byCode[code].add(num);
  });

  const lines = Object.keys(byCode)
    .sort((a, b) => a.localeCompare(b))
    .map(code => {
      const nums = Array.from(byCode[code]).sort((a, b) => a - b);
      return `${code} ${nums.join(',')}`;
    });
  return lines.join('\n');
}