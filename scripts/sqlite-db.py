#!/usr/bin/env python3
"""Consistent SQLite snapshots and a loss-checked one-time PostgreSQL import.

Database URLs travel through environment variables to psql, never its argv.
The importer refuses an existing target and keeps private export files mode0600.
"""
import argparse
import datetime
import hashlib
import json
import os
import re
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
from urllib.parse import unquote, urlsplit, parse_qs

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = ROOT / 'crates/server/sqlite-migrations/0001_sqlite_baseline.sql'

def db_path(url):
    if not url.startswith('sqlite:'):
        raise ValueError('expected a sqlite: database URL')
    value = url[len('sqlite:'):].split('?', 1)[0]
    if value.startswith('//'):
        value = value[2:]
    if not value or value == ':memory:':
        raise ValueError('a persistent SQLite file is required')
    return Path(unquote(value)).expanduser().resolve()

def connection(path, readonly=False):
    if readonly:
        return sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=30)
    return sqlite3.connect(path, timeout=30)

def tables(db):
    return [row[0] for row in db.execute("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'posts_fts%' AND name <> '_sqlx_migrations' ORDER BY name")]

def quote(name):
    return '"' + name.replace('"', '""') + '"'

def counts(db):
    return {name: db.execute('SELECT count(*) FROM ' + quote(name)).fetchone()[0] for name in tables(db)}

def verify(path, manifest=None):
    with connection(path, True) as db:
        if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
            raise ValueError('SQLite integrity check failed')
        if db.execute('PRAGMA foreign_key_check').fetchone() is not None:
            raise ValueError('SQLite foreign key check failed')
        actual = counts(db)
        if not SCHEMA.is_file():
            raise ValueError('SQLite baseline is missing; cannot verify the application schema')
        expected_tables = set(re.findall(r'CREATE TABLE (\w+)', SCHEMA.read_text()))
        if not expected_tables.issubset(actual):
            raise ValueError('database is missing application tables')
        if manifest:
            expected = dict((name, int(total)) for name, total in (line.rstrip('\n').split('\t') for line in Path(manifest).read_text().splitlines()))
            if expected != actual:
                raise ValueError('SQLite table row counts differ from backup manifest')
    return actual

def snapshot(url, destination):
    source = db_path(url)
    dest = Path(destination).resolve()
    if source == dest or dest.exists():
        raise ValueError('snapshot destination must be a new file')
    if not source.is_file():
        raise ValueError('SQLite source does not exist')
    dest.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive create prevents accidental overwrite/symlink traversal.
    fd = os.open(dest, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    try:
        with connection(source, True) as src, connection(dest) as target:
            src.backup(target)
        verify(dest)
    except BaseException:
        dest.unlink(missing_ok=True)
        raise

def statements(source):
    current = ''
    for line in source.splitlines(keepends=True):
        current += line
        if sqlite3.complete_statement(current):
            yield current
            current = ''
    if current.strip() and not all(line.lstrip().startswith('--') or not line.strip() for line in current.splitlines()):
        raise ValueError('incomplete SQLite baseline statement')

def canonical(value, kind):
    if value is None:
        return None
    if kind == 'bytea':
        if not value.startswith('\\x'):
            raise ValueError('unexpected PostgreSQL blob encoding')
        return bytes.fromhex(value[2:])
    if kind in ('json', 'jsonb') or kind.endswith('[]'):
        return json.dumps(value, separators=(',', ':'), ensure_ascii=False)
    if kind in ('timestamp with time zone', 'timestamp without time zone'):
        instant = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
        if instant.tzinfo is None:
            instant = instant.replace(tzinfo=datetime.timezone.utc)
        return instant.astimezone(datetime.timezone.utc).isoformat(timespec='microseconds').replace('+00:00', 'Z')
    if kind == 'boolean':
        return int(value)
    return value

def digest_rows(rows):
    # Order-independent fingerprint after type normalization; include blobs.
    def encode(value):
        return {'blob': value.hex()} if isinstance(value, bytes) else value
    rendered = sorted(json.dumps([encode(v) for v in row], separators=(',', ':'), ensure_ascii=False) for row in rows)
    return hashlib.sha256('\n'.join(rendered).encode()).hexdigest()

def import_postgres(url, destination):
    if not url.startswith(('postgres:', 'postgresql:')):
        raise ValueError('source must be a PostgreSQL URL')
    dest = Path(destination).resolve()
    if dest.exists():
        raise ValueError('refusing to overwrite an existing SQLite database')
    if not SCHEMA.is_file():
        raise ValueError('SQLite baseline is missing beside the repository scripts')
    dest.parent.mkdir(parents=True, exist_ok=True)
    os.umask(0o077)
    # psql generates all table records within ONE repeatable-read snapshot.
    # query_to_xml is avoided: JSON preserves bytes/arrays/bools precisely.
    export_sql = r'''BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT format(
  'SELECT json_build_object(''table'',%L,''columns'',%L::json,''rows'',coalesce((SELECT json_agg(row_to_json(t)) FROM public.%I t),''[]''::json),''sequence'',coalesce((SELECT last_value FROM pg_sequences WHERE schemaname=''public'' AND sequencename=%L),0));',
  c.table_name,
  (SELECT json_agg(json_build_object('name',column_name,'type',data_type,'generated',is_generated))::text
   FROM (SELECT column_name,data_type,is_generated FROM information_schema.columns WHERE table_schema='public' AND table_name=c.table_name ORDER BY ordinal_position) cols),
  c.table_name, c.table_name || '_id_seq')
FROM information_schema.tables c WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> '_sqlx_migrations' ORDER BY table_name
\gexec
COMMIT;
'''
    with tempfile.TemporaryDirectory(prefix='swartzit-sqlite-import-') as temp:
        sql = Path(temp) / 'export.sql'
        exported = Path(temp) / 'private-export.jsonl'
        sql.write_text(export_sql)
        parsed = urlsplit(url)
        env = dict(os.environ)
        for key in ('PGSERVICE','PGSERVICEFILE','PGHOSTADDR'):
            env.pop(key, None)
        env.update(PGHOST=parsed.hostname or '127.0.0.1', PGPORT=str(parsed.port or 5432), PGUSER=unquote(parsed.username or ''), PGPASSWORD=unquote(parsed.password or ''), PGDATABASE=unquote(parsed.path.lstrip('/')))
        options = parse_qs(parsed.query)
        for option, key in [('sslmode','PGSSLMODE'),('sslrootcert','PGSSLROOTCERT'),('connect_timeout','PGCONNECT_TIMEOUT')]:
            if option in options:
                env[key] = options[option][0]
        with exported.open('wb') as output:
            result = subprocess.run(['psql', '-X', '-q', '-A', '-t', '-w', '-v', 'ON_ERROR_STOP=1', '-f', str(sql)], env=env, stdout=output, stderr=subprocess.PIPE)
        if result.returncode:
            detail = result.stderr.decode(errors='replace').replace(url, '[database URL]')
            password = urlsplit(url).password
            if password:
                detail = detail.replace(password, '[password]')
            detail = next((line.split('ERROR:',1)[-1].split('FATAL:',1)[-1].strip() for line in detail.splitlines() if 'ERROR:' in line or 'FATAL:' in line), detail.strip() or 'psql failed')
            raise ValueError('PostgreSQL snapshot export failed: ' + detail[:240])
        bundles = [json.loads(line) for line in exported.read_text().splitlines() if line.strip()]
        fd = os.open(dest, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(fd)
        try:
            schema = SCHEMA.read_text()
            with connection(dest) as db:
                db.executescript(schema)
                db.execute('PRAGMA foreign_keys=OFF')
                triggers = [stmt for stmt in statements(schema) if 'CREATE TRIGGER ' in stmt]
                for (name,) in db.execute("SELECT name FROM sqlite_schema WHERE type='trigger'").fetchall():
                    db.execute('DROP TRIGGER ' + quote(name))
                for name in tables(db):
                    db.execute('DELETE FROM ' + quote(name))
                if set(tables(db)) != {bundle['table'] for bundle in bundles}:
                    raise ValueError('source and target application tables differ; refusing incomplete import')
                receipt = {}
                for bundle in bundles:
                    name = bundle['table']
                    metadata = [col for col in bundle['columns'] if col['generated'] == 'NEVER']
                    cols = [col['name'] for col in metadata]
                    target_columns = [row[1] for row in db.execute('PRAGMA table_xinfo(' + quote(name) + ')') if row[6] == 0]
                    if cols != target_columns:
                        raise ValueError('source and target columns differ for ' + name)
                    # PG array information_schema type is ARRAY; this sole array
                    # becomes JSON text in the SQLite schema.
                    kinds = [col['type'] if col['type'] != 'ARRAY' else 'text[]' for col in metadata]
                    rows = [tuple(canonical(row[col], kind) for col, kind in zip(cols, kinds)) for row in bundle['rows']]
                    insert = 'INSERT INTO ' + quote(name) + '(' + ','.join(map(quote, cols)) + ') VALUES(' + ','.join('?' for _ in cols) + ')'
                    db.executemany(insert, rows)
                    actual = db.execute('SELECT ' + ','.join(map(quote, cols)) + ' FROM ' + quote(name)).fetchall()
                    if len(rows) != len(actual) or digest_rows(rows) != digest_rows(actual):
                        raise ValueError('row content fingerprint differs for ' + name)
                    if bundle.get('sequence'):
                        changed = db.execute('UPDATE sqlite_sequence SET seq=max(seq,?) WHERE name=?', (bundle['sequence'], name))
                        if changed.rowcount == 0:
                            db.execute('INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)', (name, bundle['sequence']))
                    receipt[name] = {'rows': len(rows), 'sha256': digest_rows(rows)}
                for stmt in triggers:
                    db.executescript(stmt)
                db.execute("INSERT INTO posts_fts(posts_fts) VALUES('rebuild')")
                db.execute('''CREATE TABLE _sqlx_migrations(version BIGINT PRIMARY KEY,description TEXT NOT NULL,installed_on TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,success BOOLEAN NOT NULL,checksum BLOB NOT NULL,execution_time BIGINT NOT NULL)''')
                db.execute("INSERT INTO _sqlx_migrations(version,description,success,checksum,execution_time) VALUES(1,'sqlite baseline',1,?,0)", (hashlib.sha384(SCHEMA.read_bytes()).digest(),))
                db.commit()
            actual = verify(dest)
            receipt_path = dest.with_suffix(dest.suffix + '.migration.json')
            receipt_path.write_text(json.dumps({'format':'swartzit-postgres-to-sqlite-v1','created_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'tables':receipt,'table_count':len(receipt),'row_total':sum(actual.values())}, indent=2)+'\n')
            print(f'Imported {len(receipt)} tables; {sum(actual.values())} rows; all content fingerprints match.')
            print(f'Receipt: {receipt_path}')
        except BaseException:
            dest.unlink(missing_ok=True)
            raise

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['path', 'backup', 'verify', 'counts', 'migrate-postgres'])
    parser.add_argument('source')
    parser.add_argument('destination', nargs='?')
    args = parser.parse_args()
    if args.source.startswith('env:'):
        key = args.source[4:]
        if not key.isidentifier() or key not in os.environ:
            parser.error('source environment variable is missing')
        args.source = os.environ[key]
    if args.operation == 'path':
        print(db_path(args.source))
    elif args.operation == 'backup':
        if not args.destination:
            parser.error('backup requires a destination')
        snapshot(args.source, args.destination)
    elif args.operation == 'verify':
        actual = verify(Path(args.source).resolve(), args.destination)
        print(f'SQLite integrity, foreign keys, and {len(actual)} table counts verified.')
    elif args.operation == 'counts':
        with connection(Path(args.source).resolve(), True) as db:
            print('\n'.join(f'{name}\t{total}' for name, total in counts(db).items()))
    else:
        if not args.destination:
            parser.error('migrate-postgres requires a new destination')
        import_postgres(args.source, args.destination)

if __name__ == '__main__':
    try:
        main()
    except (ValueError, sqlite3.Error, OSError) as error:
        print(f'SQLite database operation failed: {error}', file=sys.stderr)
        sys.exit(1)
