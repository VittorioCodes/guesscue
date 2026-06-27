import { CATEGORIES } from '../constants/categories.js';

function dataUrl(languageId, dataFile, cacheBust = false) {
  const base = import.meta.env.BASE_URL || '/';
  const url = `${base}data/${languageId}/${dataFile}`;
  return cacheBust ? `${url}?v=${Date.now()}` : url;
}

export async function loadCards(languageId, categoryId) {
  const category = CATEGORIES.find((item) => item.id === categoryId);
  if (!category) throw new Error('Kategori bulunamadı.');
  const url = dataUrl(languageId, category.dataFile);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Kart dosyası yüklenemedi: ${url}`);
  const cards = await response.json();
  if (!Array.isArray(cards) || cards.length === 0) throw new Error('Bu kategori için kart paketi boş.');
  return cards;
}

export async function loadCategoryCounts(languageId) {
  const entries = await Promise.all(CATEGORIES.map(async (category) => {
    try {
      const response = await fetch(dataUrl(languageId, category.dataFile, true), { cache: 'no-store' });
      if (!response.ok) return [category.id, 0];
      const cards = await response.json();
      return [category.id, Array.isArray(cards) ? cards.length : 0];
    } catch {
      return [category.id, 0];
    }
  }));
  return Object.fromEntries(entries);
}
