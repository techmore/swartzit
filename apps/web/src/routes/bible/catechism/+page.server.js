import catechism from '#lib/bible/westminster-shorter-catechism.json' with { type: 'json' };

export function load() {
  return { questions: catechism.questions };
}
