//! The embedded store lives on local persistent storage alongside the API.
use sqlx::{
    Sqlite, SqlitePool, Transaction,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
};
use std::{str::FromStr, time::Duration};

pub async fn connect(url: &str, max_connections: u32) -> Result<SqlitePool, sqlx::Error> {
    if !url.starts_with("sqlite:") {
        return Err(sqlx::Error::Configuration("Swartzit now requires a sqlite: DATABASE_URL; import the PostgreSQL database before starting this release".into()));
    }
    let options = SqliteConnectOptions::from_str(url)?
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Full)
        .busy_timeout(Duration::from_secs(10));
    let pool = SqlitePoolOptions::new()
        .max_connections(max_connections.clamp(1, 16))
        .after_connect(|conn, _| {
            Box::pin(async move {
                let mut handle = conn.lock_handle().await?;
                // SAFETY: SQLx's locked handle excludes its worker while registering.
                // The callback owns no user data and only reads its one SQLite value.
                let status = unsafe {
                    libsqlite3_sys::sqlite3_create_function_v2(
                        handle.as_raw_handle().as_ptr(),
                        c"ln".as_ptr(),
                        1,
                        libsqlite3_sys::SQLITE_UTF8
                            | libsqlite3_sys::SQLITE_DETERMINISTIC
                            | libsqlite3_sys::SQLITE_INNOCUOUS,
                        std::ptr::null_mut(),
                        Some(sqlite_ln),
                        None,
                        None,
                        None,
                    )
                };
                if status != libsqlite3_sys::SQLITE_OK {
                    return Err(sqlx::Error::Protocol(
                        "could not register SQLite ranking function".into(),
                    ));
                }
                Ok(())
            })
        })
        .connect_with(options)
        .await?;
    sqlx::migrate!("./sqlite-migrations").run(&pool).await?;
    Ok(pool)
}

/// Acquire the write reservation before reads used to decide a mutation.
/// SQLx tracks the transaction, so cancellation/drop rolls it back too.
pub async fn begin_immediate(
    pool: &SqlitePool,
) -> Result<Transaction<'static, Sqlite>, sqlx::Error> {
    pool.begin_with("BEGIN IMMEDIATE").await
}

unsafe extern "C" fn sqlite_ln(
    context: *mut libsqlite3_sys::sqlite3_context,
    argc: i32,
    argv: *mut *mut libsqlite3_sys::sqlite3_value,
) {
    // SAFETY: SQLite invokes a registered one-argument scalar with valid argv.
    unsafe {
        if argc != 1 || libsqlite3_sys::sqlite3_value_type(*argv) == libsqlite3_sys::SQLITE_NULL {
            libsqlite3_sys::sqlite3_result_null(context);
            return;
        }
        let value = libsqlite3_sys::sqlite3_value_double(*argv);
        if value > 0.0 {
            libsqlite3_sys::sqlite3_result_double(context, value.ln());
        } else {
            libsqlite3_sys::sqlite3_result_null(context);
        }
    }
}
