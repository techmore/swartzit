import { AUDIO_SOURCE } from '#lib/bible/audio.mjs';
import { readingFor } from '#lib/bible/reading.mjs';

export function load() {
  const { passages: _passages, ...today } = readingFor(new Date());
  return {
    today,
    audioSource: AUDIO_SOURCE
  };
}
