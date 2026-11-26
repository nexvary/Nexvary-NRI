# ADR 0003 · Private PDF versions

- Status: accepted for P1b
- Date: 2026-11-26

## Decision

Keep PDF bytes in SQLite with the document metadata so the initial upload, version append and deletion can each commit atomically. Bind every document to a project and every version to a document. Ownership filters cover lists and downloads. Writes validate ownership in their SQL transaction. Version numbers are allocated inside that transaction and prior versions are immutable. Deleting the project or document cascades to all affected versions.

Each file has a maximum size of 8 MiB. Check the filename extension and basic file signatures on the server. Bound multipart request size and read at most two uploads concurrently. Serve authorized downloads as attachments with no-store and nosniff. The preview does not parse PDF contents, perform malware scans, or validate all PDF structures. Private files are never sent to an external service.

Use AES-256-GCM with a random 96-bit nonce, a 128-bit tag and authenticated context containing the project, document and version identifiers. Generate the random key as an adjacent file on the first workspace open. Use owner-only permissions on newly created key files on POSIX systems. Record a fingerprint in SQLite and fail closed for missing or mismatched keys and unauthentic ciphertext. File names, timestamps, sizes and project metadata remain readable in SQLite.

## Recovery and remaining scope

The SQLite database and its matching key are both required for recovery. Encryption protects PDF bytes if the key is unavailable to the reader. A local account with access to both files can decrypt the PDF content. Key rotation, managed key storage, encrypted metadata, auditing, backup orchestration and production hosting remain future work.

## References

- [Node.js crypto API](https://nodejs.org/download/release/v24.22.2/docs/api/crypto.html)
- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
