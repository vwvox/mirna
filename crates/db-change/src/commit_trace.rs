//! Publishes staged commits once SQLite has finished writing them.
//!
//! The commit hook fires before the WAL frames are written, so a reader that reacts
//! to it can still open the old snapshot. SQLite has no post-commit hook, but the
//! statement that committed always finishes after the commit is visible:
//!
//! - `sqlite3_step` commits inside the VM and invokes `SQLITE_TRACE_PROFILE` afterwards.
//! - `sqlite3_reset`/`sqlite3_finalize` of an unfinished write (for example
//!   `INSERT ... RETURNING` read with `fetch_one`) invoke the profile callback *before*
//!   committing, so those changes wait for the next `SQLITE_TRACE_STMT` on the connection.

use std::ffi::{c_int, c_uint, c_void};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::ptr;
use std::sync::Arc;

use libsqlite3_sys::{
    SQLITE_OK, SQLITE_TRACE_CLOSE, SQLITE_TRACE_PROFILE, SQLITE_TRACE_STMT, sqlite3,
    sqlite3_db_handle, sqlite3_get_autocommit, sqlite3_stmt, sqlite3_stmt_busy, sqlite3_trace_v2,
};
use sqlx::sqlite::LockedSqliteHandle;

use crate::tracker::HookState;

#[derive(Debug)]
pub(crate) struct TraceRegistrationError(c_int);

impl std::fmt::Display for TraceRegistrationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "failed to install SQLite commit trace (code {})", self.0)
    }
}

impl std::error::Error for TraceRegistrationError {}

pub(crate) fn install(
    handle: &mut LockedSqliteHandle<'_>,
    state: Arc<HookState>,
) -> Result<(), TraceRegistrationError> {
    let context = Arc::into_raw(state).cast_mut().cast::<c_void>();

    // SAFETY: the handle is locked and open. `context` stays alive until the
    // `SQLITE_TRACE_CLOSE` callback unregisters the trace and releases it.
    let result = unsafe {
        sqlite3_trace_v2(
            handle.as_raw_handle().as_ptr(),
            SQLITE_TRACE_STMT | SQLITE_TRACE_PROFILE | SQLITE_TRACE_CLOSE,
            Some(trace_commit_visibility),
            context,
        )
    };

    if result == SQLITE_OK {
        Ok(())
    } else {
        // SAFETY: registration failed, so SQLite holds no copy of `context`.
        unsafe { drop(Arc::from_raw(context.cast::<HookState>())) };
        Err(TraceRegistrationError(result))
    }
}

unsafe extern "C" fn trace_commit_visibility(
    event: c_uint,
    context: *mut c_void,
    object: *mut c_void,
    _detail: *mut c_void,
) -> c_int {
    if context.is_null() || object.is_null() {
        return SQLITE_OK;
    }

    let _ = catch_unwind(AssertUnwindSafe(|| {
        // SAFETY: `context` came from `Arc::into_raw` in `install` and is released
        // only by the close event below.
        let state = unsafe { &*context.cast::<HookState>() };
        match event {
            SQLITE_TRACE_STMT => state.publish_staged(),
            SQLITE_TRACE_PROFILE => {
                // SAFETY: SQLite passes the live statement for profile events.
                if unsafe { statement_finished_in_autocommit(object.cast::<sqlite3_stmt>()) } {
                    state.publish_staged();
                }
            }
            SQLITE_TRACE_CLOSE => {
                // SAFETY: SQLite passes the closing connection; unregistering first
                // guarantees no later callback sees the released context.
                unsafe {
                    sqlite3_trace_v2(object.cast::<sqlite3>(), 0, None, ptr::null_mut());
                    drop(Arc::from_raw(context.cast::<HookState>()));
                }
            }
            _ => {}
        }
    }));

    SQLITE_OK
}

unsafe fn statement_finished_in_autocommit(statement: *mut sqlite3_stmt) -> bool {
    // SAFETY: the caller passes a statement SQLite handed to the trace callback.
    unsafe {
        if sqlite3_stmt_busy(statement) != 0 {
            return false;
        }
        let database = sqlite3_db_handle(statement);
        !database.is_null() && sqlite3_get_autocommit(database) != 0
    }
}
