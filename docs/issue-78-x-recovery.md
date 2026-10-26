# X runner and bookmark recovery

Issue: https://github.com/techmore/swartzit/issues/78

The favorites source for this work is **X Bookmarks**, not Likes.

## Confirmed findings on 2026-10-26

The live application is in the Ser8 `swartzit` Incus container. Its worker
timer is active and enabled. The disabled host-level worker is not evidence
that the application worker is stopped.

All X content runners inspected were paused. Several enabled X crawler jobs
recorded an `EISDIR` error when writing a collected batch: the worker's path
wrapper accepted only one argument, discarding the generated filename under
`worker-batches`. A worker integration test now exercises collection through
publication and checks the actual batch file.

The destination bookmark inventory did not establish source completeness. No complete bookmark capture or transfer receipt
was identified in the inspected state directories. The existing no-publish
Recommended collector timed out waiting for an X post; this does not establish
whether the cause is authentication, an interstitial, connectivity, or X's UI.

## Recovery still required

1. Deploy the tested changes through the documented tagged-release and backup
   workflow. Do not patch the live checkout or overwrite the production database.
2. Verify the dedicated X browser profile, resolve any login/interstitial, and
   repeat a no-publish collector test. Do not enable a previously paused content
   runner until its destination and schedule have been checked.
3. Capture Bookmarks using the signed-in source, including pagination through a
   termination marker, or obtain an owner-supplied archive. Preserve folder
   mappings when available. Keep source data and sessions outside Git.
4. Use the existing resumable transfer procedure in
   [bookmark-transfer-workflow.md](bookmark-transfer-workflow.md), confirming
   the destination account and Ser8 origin before applying. Reconcile source
   IDs, successful saves, unavailable items, and failures; existing
   destination bookmarks must not be reported as a completed transfer.
5. Verify an actual scheduled run after release and establish ongoing bookmark
   collection. The archive/capture importer is a transfer tool, not an ongoing
   bookmark collector or scheduler.

## Photo review proposal

First retain source sensitivity through imports and protect moderator ratings.
That fixes known classification losses without a model. A visual review model
should initially suggest ratings in a shadow evaluation against a human-labeled
sample, including quotes, multiple attachments, and borderline cases. Measure
missed rated content separately from unnecessary restrictions; do not choose a
model based only on aggregate accuracy.

Any later rollout needs versioned rating provenance, confidence/uncertainty,
manual override protection, resumable asset checkpoints, and per-run cost and
failure accounting. A failed or uncertain review must remain unresolved rather
than being recorded as General. No model provider has been selected or deployed
as part of this repair.
