// tags.js: the tags the systems query. System-free, as IWSDK requires; registered with IWSDK by
// components.js (iwsdk.config.json's "components" module).
import { createComponent, Types } from '@iwsdk/core';

// A lane pad on the altar (lane 0..2 from the player's left): touch a card to it.
export const Pad = createComponent('Pad', { lane: { type: Types.Int8, default: 0 } });
// A card in the person's hand: `slot` indexes the hand array from table.hand().
export const HandCard = createComponent('HandCard', { slot: { type: Types.Int16, default: -1 } });
// The deck's top card (draw: touch it to any pad).
export const DeckTop = createComponent('DeckTop', {});
// The person's castle card (pass; twice within 3 s in the mulligan window = mulligan).
export const CastleCard = createComponent('CastleCard', {});
// A prompt tile over the altar: one of a spell's targets, by index into the prompt's options.
export const PromptTile = createComponent('PromptTile', { option: { type: Types.Int16, default: -1 } });
// A unit on the board that a spell may target: the raw target byte (seat << 4 | lane << 2 | cell).
export const TargetUnit = createComponent('TargetUnit', { target: { type: Types.Int16, default: -1 } });
