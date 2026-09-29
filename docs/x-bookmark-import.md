# Importing X bookmarks and folders

The signed-in Swartzit account owns the imported bookmarks and folders. The
import preview shows that account before writes begin. To import for
`u/techmore`, sign in as techmore and open `/bookmarks`.

X archive `bookmarks.js` / JSON files remain supported. A flat archive contains
post IDs rather than a folder tree. Swartzit does not invent folder names. To
preserve hierarchy, include a structured JSON file with the bookmark-to-folder
mapping. It can accompany a flat archive; named paths take precedence over
unfiled entries for the same post.

```json
{
  "format": "swartzit-x-bookmarks-v1",
  "folders": [
    {
      "name": "Research",
      "folders": [
        {
          "name": "Linux",
          "bookmarks": [{ "tweetId": "2104618999141061018" }]
        },
        { "name": "Read later" }
      ]
    }
  ]
}
```

Alternatively, supply `bookmarks` with `tweetId` and `folder_path` arrays:

```json
{
  "format": "swartzit-x-bookmarks-v1",
  "bookmarks": [
    { "tweetId": "2104618999141061018", "folder_path": ["Research", "Linux"] }
  ]
}
```

Folder paths are relative to the chosen destination folder. They can contain
up to 12 names, each 1–80 characters. The import supports up to 10,000 unique
bookmarks and 1,000 folder paths, with 20 MB of input files per batch. Existing
folders at the same path are reused, including when names differ only in case.
Empty named folders in a structured import are preserved if the import also
contains at least one bookmark.

A Swartzit bookmark belongs to one folder. An import that assigns the same post
to two distinct named paths fails before writing anything, so no source folder
is silently discarded. Folder IDs without paths are rejected instead of being
flattened. If an X export does not contain folder names/membership, the mapping
must be supplied separately; a flat archive alone cannot reconstruct it.

Existing Swartzit copies are bookmarked without another cross-post. Missing
public X posts are cross-posted publicly to `c/x_imports`; the bookmark and its
folder remain private. Choose the highest appropriate content rating for the
batch. Pending imports are visible in the owner's bookmark list with a
moderation label, without publishing a pending post detail page.

The failure report can be downloaded as a retry JSON file. It retains every
failed ID and folder path. Select the same destination folder when retrying;
folder creation and bookmarks are idempotent. The actual transfer of a personal
archive is complete only after its saved/failed counts and destination account
have been checked, not merely after deploying the importer.
