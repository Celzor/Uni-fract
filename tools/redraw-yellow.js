// Compatibility command for regenerating only the bright yellow faces.
import { redrawCards } from './redraw-cards.js';

console.log(`Redrew all ${await redrawCards({ colors: ['y'], wilds: false })} faces in bright yellow.`);
