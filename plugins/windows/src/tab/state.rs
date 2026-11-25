crate::common_derives! {
    #[serde(tag = "type")]
    pub enum EditorView {
        #[serde(rename = "raw")]
        Raw,
        #[serde(rename = "transcript")]
        Transcript,
        #[serde(rename = "enhanced")]
        Enhanced { id: String },
        #[serde(rename = "attachments")]
        Attachments,
        #[serde(rename = "shared")]
        Shared { id: String },
        #[serde(rename = "lesson")]
        Lesson,
    }
}

crate::common_derives! {
    pub struct SessionsState {
        pub view: Option<EditorView>,
        pub auto_start: Option<bool>,
    }
}

crate::common_derives! {
    #[serde(tag = "type")]
    pub enum ContactsSelection {
        #[serde(rename = "person")]
        Person { id: String },
        #[serde(rename = "organization")]
        Organization { id: String },
    }
}

crate::common_derives! {
    pub struct ContactsState {
        pub selected: Option<ContactsSelection>,
    }
}

crate::common_derives! {
    pub struct TemplatesState {
        pub show_homepage: Option<bool>,
        pub is_web_mode: Option<bool>,
        pub selected_mine_id: Option<String>,
        pub selected_web_index: Option<i32>,
    }
}

crate::common_derives! {
    pub struct ExtensionsState {
        pub selected_extension: Option<String>,
    }
}

crate::common_derives! {
    pub struct ChangelogState {
        pub previous: Option<String>,
        pub current: String,
    }
}

crate::common_derives! {
    #[derive(Default)]
    pub struct SettingsState {
        pub tab: Option<String>,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn editor_views_keep_their_saved_shape() {
        for (view, json) in [
            (EditorView::Raw, r#"{"type":"raw"}"#),
            (EditorView::Lesson, r#"{"type":"lesson"}"#),
            (
                EditorView::Enhanced { id: "note".into() },
                r#"{"type":"enhanced","id":"note"}"#,
            ),
        ] {
            assert_eq!(serde_json::to_string(&view).unwrap(), json);
            let parsed: EditorView = serde_json::from_str(json).unwrap();
            assert_eq!(serde_json::to_string(&parsed).unwrap(), json);
        }
        let state: SessionsState =
            serde_json::from_str(r#"{"view":{"type":"lesson"},"autoStart":null}"#).unwrap();
        assert!(matches!(state.view, Some(EditorView::Lesson)));
    }
}
