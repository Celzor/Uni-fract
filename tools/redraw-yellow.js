// Compatibility command for regenerating only the original dark-ochre faces.
import { redrawCards } from './redraw-cards.js';

console.log(`Redrew all ${await redrawCards({ colors: ['y'], wilds: false })} yellow faces in dark ochre.`);
