import levenshtein from "js-levenshtein";

const generateVariants = (base) => {
  const numbers = ["", "4589", "45896", "06", "006", "69"];
  const suffixes = ["", "jr", "zjr", "jrz"];
  const leetReplacements = {
    a: ["a", "@", "4"],
    o: ["o", "0"],
    i: ["i", "1", "l", "!"],
    e: ["e", "3"],
    s: ["s", "5", "$"],
    z: ["z", "2"],
  };

  const leetify = (str) => {
    let results = [str];
    Object.entries(leetReplacements).forEach(([char, subs]) => {
      const newResults = [];
      results.forEach((r) => {
        subs.forEach((sub) => newResults.push(r.replaceAll(char, sub)));
      });
      results = Array.from(new Set(newResults));
    });
    return results;
  };

  const variants = new Set();
  numbers.forEach((num) => {
    suffixes.forEach((suffix) => {
      const baseCombo = `${base}${suffix}${num}`;
      leetify(baseCombo).forEach((v) => variants.add(v));
    });
  });

  return Array.from(variants);
};

const baseNames = [
  "omar",
  "omarz",
  "omarjr",
  "omarzjr",
  "zomar",
  "zumar",
  "zumaya",
  "omarzumaya",
  "zumayaomar",
  "oz",
  "ozjr",
  "omarjsdev",
  "omarjs.dev",
  "omardev",
  "donomar",
];

export const normalizeUsername = (u) => (u || "").trim().toLowerCase();

const customOmarVariants = baseNames.flatMap(generateVariants);

const systemReserved = new Set([
  "admin",
  "support",
  "system",
  "music",
  "mod",
  "moderator",
  "staff",
  "owner",
  "god",
  "lord",
  "jesus",
  "allah",
  "yahweh",
  "lucifer",
  "satan",
  "devil",
  "demon",
  "hitler",
  "nazi",
  "fuck",
  "shit",
  "bitch",
  "asshole",
  "cunt",
  "nigger",
  "fag",
  "dyke",
  "whore",
  "slut",
  "penis",
  "vagina",
  "dick",
  "pussy",
  "cock",
  "balls",
  "rape",
  "rapist",
  "gay",
]);

export const RESERVED = new Set([...systemReserved, ...customOmarVariants]);

const looksLikeReserved = (u) => {
  const normalized = normalizeUsername(u)
    .replace(/[0o]/g, "o")
    .replace(/[1l!]/g, "i");

  for (const word of customOmarVariants) {
    const dist = levenshtein(normalized, word);
    const lenDiff = Math.abs(normalized.length - word.length);

    // if it's basically the same word (super short ones)
    if (normalized.length <= 5 && dist <= 2) return true;

    // if it's long, only block if it's almost identical or exact variant
    if (normalized.startsWith(word) && dist <= 1 && lenDiff <= 1) return true;
  }

  return false;
};


export const isUsernameAllowed = (u) => {
  const n = (u || "").trim().toLowerCase();
  if (n.length < 3 || n.length > 20) return false;
  if (!/^[a-z0-9_@!$]+$/.test(n)) return false;
  if (n.startsWith("_") || n.endsWith("_")) return false;

  // only block exact match against systemReserved (not custom variants)
  if (systemReserved.has(n)) return false;

  // fuzzy check against your Omar variants
  if (looksLikeReserved(n)) return false;

  return true;
};

export const normalizeEmail = (e) => (e || "").trim().toLowerCase();
