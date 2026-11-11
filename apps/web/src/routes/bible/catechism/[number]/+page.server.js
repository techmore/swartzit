import { error } from '@sveltejs/kit';
import catechism from '#lib/bible/westminster-shorter-catechism.json' with { type: 'json' };

export function load({ params }) {
  const number = Number(params.number);
  const index = catechism.questions.findIndex(q => q.number === number);
  if (index < 0 || String(number) !== params.number) error(404, 'No such question');
  return {
    question: catechism.questions[index],
    previous: catechism.questions[index - 1]?.number ?? null,
    next: catechism.questions[index + 1]?.number ?? null,
    total: catechism.questions.length
  };
}
