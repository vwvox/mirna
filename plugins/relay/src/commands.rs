use crate::relay::PendingResults;

#[tauri::command]
pub async fn relay_result(
    state: tauri::State<'_, PendingResults>,
    id: u64,
    ok: bool,
    data: serde_json::Value,
) -> Result<(), String> {
    if let Some(tx) = state.take(id).await {
        let _ = tx.send(serde_json::json!({ "ok": ok, "data": data }));
    }
    Ok(())
}

/// A message on a channel the main webview opened for a browser; forwarded to that browser.
#[tauri::command]
pub async fn relay_channel(
    state: tauri::State<'_, PendingResults>,
    connection: u64,
    handler: u64,
    payload: serde_json::Value,
) -> Result<(), String> {
    state.push_channel(connection, handler, payload).await;
    Ok(())
}
