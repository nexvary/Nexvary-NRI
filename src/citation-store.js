import { createHash, randomUUID } from 'node:crypto';
import { normalizeDoi } from './crossref.js';

export const citationSchema = `
  CREATE TABLE IF NOT EXISTS citations (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE
  ) STRICT;
  CREATE INDEX IF NOT EXISTS citations_project ON citations(project_id);
  CREATE TABLE IF NOT EXISTS citation_sources (
    id INTEGER PRIMARY KEY, citation TEXT NOT NULL REFERENCES citations(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    fingerprint TEXT NOT NULL, doi TEXT, provider_key TEXT, title_key TEXT NOT NULL,
    origin TEXT NOT NULL CHECK(origin IN ('import','saved-reference')), received_at INTEGER NOT NULL, data TEXT NOT NULL,
    UNIQUE(project_id,fingerprint)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS citation_source_doi ON citation_sources(project_id,doi);
  CREATE INDEX IF NOT EXISTS citation_source_identifier ON citation_sources(project_id,provider_key);
  CREATE INDEX IF NOT EXISTS citation_source_citation ON citation_sources(citation,id);
  CREATE TABLE IF NOT EXISTS citation_merge_events (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    target TEXT NOT NULL, previous TEXT NOT NULL, recorded_at INTEGER NOT NULL
  ) STRICT;
  PRAGMA user_version = 23;
`;

const titleKey = (value) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const identifier = ({ provider, providerId }) =>
  /^[a-z0-9._ -]{2,60}$/.test(provider ?? '') && /^[^\p{C}]{1,512}$/u.test(providerId ?? '')
    ? provider + ':' + providerId : null;

export function citationStore(db, now, transact) {
  const owns = db.prepare('SELECT 1 FROM projects WHERE owner_id=? AND id=?');
  const create = db.prepare('INSERT INTO citations VALUES (?,?)');
  const source = db.prepare('INSERT INTO citation_sources VALUES (NULL,?,?,?,?,?,?,?,?,?)');
  const fingerprint = db.prepare('SELECT 1 FROM citation_sources WHERE project_id=? AND fingerprint=?');
  const match = db.prepare(`SELECT DISTINCT citation FROM citation_sources WHERE project_id=?
    AND (doi=? OR provider_key=?)`);
  const dois = db.prepare('SELECT DISTINCT doi FROM citation_sources WHERE citation=? AND doi IS NOT NULL');
  const get = db.prepare(`SELECT id FROM citations WHERE project_id=? AND id=?`);
  const move = db.prepare('UPDATE citation_sources SET citation=? WHERE project_id=? AND citation=?');
  const drop = db.prepare('DELETE FROM citations WHERE project_id=? AND id=?');
  const audit = db.prepare('INSERT INTO citation_merge_events VALUES (?,?,?,?)');
  const rows = db.prepare(`SELECT citation AS id, doi, provider_key, title_key, origin, received_at, data
    FROM citation_sources WHERE project_id=? ORDER BY CASE origin WHEN 'saved-reference' THEN 0 ELSE 1 END, citation_sources.id`);
  const count = db.prepare('SELECT count(*) AS total FROM citation_sources WHERE project_id=?');

  function groups(project) {
    const grouped = new Map();
    for (const row of rows.iterate(project)) {
      if (!grouped.has(row.id)) grouped.set(row.id, { id: row.id, sources: [] });
      grouped.get(row.id).sources.push({ ...row, data: JSON.parse(row.data) });
    }
    return [...grouped.values()];
  }

  return {
    list(owner, project) {
      return owns.get(owner,project) ? groups(project) : undefined;
    },
    add(owner, project, records, origin = 'import') {
      return transact(db, () => {
        if (!owns.get(owner,project)) return 404;
        if (records.length + count.get(project).total > 500) return 422;
        for (const record of records) {
          const raw = JSON.stringify(record);
          const hash = createHash('sha256').update(origin + '\0' + raw).digest('hex');
          if (fingerprint.get(project,hash)) continue;
          const providerKey = identifier(record);
          const matches = match.all(project,record.doi,providerKey);
          let id;
          if (matches.length === 1) {
            const candidate = matches[0].citation;
            if (!record.doi || dois.all(candidate).every(({doi}) => doi === record.doi)) id = candidate;
          }
          if (!id) {
            id = randomUUID();
            create.run(id,project);
          }
          source.run(id,project,hash,record.doi,providerKey,titleKey(record.title),origin,now(),raw);
        }
        return 303;
      });
    },
    merge(owner, project, target, previous) {
      return transact(db, () => {
        if (!owns.get(owner,project) || !get.get(project,target) || !get.get(project,previous) || target === previous) return 404;
        const identities = new Set([...dois.all(target),...dois.all(previous)].map(({doi}) => doi));
        if (identities.size > 1) return 409;
        move.run(target,project,previous);
        drop.run(project,previous);
        audit.run(project,target,previous,now());
        return 303;
      });
    },
  };
}

export function fromSavedReferences(records) {
  return records.filter((record) => record.status === 'found' && record.provider !== 'orcid' && record.metadata?.title)
    .map(({doi,provider,checkedAt,metadata}) => {
      const fields = { title: metadata.title, nri_retrieved_at: new Date(checkedAt).toISOString() };
      if (metadata.authors?.length) fields.author = metadata.authors.join(' and ');
      if (metadata.venue) fields.journal = metadata.venue;
      if (metadata.publisher) fields.publisher = metadata.publisher;
      if (metadata.issued) fields.year = String(metadata.issued).slice(0,4);
      const normalized = normalizeDoi(doi);
      if (normalized) fields.doi = normalized;
      return { format: 'bibtex', type: 'misc', key: 'saved', fields, title: metadata.title,
        doi: normalized, provider, providerId: doi, checkedAt, snapshot: metadata };
    });
}
