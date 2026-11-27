use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use tokio::sync::broadcast;

use crate::{TableChange, TableChangeKind};

type TableKinds = HashMap<String, TableChangeKind>;

#[derive(Debug, Default)]
struct PendingChanges {
    uncommitted: TableKinds,
    // SQLite's commit hook runs before the commit is written, so these wait for
    // a post-commit callback before they are announced.
    committing: TableKinds,
}

#[derive(Debug)]
pub(crate) struct HookState {
    pending: Mutex<PendingChanges>,
    tx: broadcast::Sender<TableChange>,
    change_tracker: Arc<ChangeTracker>,
}

impl HookState {
    pub(crate) fn new(
        tx: broadcast::Sender<TableChange>,
        change_tracker: Arc<ChangeTracker>,
    ) -> Self {
        Self {
            pending: Mutex::new(PendingChanges::default()),
            tx,
            change_tracker,
        }
    }

    pub(crate) fn record(&self, table: &str, kind: TableChangeKind) {
        self.lock().uncommitted.insert(table.to_string(), kind);
    }

    pub(crate) fn stage_commit(&self) {
        let mut pending = self.lock();
        let uncommitted = std::mem::take(&mut pending.uncommitted);
        pending.committing.extend(uncommitted);
    }

    pub(crate) fn publish_staged(&self) {
        let committing = std::mem::take(&mut self.lock().committing);
        self.broadcast(committing);
    }

    pub(crate) fn publish_all(&self) {
        self.stage_commit();
        self.publish_staged();
    }

    pub(crate) fn clear(&self) {
        let mut pending = self.lock();
        pending.uncommitted.clear();
        pending.committing.clear();
    }

    fn broadcast(&self, committed: TableKinds) {
        if committed.is_empty() {
            return;
        }

        let seq = self.change_tracker.next_seq();
        self.change_tracker.record_committed(&committed, seq);
        for (table, kind) in committed {
            let _ = self.tx.send(TableChange { table, kind, seq });
        }
    }

    fn lock(&self) -> MutexGuard<'_, PendingChanges> {
        self.pending.lock().unwrap_or_else(PoisonError::into_inner)
    }

    #[cfg(test)]
    pub(crate) fn pause_at_test_commit_gate(&self) {
        self.change_tracker.pause_at_test_commit_gate();
    }
}

#[derive(Debug, Default)]
pub(crate) struct ChangeTracker {
    current_seq: AtomicU64,
    latest_by_table: Mutex<HashMap<String, u64>>,
    #[cfg(test)]
    commit_gate: Mutex<Option<Arc<crate::tests::CommitGate>>>,
}

impl ChangeTracker {
    fn next_seq(&self) -> u64 {
        self.current_seq.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub(crate) fn current_seq(&self) -> u64 {
        self.current_seq.load(Ordering::SeqCst)
    }

    pub(crate) fn latest_table_seq(&self, table: &str) -> Option<u64> {
        self.latest_by_table
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(table)
            .copied()
    }

    fn record_committed(&self, committed: &TableKinds, seq: u64) {
        let mut latest = self
            .latest_by_table
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        for table in committed.keys() {
            latest.insert(table.clone(), seq);
        }
    }

    #[cfg(test)]
    pub(crate) fn install_test_commit_gate(&self, gate: Arc<crate::tests::CommitGate>) {
        *self.commit_gate.lock().unwrap() = Some(gate);
    }

    #[cfg(test)]
    fn pause_at_test_commit_gate(&self) {
        let gate = self.commit_gate.lock().unwrap().take();
        if let Some(gate) = gate {
            gate.pause();
        }
    }
}
