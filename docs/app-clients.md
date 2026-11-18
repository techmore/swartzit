# Companion app clients

Native apps (the Swartzit iPhone app, `swartzit-ios`) are clients of a
Swartzit server: they show what the server offers and add nothing of their own.
App stores do not allow apps that can show sexual content, so a server sends
app clients a narrower slice of itself, chosen by its administrator.

## What an app receives

Add `client=app` to these requests:

| Request | With `client=app` |
| --- | --- |
| `GET /api/posts` | Only communities marked **Show in apps**, only general-rated posts. Asking for `ratings` or `mature_only` is rejected (400). `scope=bible`, `community`, `q`, `sort`, and `page` work as usual. |
| `GET /api/posts/{id}` | 404 unless the post is general-rated and in an app-visible community. |
| `GET /api/communities` | Only app-visible communities (each row has `app_visible`). |

Administrators choose the communities in **Admin → iPhone app** (or
`POST /api/admin/communities/{slug}/app` with `{"visible": true}`). The four
Biblical-mode communities are app-visible by default; every other community
starts hidden.

## Accounts

- `POST /api/accounts` signs up, `POST /api/sessions` signs in and returns a
  bearer token, `DELETE /api/sessions` signs out.
- `DELETE /api/me` with `{"password": "…"}` deletes the signed-in account:
  handle becomes `deleted-<id>`, profile and password are removed, sessions,
  votes, bookmarks and follows are deleted, posts are withdrawn and comments
  blanked. Administrator accounts must be demoted first.
- `POST /api/reports` with `{"post_id": …, "reason": "…"}` (or `comment_id`)
  reports content to the administrators.

## Bible mode

- `GET /api/bible/config` — whether Bible mode is offered, the starting mode,
  and its communities.
- `GET /bible/data/library` — all 66 books with their LibriVox recordings, and
  the Westminster Shorter Catechism. Download once and cache.
- `GET /bible/data/chapter/{book}/{chapter}` — KJV verses, the recording that
  contains the chapter, and the previous and next chapters.
- `GET /bible/data/reading/{YYYY-MM-DD}` — the day's reading plan and its
  recordings.

These return 404 when the administrator has not offered Bible mode.

## Policies

`/privacy` and `/terms` are public pages suitable for app store listings. Set
`SWARTZIT_CONTACT_EMAIL` in the web service environment to show a contact
address on both.
