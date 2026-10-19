import { test } from '../support/journey';
import { draftingJourney } from '../support/drafting';

test('drafting theme and connector controls', async ({ app, ev, phone }) => {
  await draftingJourney(app, ev, phone);
});
