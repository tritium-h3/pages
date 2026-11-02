/** Random traits a voice card must work in, so pieces don't all collapse into
 *  the same few stock characters. Hand-written; add freely. */

export const TEMPERAMENTS = [
  'patient', 'easily embarrassed', 'quietly competitive', 'restless', 'dry and unimpressed',
  'anxious but dutiful', 'warm toward everyone', 'suspicious of plans', 'cheerfully fatalistic',
  'stubborn', 'eager to be useful', 'distracted', 'methodical', 'touchy about being overlooked',
  'gentle', 'impatient with hesitation',
];

export const PREOCCUPATIONS = [
  'keeping count of things', 'a grudge from earlier in the game', 'whether anyone noticed',
  'the piece standing next to it', 'getting things exactly right', 'how far it is from home',
  'what the other side is thinking', 'fairness', 'being the first to act', 'staying out of the way',
  'the shape of the board', 'an old promise to protect someone', 'what happens after the game',
  'its own reputation', 'small comforts', 'who is in charge',
];

export const HABITS = [
  'trails off mid-thought', 'addresses itself in the second person', 'asks itself questions',
  'counts things under its breath', 'understates everything', 'corrects itself',
  'thinks in very short sentences', 'narrates what it sees before what it feels',
  'returns to the same phrase', 'makes small dry jokes to itself', 'lists options, then ignores them',
  'is blunt', 'hedges', 'notices sounds and textures', 'speaks to absent friends', 'is precise about time',
];

export interface Seeds {
  temperament: string;
  preoccupation: string;
  habit: string;
}

const pick = (list: string[], rand: () => number) => list[Math.floor(rand() * list.length)];

export function drawSeeds(rand: () => number = Math.random): Seeds {
  return { temperament: pick(TEMPERAMENTS, rand), preoccupation: pick(PREOCCUPATIONS, rand), habit: pick(HABITS, rand) };
}
