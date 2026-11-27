use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use sqlx::SqlitePool;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode};
use tokio::sync::broadcast;
use tokio::sync::broadcast::error::RecvError;

use crate::{ChangeNotifier, TableChange, TableChangeKind};

/// Holds a commit inside SQLite's commit hook, standing in for a slow WAL write/fsync.
#[derive(Debug, Default)]
pub(crate) struct CommitGate {
    reached: AtomicBool,
    released: Mutex<bool>,
    release_signal: Condvar,
}

impl CommitGate {
    pub(crate) fn pause(&self) {
        self.reached.store(true, Ordering::SeqCst);
        let released = self.released.lock().unwrap();
        let _ = self
            .release_signal
            .wait_timeout_while(released, Duration::from_secs(5), |released| !*released)
            .unwrap();
    }

    async fn wait_until_reached(&self) {
        tokio::time::timeout(Duration::from_secs(2), async {
            while !self.reached.load(Ordering::SeqCst) {
                tokio::time::sleep(Duration::from_millis(1)).await;
            }
        })
        .await
        .expect("commit should reach the commit hook");
    }

    fn release(&self) {
        *self.released.lock().unwrap() = true;
        self.release_signal.notify_all();
    }
}

async fn open_wal_pool(dir: &Path) -> (ChangeNotifier, SqlitePool) {
    let (notifier, pool_options) = ChangeNotifier::new();
    let options = SqliteConnectOptions::new()
        .filename(dir.join("app.db"))
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_secs(5));
    let pool = pool_options
        .max_connections(4)
        .connect_with(options)
        .await
        .unwrap();
    sqlx::query("CREATE TABLE notes (id TEXT PRIMARY KEY NOT NULL)")
        .execute(&pool)
        .await
        .unwrap();
    (notifier, pool)
}

async fn count_notes(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM notes")
        .fetch_one(pool)
        .await
        .unwrap()
}

/// Reruns a query on another pool connection for every announced change, like the
/// live-query dispatcher does.
fn record_reruns(
    pool: SqlitePool,
    mut changes: broadcast::Receiver<TableChange>,
) -> Arc<Mutex<Vec<i64>>> {
    let reruns = Arc::new(Mutex::new(Vec::new()));
    let recorded = Arc::clone(&reruns);
    tokio::spawn(async move {
        while changes.recv().await.is_ok() {
            let count = count_notes(&pool).await;
            recorded.lock().unwrap().push(count);
        }
    });
    reruns
}

async fn wait_for_reruns(reruns: &Arc<Mutex<Vec<i64>>>, count: usize) -> Vec<i64> {
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let recorded = reruns.lock().unwrap().clone();
            if recorded.len() >= count {
                return recorded;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("change should be announced")
}

async fn hold_commit_then_release(gate: &CommitGate, pool: &SqlitePool) {
    gate.wait_until_reached().await;
    assert_eq!(
        count_notes(pool).await,
        0,
        "the held commit must not be visible yet"
    );
    // Longer than the dispatcher's coalescing delay, so an early announcement
    // would already have produced a rerun.
    tokio::time::sleep(Duration::from_millis(100)).await;
    gate.release();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn rerun_after_autocommit_write_never_reads_pre_commit_snapshot() {
    let dir = tempfile::tempdir().unwrap();
    let (notifier, pool) = open_wal_pool(dir.path()).await;
    let reruns = record_reruns(pool.clone(), notifier.subscribe());
    let gate = notifier.pause_next_commit();

    let writer = tokio::spawn({
        let pool = pool.clone();
        async move {
            sqlx::query("INSERT INTO notes (id) VALUES ('a')")
                .execute(&pool)
                .await
                .unwrap();
        }
    });
    hold_commit_then_release(&gate, &pool).await;
    writer.await.unwrap();

    assert_eq!(wait_for_reruns(&reruns, 1).await, vec![1]);
    assert_eq!(notifier.current_seq(), 1);
    assert_eq!(notifier.latest_table_seq("notes"), Some(1));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn rerun_after_transaction_commit_never_reads_pre_commit_snapshot() {
    let dir = tempfile::tempdir().unwrap();
    let (notifier, pool) = open_wal_pool(dir.path()).await;
    let reruns = record_reruns(pool.clone(), notifier.subscribe());

    let mut transaction = pool.begin().await.unwrap();
    sqlx::query("INSERT INTO notes (id) VALUES ('a')")
        .execute(&mut *transaction)
        .await
        .unwrap();
    sqlx::query("INSERT INTO notes (id) VALUES ('b')")
        .execute(&mut *transaction)
        .await
        .unwrap();
    let gate = notifier.pause_next_commit();

    let writer = tokio::spawn(async move { transaction.commit().await.unwrap() });
    hold_commit_then_release(&gate, &pool).await;
    writer.await.unwrap();

    assert_eq!(wait_for_reruns(&reruns, 1).await, vec![2]);
    assert_eq!(notifier.current_seq(), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn rerun_after_commit_inside_statement_reset_never_reads_pre_commit_snapshot() {
    let dir = tempfile::tempdir().unwrap();
    let (notifier, pool) = open_wal_pool(dir.path()).await;
    let reruns = record_reruns(pool.clone(), notifier.subscribe());
    let mut connection = pool.acquire().await.unwrap();
    let gate = notifier.pause_next_commit();

    // `fetch_optional` stops after the first RETURNING row, so SQLite commits while
    // sqlx resets the statement, after the statement's last profile callback.
    let writer = tokio::spawn(async move {
        let id: Option<String> =
            sqlx::query_scalar("INSERT INTO notes (id) VALUES ('a') RETURNING id")
                .fetch_optional(&mut *connection)
                .await
                .unwrap();
        assert_eq!(id.as_deref(), Some("a"));
        connection
    });
    hold_commit_then_release(&gate, &pool).await;
    let mut connection = writer.await.unwrap();

    sqlx::query("SELECT 1")
        .execute(&mut *connection)
        .await
        .unwrap();

    assert_eq!(wait_for_reruns(&reruns, 1).await, vec![1]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn rolled_back_transaction_is_never_announced() {
    let dir = tempfile::tempdir().unwrap();
    let (notifier, pool) = open_wal_pool(dir.path()).await;
    let mut changes = notifier.subscribe();

    let mut transaction = pool.begin().await.unwrap();
    sqlx::query("INSERT INTO notes (id) VALUES ('a')")
        .execute(&mut *transaction)
        .await
        .unwrap();
    transaction.rollback().await.unwrap();

    sqlx::query("INSERT INTO notes (id) VALUES ('b')")
        .execute(&pool)
        .await
        .unwrap();

    let change = tokio::time::timeout(Duration::from_secs(1), changes.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        change,
        TableChange {
            table: "notes".to_string(),
            kind: TableChangeKind::Insert,
            seq: 1,
        }
    );
    assert!(
        tokio::time::timeout(Duration::from_millis(100), changes.recv())
            .await
            .is_err()
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn closing_the_pool_releases_every_hook_sender() {
    let dir = tempfile::tempdir().unwrap();
    let (notifier, pool) = open_wal_pool(dir.path()).await;
    let mut changes = notifier.subscribe();
    sqlx::query("INSERT INTO notes (id) VALUES ('a')")
        .execute(&pool)
        .await
        .unwrap();
    changes.recv().await.unwrap();

    pool.close().await;
    drop(pool);
    drop(notifier);

    let closed = tokio::time::timeout(Duration::from_secs(2), changes.recv())
        .await
        .expect("hook state should be released when connections close");
    assert!(matches!(closed, Err(RecvError::Closed)));
}
