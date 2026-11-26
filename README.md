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

Credentials, sessions and projects persist in `.nri/workspace.sqlite`. The account command and server both accept `NRI_DB_PATH` to select another file. The preview stores project metadata in local SQLite and is intended for synthetic data during development. See the [workspace architecture decision](docs/decisions/0002-local-private-workspace.md) for the scope of this release.

- [Product charter](docs/PROJECT.md)
- [Functional acceptance baseline](docs/REQUIREMENTS.md)
- [Visual reference](docs/VISUAL.md)
- [Development status](docs/STATUS.md)
