import { normalizeDoi } from './crossref.js';

const names = { article: 'JOUR', book: 'BOOK', incollection: 'CHAP', inproceedings: 'CPAPER', phdthesis: 'THES', techreport: 'RPRT', misc: 'GEN' };
const tags = { title: 'TI', journal: 'JO', booktitle: 'T2', year: 'PY', volume: 'VL', number: 'IS', publisher: 'PB', doi: 'DO', url: 'UR', abstract: 'AB', issn: 'SN', note: 'N1' };
const reverse = Object.fromEntries(Object.entries(tags).map(([field, tag]) => [tag, field]));

function bibtex(input) {
  let i = 0;
  const records = [];
  const macros = new Map(['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
    .map((month, index) => [month, new Intl.DateTimeFormat('en', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, index)))]));
  function space() {
    while (i < input.length) {
      if (/\s/.test(input[i])) i++;
      else if (input[i] === '%') {
        while (i < input.length && input[i] !== '\n') i++;
      } else break;
    }
  }
  function word() {
    space();
    const value = /^[a-z0-9_:\-.]+/i.exec(input.slice(i))?.[0];
    if (!value) throw new SyntaxError('Expected BibTeX identifier');
    i += value.length;
    return value.toLowerCase();
  }
  function expect(character) {
    space();
    if (input[i++] !== character) throw new SyntaxError('Invalid BibTeX delimiter');
  }
  function group(end) {
    const start = i;
    let depth = 0;
    while (i < input.length) {
      const character = input[i++];
      if (character === '\\') { i++; continue; }
      if (character === end && depth === 0) return input.slice(start, i - 1);
      if (character === '{') depth++;
      if (character === '}') depth--;
      if (depth < 0) break;
    }
    throw new SyntaxError('Unbalanced BibTeX value');
  }
  function value() {
    let result = '';
    do {
      space();
      const start = input[i];
      if (start === '{' || start === '"') {
        i++;
        result += group(start === '{' ? '}' : '"');
      } else {
        const token = word();
        const expanded = /^\d+$/.test(token) ? token : macros.get(token);
        if (expanded === undefined) throw new SyntaxError('Undefined BibTeX abbreviation');
        result += expanded;
      }
      if (result.length > 16000) throw new SyntaxError('BibTeX field too long');
      space();
      if (input[i] !== '#') return result;
      i++;
    } while (i < input.length);
    throw new SyntaxError('Incomplete BibTeX value');
  }
  space();
  while (i < input.length) {
    expect('@');
    const type = word();
    space();
    const open = input[i++];
    if (!['{','('].includes(open)) throw new SyntaxError('Invalid BibTeX entry');
    const end = open === '{' ? '}' : ')';
    if (type === 'comment') group(end);
    else if (type === 'preamble') { value(); expect(end); }
    else if (type === 'string') {
      const key = word();
      expect('=');
      macros.set(key, value());
      if (input[i] === ',') i++;
      expect(end);
    } else {
      const key = input.slice(i).match(/^\s*([^\s,{}()]+)\s*,/)?.[1];
      if (!key) throw new SyntaxError('Missing BibTeX key');
      i = input.indexOf(',', i) + 1;
      const fields = Object.create(null);
      space();
      while (input[i] !== end) {
        const field = word();
        expect('=');
        fields[field] = value();
        if (input[i] === end) break;
        expect(',');
        space();
      }
      expect(end);
      records.push({ type, key, fields });
    }
    space();
  }
  return records;
}

function ris(input) {
  const records = [];
  let fields;
  let last;
  for (const line of input.split(/\r?\n/)) {
    const tag = /^([A-Z0-9]{2}) {2}-\s?(.*)$/.exec(line);
    if (!tag) {
      if (!line.trim()) continue;
      if (!fields || !last || !/^\s/.test(line)) throw new SyntaxError('Invalid RIS line');
      fields[last][fields[last].length - 1] += '\n' + line.trim();
      continue;
    }
    const [, key, value] = tag;
    if (key === 'TY') {
      if (fields || !value.trim()) throw new SyntaxError('Invalid RIS start');
      fields = Object.create(null);
    }
    if (!fields) throw new SyntaxError('Missing RIS start');
    if (key === 'ER') {
      records.push({ type: fields.TY[0], key: fields.ID?.[0] ?? '', fields });
      fields = undefined;
    } else (fields[key] ??= []).push(value);
    last = key;
  }
  if (fields) throw new SyntaxError('Missing RIS end');
  return records;
}

export function parseCitations(format, input) {
  if (!['bibtex','ris'].includes(format) || input.length > 80000) throw new SyntaxError('Invalid citation input');
  const records = (format === 'ris' ? ris : bibtex)(input.replace(/^\uFEFF/, ''));
  if (!records.length || records.length > 100) throw new SyntaxError('Citation count outside limit');
  return records.map((record) => {
    const f = record.fields;
    const title = format === 'ris' ? (f.TI ?? f.T1 ?? f.CT)?.[0] : f.title;
    const doi = normalizeDoi(format === 'ris' ? f.DO?.[0] ?? '' : f.doi ?? '');
    const provider = (format === 'ris' ? f.DB?.[0] : f.nri_provider)?.trim().toLowerCase();
    const providerId = (format === 'ris' ? f.AN?.[0] : f.nri_identifier)?.trim();
    if (!title?.trim() && !doi) throw new SyntaxError('Citation requires title or DOI');
    return { ...record, format, title: (title || doi).trim(), doi, provider, providerId };
  });
}

export function citationText(records, format) {
  return records.map((record, index) => {
    const f = record.fields;
    if (format === 'ris') {
      const values = record.format === 'ris' ? { ...f } : {
        TY: [names[record.type] ?? 'GEN'],
        ...Object.fromEntries(Object.entries(tags).filter(([field]) => f[field]).map(([field, tag]) => [tag, [f[field]]])),
        ...(f.author ? { AU: f.author.split(/\s+and\s+/i) } : {}),
        ...(f.pages ? { SP: [f.pages] } : {}),
      };
      if (record.provider && record.providerId) { values.DB = [record.provider]; values.AN = [record.providerId]; }
      const { TY, ...rest } = values;
      const line = (key, value) => key + '  - ' + String(value).replace(/[\r\n]+/g, '\n      ');
      return [line('TY', TY?.[0] ?? 'GEN'), ...Object.entries(rest).flatMap(([key, list]) => list.map((value) => line(key, value))), 'ER  - '].join('\n');
    }
    const fields = record.format === 'bibtex' ? { ...f } : {
      ...Object.fromEntries(Object.entries(f).filter(([tag]) => reverse[tag]).map(([tag, values]) => [reverse[tag], values[0]])),
      ...(f.AU || f.A1 ? { author: (f.AU ?? f.A1).join(' and ') } : {}),
      ...(f.SP ? { pages: f.SP[0] + (f.EP ? '--' + f.EP[0] : '') } : {}),
    };
    fields.title ||= record.title;
    if (record.provider && record.providerId) { fields.nri_provider = record.provider; fields.nri_identifier = record.providerId; }
    const type = record.format === 'bibtex' ? record.type : (Object.keys(names).find((key) => names[key] === record.type) ?? 'misc');
    const safeKey = record.key?.replace(/[^a-z0-9:._-]/gi, '') || 'citation';
    const safeValue = (value) => record.format === 'bibtex' && !record.snapshot ? value : value.replace(/[{}]/g, (c) => '\\' + c);
    return '@' + type + '{' + safeKey + '-' + (index + 1) + ',\n' +
      Object.entries(fields).map(([key,value]) => '  ' + key + ' = {' + safeValue(value) + '}').join(',\n') + '\n}';
  }).join('\n\n') + '\n';
}
