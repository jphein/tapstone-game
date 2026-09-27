// The components module iwsdk.config.json names: IWSDK's component manifest imports its default
// export (a build without it fails: "default is not exported by src/components.js").
import { defineComponents } from '@iwsdk/core';
import { CastleCard, DeckTop, HandCard, Pad, PromptTile, TargetUnit } from './tags.js';

export default defineComponents([Pad, HandCard, DeckTop, CastleCard, PromptTile, TargetUnit]);
