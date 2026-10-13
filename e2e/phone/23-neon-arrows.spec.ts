import { test } from '../support/journey';
import { neonArrowJourney } from '../support/neon-arrows';

test('Neon Flow preserves connector arrow settings', async ({ page, app, ev, phone }) => {
  await neonArrowJourney(page, app, ev);
  await phone.ergonomics('Neon connector arrows');
});
