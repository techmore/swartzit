import { dailyReading, describePassages, chapterPath } from './books.mjs';
import { passageTracks } from './audio.mjs';

export const isoDate = date => new Date(date).toISOString().slice(0, 10);

/** Parse YYYY-MM-DD as a UTC calendar day, or return null. */
export function parseDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || isoDate(date) !== value ? null : date;
}

/** "Ezekiel 19–20" as one link to its first chapter. */
function groupPassages(list) {
  const groups = [];
  for (const passage of list) {
    const last = groups.at(-1);
    if (last && last.book === passage.book && last.to === passage.chapter - 1) last.to = passage.chapter;
    else groups.push({ book: passage.book, from: passage.chapter, to: passage.chapter });
  }
  return groups.map(g => ({ label: describePassages(Array.from({ length: g.to - g.from + 1 }, (_, i) => ({ book: g.book, chapter: g.from + i }))), href: chapterPath(g.book, g.from) }));
}

/** The plan for one day, ready for a page or a feed post. */
export function readingFor(date) {
  const plan = dailyReading(date);
  const passages = [...plan.old, ...plan.psalm, ...plan.new];
  return {
    date: isoDate(date),
    day: plan.day,
    summary: describePassages(passages),
    passages,
    sections: [
      ['Old Testament', plan.old],
      ['Psalm', plan.psalm],
      ['New Testament', plan.new]
    ].map(([label, list]) => ({ label, passages: groupPassages(list) })),
    tracks: passageTracks(passages)
  };
}
