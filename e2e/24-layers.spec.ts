import { test } from './support/journey';
import { layerJourney } from './support/layers';

test('arrange nodes and connector labels in front or behind', async ({ page, app, ev }) => {
  await layerJourney(page, app, ev);
});
