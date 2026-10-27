// Stvarni oblik izlaza Artifact list (80 stavki), za provjeru crtanja velike biblioteke.
const titles = ['Plan projekta', 'Mockupi aplikacije — v2', 'ZASTARJELO · šema ploče', 'Dizajner izvještaja – redizajn', 'Gripper za robota', 'Simulacija osa — robot', 'Ćelija Konfiguracija', 'Noćni rad 9. 10.']
export const LIBRARY_TEXT = [
  '80 published artifacts (most recently opened or updated first):',
  ...Array.from({ length: 80 }, (_, i) => `- (mine${i % 7 === 0 ? ', pinned' : ''}) ${titles[i % titles.length]} — https://claude.ai/artifact/Lib${String(i).padStart(4, '0')}xyz — updated 2026-10-${String((i % 27) + 1).padStart(2, '0')}`),
].join('\n')
