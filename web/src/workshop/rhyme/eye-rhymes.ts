/**
 * Eye-rhyme detection: spellings that *look* like they rhyme but fall into
 * different pronunciation groups. Used to flag clusters where the spelling
 * collapses would otherwise miss the mismatch (love/move, said/maid, etc.).
 *
 * Each row lists words that genuinely rhyme together. A cluster spanning
 * multiple incompatible rows (no shared row) is flagged as an eye-rhyme.
 */
const EYE_RHYME_CLASSES: string[][] = [
  ["love", "dove", "glove", "shove", "above", "of"],
  ["move", "prove", "groove", "improve", "approve", "remove", "lose", "whose"],
  ["stove", "drove", "hove", "rove", "wove", "clove", "cove", "grove", "strove"],

  ["rough", "tough", "enough", "slough", "bluff", "huff", "puff", "stuff"],
  ["though", "although", "dough", "doe"],
  ["through", "blue", "true"],
  ["cough", "trough", "off", "soft"],
  ["bough", "plough", "now", "how"],
  ["ought", "bought", "brought", "fought", "sought", "thought", "wrought", "nought", "naught", "caught", "taught"],

  ["bread", "dead", "head", "spread", "thread", "tread", "stead", "said", "fled", "led"],
  ["bead", "knead", "plead", "deed", "feed", "seed", "indeed"],

  ["bear", "wear", "swear", "tear", "pear", "their", "there", "where"],
  ["hear", "near", "dear", "fear", "year", "rear", "clear", "spear", "here", "appear"],

  ["wind"],
  ["find", "kind", "mind", "behind", "blind", "rind", "grind", "hind", "remind", "signed", "lined"],

  ["host", "most", "post", "ghost", "boast", "roast", "toast", "coast", "almost"],
  ["lost", "cost", "frost", "tossed"],

  ["bow", "cow", "how", "now", "vow", "wow", "plow", "brow", "allow", "endow"],
  ["low", "row", "show", "blow", "flow", "glow", "grow", "know", "mow", "slow", "snow", "stow", "tow", "throw", "below"],

  ["one", "done", "gone", "none", "shone", "son", "sun", "won", "ton", "fun", "run"],
  ["bone", "cone", "stone", "tone", "phone", "throne", "zone", "alone", "shown", "known"],

  ["could", "would", "should", "good", "hood", "stood", "wood"],
  ["mould", "moulded"],

  ["maid", "paid", "laid", "afraid", "braid", "raid", "made", "shade", "trade"],

  ["come", "some", "from", "dumb", "sum", "numb"],
  ["home", "dome", "roam", "foam", "comb", "tome"],

  ["heart", "art", "part", "start", "cart", "smart"],
  ["earth", "birth", "worth", "mirth"],
];

const WORD_TO_CLASS = new Map<string, number[]>();
for (let i = 0; i < EYE_RHYME_CLASSES.length; i++) {
  for (const w of EYE_RHYME_CLASSES[i]!) {
    const arr = WORD_TO_CLASS.get(w) ?? [];
    arr.push(i);
    WORD_TO_CLASS.set(w, arr);
  }
}

function classify(word: string): number[] | null {
  const w = word.toLowerCase().trim();
  return WORD_TO_CLASS.get(w) ?? null;
}

/**
 * True when at least one pair in the cluster lives in incompatible
 * pronunciation classes (i.e. they look like a rhyme but don't sound like one).
 * Unknown words are skipped — only words present in the table participate.
 */
export function isEyeRhymeCluster(words: string[]): boolean {
  const classified: number[][] = [];
  for (const w of words) {
    const c = classify(w);
    if (c) classified.push(c);
  }
  if (classified.length < 2) return false;
  for (let i = 0; i < classified.length; i++) {
    for (let j = i + 1; j < classified.length; j++) {
      const a = classified[i]!;
      const b = classified[j]!;
      const shared = a.some((g) => b.includes(g));
      if (!shared) return true;
    }
  }
  return false;
}
