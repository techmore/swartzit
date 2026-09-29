#!/usr/bin/env python3
"""Reject missing tables and unexpected shrink; allow normal expiry and user edits."""
import csv
import sys

# These tables have explicit delete/expiry paths in the application. Durable
# content (authors, posts, comments, media and sources) remains protected.
MUTABLE_TABLES = frozenset({
    'sessions', 'post_view_visits', 'ip_activity', 'content_runner_runs',
    'bookmarks', 'bookmark_folders', 'post_votes', 'community_subscriptions',
    'x_author_subscriptions', 'buddy_follows', 'author_like_share_recipients',
    'ip_blocks', 'crawler_jobs', 'content_runners',
})


def read_counts(path):
    result = {}
    with open(path, encoding='utf-8', newline='') as stream:
        for row in csv.reader(stream, delimiter='\t'):
            if (len(row) != 2 or not row[0] or row[0] in result
                    or not row[1].isascii() or not row[1].isdigit()):
                raise ValueError('row-count files are empty or malformed')
            result[row[0]] = int(row[1])
    if not result:
        raise ValueError('row-count files are empty or malformed')
    return result


def main():
    try:
        previous, current = map(read_counts, sys.argv[1:])
    except (OSError, ValueError) as error:
        print(error, file=sys.stderr)
        return 2
    smaller = False
    for table, count in previous.items():
        if table not in current:
            print(f'table disappeared: {table}', file=sys.stderr)
            smaller = True
        elif current[table] < count:
            if table in MUTABLE_TABLES:
                print(f'Normal expiry or user edit in {table}: {count} -> {current[table]}')
            else:
                print(f'row count decreased for {table}: {count} -> {current[table]}', file=sys.stderr)
                smaller = True
    return 1 if smaller else 0


if __name__ == '__main__':
    raise SystemExit(main())
