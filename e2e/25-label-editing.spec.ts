import { test } from './support/journey';
import { intermediateLayerJourney, labelPositionJourney } from './support/label-editing';

test('drag connector labels and save their positions', async ({ page, app, ev }) => {
  await labelPositionJourney(page, app, ev);
});

test('arrange a label between other elements', async ({ page, app, ev }) => {
  await intermediateLayerJourney(page, app, ev);
});
