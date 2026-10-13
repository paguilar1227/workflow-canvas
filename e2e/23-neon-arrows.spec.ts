import { test } from './support/journey';
import { neonArrowJourney } from './support/neon-arrows';

test('Neon Flow preserves connector arrow settings', async ({ page, app, ev }) => {
  await neonArrowJourney(page, app, ev);
});
