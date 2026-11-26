# Nexvary Research Intelligence

A bilingual research workspace preview for Arabic and English. It runs locally after checkout. The public dashboard shows labeled synthetic examples.

## Run locally

With Node.js 24.16 or newer:

```sh
npm start
npm test
```

Open [the local dashboard](http://127.0.0.1:3000/). English is available from the top bar. The server binds to loopback and accepts a different local port through `PORT`.

## Use the local research workspace

1. Run `npm run account:create -- researcher@example.org` in the same directory as `npm start`.
2. Save the generated password shown in your terminal. Open **Research workspace** and sign in with that email and password.
3. Create a project and open its detail page to edit or delete it. Each local account has its own project list.

Credentials, sessions and projects persist in `.nri/workspace.sqlite`. The account command and server both accept `NRI_DB_PATH` to select another database file. Store custom database paths outside the repository.

## Use private PDF versions

Open a project, select **Private PDFs**, and upload a PDF up to 8 MiB. Open the file history to download an existing version or upload the next one. Deleting a file removes all its versions. Deleting a project also removes its files.

NRI creates a 32-byte key in `<database path>.key` and encrypts PDF bytes in SQLite. File names, version dates, sizes and project metadata are stored in plaintext. Preserve both the database and its key for recovery. The preview runs on loopback for development with synthetic data. See the [document architecture decision](docs/decisions/0003-private-pdf-versions.md).

## Check references and researcher identifiers

Open **Reference validator**, choose a project, and enter a DOI or a DOI link. Choose Crossref or OpenAlex for DOI comparison, Zenodo for a published record with a Zenodo-issued DOI, or ORCID for the public name associated with an ORCID iD. An ORCID lookup does not authenticate the researcher or link an account. NRI saves the result, provider link and retrieval time in that project. Each result can be checked again or removed from the project.

The public APIs are used on demand without a paid API key. The request contains the identifier, with no project or document contents. A successful result can be reused from the local account cache for up to 24 hours. A missing result is specific to the selected provider. Save both results to compare their metadata and provenance. See the [reference architecture decision](docs/decisions/0004-crossref-reference-provenance.md).

- [Product charter](docs/PROJECT.md)
- [Functional acceptance baseline](docs/REQUIREMENTS.md)
- [Visual reference](docs/VISUAL.md)
- [Development status](docs/STATUS.md)
