# Nexvary Research Intelligence

A bilingual research workspace preview for Arabic and English. It runs locally after checkout. Sign in to see account-scoped project, PDF, reference and evidence counts.

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

## Browse the scientific library

The signed-in library searches private PDFs and saved reference records across your projects. Filter by record type and open the source project or PDF version history.

## Check references and researcher identifiers

Open **Reference validator**, choose a project, and enter a DOI or a DOI link. Choose Crossref or OpenAlex for DOI comparison, Zenodo for a published record with a Zenodo-issued DOI, or ORCID for the public name associated with an ORCID iD. An ORCID lookup does not authenticate the researcher or link an account. NRI saves the result, provider link and retrieval time in that project. Each result can be checked again or removed from the project.

The public APIs are used on demand without a paid API key. The request contains the identifier, with no project or document contents. A successful result can be reused from the local account cache for up to 24 hours. A missing result is specific to the selected provider. Save both results to compare their metadata and provenance. See the [reference architecture decision](docs/decisions/0004-crossref-reference-provenance.md).

## Enable PDF and DOCX report exports

Report Studio is optional. Install Python 3.10+, the WeasyPrint system libraries (Pango and font support), and the Noto Naskh Arabic and DejaVu Sans fonts for predictable bilingual PDF layout. In a local Python virtual environment, run:

```sh
python -m pip install -r scripts/report-requirements.txt
NRI_REPORT_PYTHON="$(command -v python)" npm start
NRI_REPORT_PYTHON="$(command -v python)" npm test
```

Open a project, choose **Report studio**, then select PDF or DOCX. The local renderer receives the selected project's report data and uses no network resources.

- [Local backup and recovery](docs/RECOVERY.md)
- [Product charter](docs/PROJECT.md)
- [Functional acceptance baseline](docs/REQUIREMENTS.md)
- [Visual reference](docs/VISUAL.md)
- [Development status](docs/STATUS.md)


### Optional local research answers

Offline source review works with no model or provider credentials. For local generation, start an existing loopback OpenAI-compatible server and set `NRI_LOCAL_AI_PORT` when starting NRI. In Assistant provider settings select Local and enter the server’s model ID. Open a project with saved reference metadata, select **Generate a research answer**, and submit a question. The request includes the question and displayed reference metadata. Use a local model that returns JSON in its chat completion content.

The answer identifies saved citations and flags unknown or missing citation IDs. Verify scientific claims against the original work. For external OpenAI answers, configure one Chat Completions model and all four limits and rates before starting NRI. These settings default to disabled.

| Environment variable | Value |
|---|---|
| `NRI_OPENAI_MODEL` | Exact OpenAI model ID |
| `NRI_OPENAI_INPUT_MICROUSD_PER_MILLION` | Input USD rate per million tokens, in millionths of a dollar |
| `NRI_OPENAI_OUTPUT_MICROUSD_PER_MILLION` | Output USD rate per million tokens, in millionths of a dollar |
| `NRI_OPENAI_DAILY_TOKENS` | Per-account aggregate daily token reservation ceiling |
| `NRI_OPENAI_DAILY_MICROUSD` | Per-account daily estimated spend ceiling, in millionths of a dollar |

Select OpenAI and the enabled model in provider settings and save an API key. Each request requires consent to share the question and displayed reference metadata. NRI estimates prompt tokens from UTF-8 bytes plus framing, reserves the maximum output allowance, and accounts for reported usage when available. Reservations count toward the daily ceiling even if usage is unavailable. Provider invoices depend on actual usage and pricing.


### Optional account MFA

From **Account security → Two-step verification**, confirm the current password, add the displayed key to a time-based authenticator, and confirm with a current six-digit code. Save the eight recovery codes shown during activation. Each code can be used once in place of an authenticator code during sign-in. Changing MFA signs out other active sessions. The existing workspace backup includes the encrypted seed and paired workspace key.


### Local message moderation

An operator with access to the workspace database can run `npm run account:role -- moderator@example.test grant-message-moderator`. The recipient sees **Message reports** under Account security and can review reported message text and record decisions. To revoke the role, run the same command with `revoke-message-moderator`. The role has no private conversation access.
