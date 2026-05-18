/**
 * Metaphone phonetic encoder — Lawrence Philips' original Metaphone algorithm.
 *
 * Produces a code that captures roughly how an English word sounds, so two
 * different spellings of the same sound collapse to the same key
 * (e.g. "rite" and "right" → "RT"). We use it to re-rank spelling suggestions
 * so sound-alikes float to the top — a poet typing "kuet" likely meant "cute",
 * not "quiet", even though they share an edit distance.
 */

const VOWELS = "AEIOU";

function isVowel(ch: string): boolean {
  return VOWELS.includes(ch);
}

export function metaphone(input: string): string {
  if (!input) return "";
  const word = input.toUpperCase().replace(/[^A-Z]/g, "");
  if (!word) return "";
  const n = word.length;

  let i = 0;
  // Strip silent letters at start: AE-, GN-, KN-, PN-, WR-, X- → S, WH- → W.
  if (n >= 2) {
    const start = word.slice(0, 2);
    if (start === "AE" || start === "GN" || start === "KN" || start === "PN" || start === "WR") {
      i = 1;
    } else if (word[0] === "X") {
      // X at start sounds like S.
      return "S" + metaphone(word.slice(1));
    } else if (start === "WH") {
      // WH-> W (drop the H).
      return "W" + metaphone(word.slice(2));
    }
  }

  let out = "";
  for (; i < n; i++) {
    const c = word[i]!;
    const prev = i > 0 ? word[i - 1]! : "";
    const next = i + 1 < n ? word[i + 1]! : "";
    const next2 = i + 2 < n ? word[i + 2]! : "";

    // Skip duplicate consecutive letters (except C).
    if (c === prev && c !== "C") continue;

    if (isVowel(c)) {
      if (i === 0) out += c;
      continue;
    }

    switch (c) {
      case "B":
        // Silent B at end after M (e.g. "dumb").
        if (i === n - 1 && prev === "M") break;
        out += "B";
        break;
      case "C":
        if (next === "I" && next2 === "A") out += "X"; // -CIA-
        else if (next === "H") out += "X"; // CH
        else if (next === "I" || next === "E" || next === "Y") out += "S";
        else out += "K";
        break;
      case "D":
        if (next === "G" && (next2 === "E" || next2 === "I" || next2 === "Y")) {
          out += "J";
          i++; // consume the G
        } else {
          out += "T";
        }
        break;
      case "F":
        out += "F";
        break;
      case "G":
        if (next === "H") {
          if (i + 2 >= n || !isVowel(next2)) {
            // silent GH (e.g. "right", "though")
          } else {
            out += "F"; // "rough"
          }
          i++;
        } else if (next === "N") {
          if (i + 2 === n) {
            // Silent at end like "sign"
          } else {
            out += "K";
          }
        } else if (next === "E" || next === "I" || next === "Y") {
          out += "J";
        } else {
          out += "K";
        }
        break;
      case "H":
        if (i > 0 && !isVowel(next) && isVowel(prev)) break; // silent H
        out += "H";
        break;
      case "J":
        out += "J";
        break;
      case "K":
        if (prev !== "C") out += "K"; // silent K after C
        break;
      case "L":
        out += "L";
        break;
      case "M":
        out += "M";
        break;
      case "N":
        out += "N";
        break;
      case "P":
        if (next === "H") {
          out += "F";
          i++;
        } else {
          out += "P";
        }
        break;
      case "Q":
        out += "K";
        break;
      case "R":
        out += "R";
        break;
      case "S":
        if (next === "H") {
          out += "X";
          i++;
        } else if (next === "I" && (next2 === "O" || next2 === "A")) {
          out += "X";
        } else {
          out += "S";
        }
        break;
      case "T":
        if (next === "H") {
          out += "0"; // theta-sound stand-in
          i++;
        } else if (next === "I" && (next2 === "O" || next2 === "A")) {
          out += "X";
        } else {
          out += "T";
        }
        break;
      case "V":
        out += "F";
        break;
      case "W":
      case "Y":
        if (isVowel(next)) out += c;
        break;
      case "X":
        out += "KS";
        break;
      case "Z":
        out += "S";
        break;
      default:
        break;
    }
  }
  return out;
}

/**
 * Quick agreement score between two metaphone codes, in [0, 1].
 * 1.0 = identical, 0.0 = nothing in common.
 *
 * Uses longest-common-prefix length over max length — cheap and good enough
 * for ranking 5–10 candidates per word.
 */
export function phoneticSimilarity(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  if (a === b) return 1;
  const max = Math.max(a.length, b.length);
  let prefix = 0;
  const minLen = Math.min(a.length, b.length);
  while (prefix < minLen && a[prefix] === b[prefix]) prefix++;
  return prefix / max;
}
