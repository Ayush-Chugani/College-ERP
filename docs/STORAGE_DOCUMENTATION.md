# Storage documentation

Scope today: **student documents** (migration 042). Employee documents, certificate requests, announcement attachments and activity evidence have schema (`file_object` and link tables) but no upload workflow yet (KI-53).

## Bucket
| Item | Value |
|---|---|
| Bucket | `sims-documents`, **private** (`public = false`) |
| Size limit | 10 MB (10485760 bytes), enforced by the bucket and again by `student_document_register` |
| Types | `application/pdf`, `image/jpeg`, `image/png`; the file name must end with the extension of its declared type |
| Created by | migration 042 (`INSERT ... ON CONFLICT DO UPDATE` resets visibility and limits if someone changed them) |

## Object keys
`student/<student_id>/<random-uuid>-<safe file name>`. The browser builds the key (`storageKey()` in `src/lib/document-validation.ts`); the database accepts only keys of that shape (`sims_private.doc_student_id`) and only when the id equals the student being registered.

## Policies on `storage.objects` (bucket `sims-documents`)
| Operation | Allowed when |
|---|---|
| SELECT | the key belongs to the caller's own student record, or the caller holds `DOCUMENT.ALL.READ` at that student's scope |
| INSERT | the key belongs to the caller's own student record, or the caller holds `DOCUMENT.ALL.CREATE` at that student's scope |
| DELETE | as INSERT **and** no `file_object` row refers to the key (an orphan from a failed registration or from `student_document_delete`) |
| UPDATE | never (no policy) |

Anonymous callers have no policy and therefore no access.

## Upload flow
1. The browser validates the file (`checkFile`), uploads it to `sims-documents` under its key.
2. It calls `student_document_register(...)`, which re-validates everything, checks that the object exists (and that its recorded size matches), then writes `file_object` and a `PENDING` `student_document` in one transaction.
3. If step 2 fails the browser removes the object it just uploaded (allowed by the orphan rule). A crash between 1 and 2 leaves an orphan; there is no cleanup job yet (KI-53).

## Download flow
1. `student_document_download_info(id)` checks the caller (owner or `DOCUMENT.ALL.READ`), **writes an `activity_audit` row (`DOCUMENT` / `DOWNLOAD`)** and returns the key.
2. The browser asks Storage for a **60-second signed URL** for that key (this is subject to the SELECT policy as well) and opens it in a new tab with `noopener,noreferrer`.

## Review and delete
`student_document_review` (needs `DOCUMENT.ALL.VERIFY`; PENDING to VERIFIED or REJECTED, rejection needs remarks) and `student_document_delete` (owner or `DOCUMENT.ALL.DELETE`; never a VERIFIED document; returns the key so the caller can remove the now-orphaned object). Both are audited (`trg_student_document_audit`, `trg_file_object_audit`).

## Not covered
Virus scanning, per-document confidentiality other than `CONFIDENTIAL`, versioning of replaced files, retention and purge rules, image thumbnails, and any cleanup of orphans. After `supabase db push` check Dashboard > Storage that the bucket is private and the three policies exist.
