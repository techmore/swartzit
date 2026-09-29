# Resumable X bookmark transfer

The browser and operator CLI share `apps/web/src/lib/bookmark-import.mjs`.
The workflow checks the destination account before writes, reuses existing
source copies and folders, uses at most three concurrent workers by default,
retries temporary HTTP failures twice, and reports each failed item. Imported
posts may be public; saved bookmarks remain private.

## From an archive

```sh
node scripts/import-x-bookmarks.mjs --file /path/bookmarks.js --account techmore
```

This previews the import without writing. Named folder mapping is optional.
Multiple `--file` arguments combine archive parts and deduplicate IDs.

## From a signed-in browser capture

Capture only bookmark timeline response bodies delivered while browsing X.
Do not save request headers or cookies. Store personal capture files outside
Git. The normalizer checks public author status, prefers full note text, keeps
trusted image/MP4 attachments and quoted text, and reports protected/unavailable
sources instead of publishing them. X-sensitive records are imported with the
X content rating; this keeps them out of default General-only buddy feeds.

```sh
node scripts/prepare-bookmark-transfer.mjs \
  --capture-dir /private/captures --output /private/transfer.json
node scripts/import-x-bookmarks.mjs --file /private/transfer.json --account techmore
```

Capture pages must be named `bookmarks-*.json`. Timestamps come from each file's
capture time. The preparation report includes page counts and whether X
returned a timeline termination marker. A capture without that evidence must
not be described as a complete source export.

## Apply and resume

Use a private file containing the existing authenticated Swartzit session,
never a token in arguments or logs. The owner must match `--account`.

```sh
node scripts/import-x-bookmarks.mjs \
  --file /private/transfer.json --account techmore \
  --session-file /private/swartzit.session --receipt /private/receipt.json --apply
```

Session files must have mode 600. The receipt uses a fingerprint of input IDs,
folder paths, account, site and destination, and is atomically checkpointed
with mode 600 after each bookmark save. Rerun the same command to resume. Saved
receipts are checked against the account's current bookmark rows in groups of
100 before skipping them. Failed items produce a nonzero exit and remain in
the receipt. Deleted or moved bookmarks are restored to the requested import
destination on a resume. Use a new receipt for a different manifest/destination.

## Full text and context

Public link imports prefer long-form text, include available parent posts
(up to eight) and nested quotes, and reject missing long-form text instead of
silently saving its preview. Related reads are cached within the import and
share a 25-second budget. Source bodies are bounded to 250 KB; text beyond that
limit is reported rather than truncated. The detail view renders thread and
quote context separately. Source platforms may withhold or remove context,
so an import cannot promise every reply in a conversation.
