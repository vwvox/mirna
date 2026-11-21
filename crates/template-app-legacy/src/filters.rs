use minijinja::{ErrorKind, Value};

pub fn transcript(segments: Value) -> Result<String, minijinja::Error> {
    let mut output = String::new();

    for segment in segments.try_iter()? {
        let speaker_label = segment
            .get_attr("speaker_label")
            .map(|v| v.to_string())
            .unwrap_or_else(|_| "Unknown Speaker".to_string());

        let text = segment
            .get_attr("text")
            .map(|v| v.to_string())
            .unwrap_or_default();

        output.push_str(&format!("[{}]\n{}\n\n", speaker_label, text));
    }

    Ok(output)
}

// Templates used to be able to pull any web page into a prompt with `| url`.
// Mirna never fetches remote content while rendering a template.
pub fn url(_v: Value) -> Result<String, minijinja::Error> {
    Err(minijinja::Error::new(
        ErrorKind::InvalidOperation,
        "the url filter is disabled: Mirna does not fetch web pages from templates",
    ))
}
