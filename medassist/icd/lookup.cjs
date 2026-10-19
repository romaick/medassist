"use strict";

function createLookup(catalog) {
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    throw new TypeError("ICD catalog must be an object");
  }
  if (!catalog.metadata || typeof catalog.metadata !== "object" || Array.isArray(catalog.metadata)) {
    throw new TypeError("ICD catalog metadata must be an object");
  }
  const metadata = {};
  for (const key of ["classification", "release", "publisher", "sourceUrl", "checkedAt", "note"]) {
    const value = catalog.metadata[key];
    if (typeof value !== "string" || (key !== "note" && !value.trim())) {
      throw new TypeError(`ICD catalog metadata.${key} must be a${key === "note" ? "" : " non-empty"} string`);
    }
    metadata[key] = value;
  }
  Object.freeze(metadata);
  if (!Array.isArray(catalog.entries)) throw new TypeError("ICD catalog entries must be an array");

  function normalize(value) {
    return value.normalize("NFKC").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
  }
  function words(value) {
    return value.match(/[a-zа-я0-9]+(?:\.[0-9]+[a-z]?)?/g) || [];
  }
  function stem(value) {
    const shortened = value.replace(/(?:ыми|ими|ого|его|ому|ему|ый|ий|ой|ая|яя|ое|ее|ые|ие|ых|их|ую|юю|ым|им|ом|ем)$/, "");
    return shortened.length >= 3 ? shortened : value;
  }

  const codes = new Set();
  const indexed = catalog.entries.map((source, index) => {
    const label = `ICD catalog entry ${index}`;
    if (!source || typeof source !== "object" || Array.isArray(source)) throw new TypeError(`${label} must be an object`);
    if (typeof source.code !== "string" || !/^[A-Z][0-9]{2}(?:\.[0-9]{1,4})?[A-Z]?$/.test(source.code)) {
      throw new TypeError(`${label} has an invalid code`);
    }
    if (codes.has(source.code)) throw new TypeError(`${label} has duplicate code ${source.code}`);
    codes.add(source.code);
    if (typeof source.title !== "string" || !source.title.trim()) throw new TypeError(`${label} must have a non-empty title`);
    if (source.kind !== "category" && source.kind !== "subcategory") throw new TypeError(`${label} has an invalid kind`);
    if ((source.kind === "subcategory") !== source.code.includes(".")) throw new TypeError(`${label} kind does not match its code`);
    if (source.aliases !== undefined && (!Array.isArray(source.aliases) || source.aliases.some(alias => typeof alias !== "string" || !alias.trim()))) {
      throw new TypeError(`${label} aliases must be non-empty strings`);
    }
    if (source.parent !== undefined && (!source.parent || typeof source.parent !== "object" || Array.isArray(source.parent) ||
      typeof source.parent.code !== "string" || !source.parent.code.trim() || typeof source.parent.title !== "string" || !source.parent.title.trim())) {
      throw new TypeError(`${label} parent must contain non-empty code and title strings`);
    }
    const entry = {code: source.code, title: source.title, kind: source.kind};
    if (source.aliases !== undefined) entry.aliases = Object.freeze([...source.aliases]);
    if (source.parent !== undefined) entry.parent = Object.freeze({code: source.parent.code, title: source.parent.title});
    Object.freeze(entry);
    const title = normalize(entry.title);
    const aliases = (entry.aliases || []).map(normalize);
    const tokens = [...new Set([title, ...aliases].flatMap(words))];
    return {entry, code: entry.code.toLowerCase(), title, aliases, phrases: [title, ...aliases].map(value => ` ${words(value).join(" ")} `), tokens, stems: tokens.map(stem)};
  });
  const empty = Object.freeze({items: Object.freeze([]), total: 0});

  function search(query, limit = 20) {
    if (typeof query !== "string") throw new TypeError("ICD search query must be a string");
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError("ICD search limit must be a positive integer");
    const count = Math.min(limit, 50);
    const normalized = normalize(query);
    const terms = words(normalized);
    if (terms.join("").replace(/\./g, "").length < 2) return empty;
    const stems = terms.map(stem);
    const codePattern = /^[a-z][0-9]{1,2}(?:\.[0-9]{0,4})?[a-z]?$/;
    const codeQuery = codePattern.test(normalized) ? normalized : terms.length === 1 && codePattern.test(terms[0]) ? terms[0] : null;
    const phrase = ` ${terms.join(" ")} `;
    const matches = [];
    for (const item of indexed) {
      if (codeQuery && !item.code.startsWith(codeQuery)) continue;
      const literal = terms.every(term => item.code.startsWith(term) || item.tokens.some(token => token.startsWith(term)));
      if (!literal && !terms.every((term, i) => item.code.startsWith(term) || item.tokens.some(token => token.startsWith(term)) || item.stems.some(token => token.startsWith(stems[i])))) continue;
      let rank;
      if (item.code === (codeQuery || normalized)) rank = 0;
      else if (item.title === normalized) rank = 1;
      else if (item.aliases.includes(normalized)) rank = 2;
      else if (item.phrases[0].includes(phrase)) rank = 3;
      else if (item.phrases.slice(1).some(value => value.includes(phrase))) rank = 4;
      else if (item.code.startsWith(normalized)) rank = 5;
      else rank = literal ? 6 : 7;
      matches.push({entry: item.entry, rank});
    }
    matches.sort((a, b) => a.rank - b.rank || (a.entry.code < b.entry.code ? -1 : a.entry.code > b.entry.code ? 1 : 0));
    return Object.freeze({items: Object.freeze(matches.slice(0, count).map(item => item.entry)), total: matches.length});
  }

  return Object.freeze({metadata, size: indexed.length, search});
}

module.exports = createLookup;
