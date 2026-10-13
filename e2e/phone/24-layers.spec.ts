import { test } from '../support/journey';
import { layerJourney } from '../support/layers';

test('arrange nodes and connector labels in front or behind', async ({ page, app, ev, phone }) => {
  await layerJourney(page, app, ev, phone);
  await phone.ergonomics('arranged connector labels');
});
