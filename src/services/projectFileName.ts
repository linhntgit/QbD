/** Produce a portable JSON filename from the editable project title. */
export function projectFileName(name: string): string {
  const safeName = [...name.trim().replace(/\.json$/i, '').replace(/[<>:"/\\|?*]/g, '_')]
    .map((character) => character.charCodeAt(0) < 32 ? '_' : character).join('');
  const base = safeName.replace(/[. ]+$/g, '').slice(0, 120) || 'Untitled project';
  return `${base}.json`;
}
