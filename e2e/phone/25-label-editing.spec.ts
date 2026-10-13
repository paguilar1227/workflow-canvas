import { test } from '../support/journey';
import { intermediateLayerJourney, labelPositionJourney } from '../support/label-editing';

test('drag connector labels and save their positions', async ({ page, app, ev, phone }) => {
  await labelPositionJourney(page, app, ev, phone);
});

test('arrange a label between other elements', async ({ page, app, ev, phone }) => {
  await intermediateLayerJourney(page, app, ev, phone);
});
