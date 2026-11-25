use std::path::{Path, PathBuf};
use std::time::Instant;

mod download_error;
mod error;
#[cfg(test)]
mod hub_anonymous;
mod model;
mod platform;
mod responses;
#[cfg(test)]
mod streaming_offline;
mod types;

pub use error::{Error, Result};
pub use model::{
    LOCAL_BASE_URL, SoniqoModel, is_local_base_url, is_loopback_http_base_url,
    local_model_from_request,
};
pub use responses::{
    batch_response_from_channels, batch_response_from_text, stream_response_from_text,
};
pub use types::{
    DiarizationSegment, FileTranscript, FileTranscriptChunk, LanguagePrediction, LivePartial,
    ModelDownloadState, TranscriptSource,
};

/// Below this, a top language guess is too unsure to move a recording off Parakeet.
pub const LANGUAGE_ROUTING_MIN_PROBABILITY: f32 = 0.4;

/// A language Parakeet doesn't know that gets this much of the guess, even
/// behind English, means it's mixed in throughout (a Mandarin lesson taught in
/// English), so the recording goes to Qwen3-ASR. Measured on real recordings:
/// Mandarin lessons taught in English gave Chinese at least 0.25; English-only
/// ones gave languages Parakeet doesn't know (Welsh, Latin) at most 0.07.
pub const LANGUAGE_ROUTING_MIXED_MIN_PROBABILITY: f32 = 0.15;

/// How many ranked guesses per channel routing looks at.
pub const LANGUAGE_ROUTING_GUESSES: usize = 3;

/// Ranks the spoken language of 16 kHz mono samples, most likely first.
pub fn identify_language(samples: &[f32]) -> Result<Vec<LanguagePrediction>> {
    ensure_supported_platform(SoniqoModel::ParakeetBatch)?;
    platform::identify_language(samples)
}

pub fn parakeet_knows_language(code: &str) -> bool {
    anlg_language::PARAKEET_TDT_V3_LANGUAGE_CODES.contains(&code)
}

/// The language Parakeet doesn't know that should move a recording to
/// Qwen3-ASR: the top guess when it's likely enough, otherwise any of the top
/// guesses with a large enough share to be mixed in.
pub fn routing_language(predictions: &[LanguagePrediction]) -> Option<&LanguagePrediction> {
    let top = predictions.first()?;
    if !parakeet_knows_language(&top.code) && top.probability >= LANGUAGE_ROUTING_MIN_PROBABILITY {
        return Some(top);
    }
    predictions
        .iter()
        .take(LANGUAGE_ROUTING_GUESSES)
        .find(|prediction| {
            !parakeet_knows_language(&prediction.code)
                && prediction.probability >= LANGUAGE_ROUTING_MIXED_MIN_PROBABILITY
        })
}

/// Parakeet covers 25 European languages. When the recording is in another
/// one (Chinese, Japanese, Arabic…), or mixes one in, Qwen3-ASR transcribes it.
pub fn route_batch_model(model: SoniqoModel, predictions: &[LanguagePrediction]) -> SoniqoModel {
    if model == SoniqoModel::ParakeetBatch && routing_language(predictions).is_some() {
        SoniqoModel::Qwen3Small
    } else {
        model
    }
}

fn ensure_supported_platform(model: SoniqoModel) -> Result<()> {
    if !cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        return Err(Error::UnsupportedPlatform);
    }

    if model.requires_macos_15() {
        return Err(Error::RequiresMacOs15(model));
    }

    Ok(())
}

pub fn model_cache_dir(model: SoniqoModel) -> Result<PathBuf> {
    ensure_supported_platform(model)?;
    platform::model_cache_dir(model)
}

pub fn model_download_state(model: SoniqoModel) -> Result<ModelDownloadState> {
    ensure_supported_platform(model)?;
    let mut state = platform::model_download_state(model)?;
    state.error = state
        .error
        .as_deref()
        .map(download_error::user_facing_download_error);
    Ok(state)
}

pub fn start_model_download(model: SoniqoModel) -> Result<()> {
    ensure_supported_platform(model)?;
    platform::start_model_download(model)
}

pub fn reset_model(model: SoniqoModel) -> Result<()> {
    ensure_supported_platform(model)?;
    platform::reset_model(model)
}

pub fn is_model_downloaded(model: SoniqoModel) -> Result<bool> {
    Ok(model_download_state(model)?.status == "ready")
}

pub fn is_model_downloading(model: SoniqoModel) -> Result<bool> {
    Ok(model_download_state(model)?.status == "downloading")
}

pub fn delete_model(model: SoniqoModel) -> Result<()> {
    reset_model(model)?;

    let cache_dir = model_cache_dir(model)?;
    if cache_dir.exists() {
        std::fs::remove_dir_all(&cache_dir).map_err(Error::Delete)?;
    }
    if model == SoniqoModel::ParakeetBatch {
        let cache_dir = platform::diarization_cache_dir()?;
        if cache_dir.exists() {
            std::fs::remove_dir_all(&cache_dir).map_err(Error::Delete)?;
        }
    }

    Ok(())
}

pub fn transcribe_file(
    model: SoniqoModel,
    path: impl AsRef<Path>,
    language: Option<&str>,
) -> Result<FileTranscript> {
    ensure_supported_platform(model)?;

    let path = path.as_ref();
    let language = language.unwrap_or_default();
    let language_label = if language.is_empty() {
        "auto"
    } else {
        language
    };
    let file_extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default();
    let started_at = Instant::now();

    tracing::info!(
        anarlog.stt.provider.name = "soniqo",
        anarlog.stt.model = %model,
        anarlog.stt.language = %language_label,
        file.extension = %file_extension,
        "soniqo_native_file_transcription_start"
    );

    let result = platform::transcribe_file(model, path, language);
    let elapsed_ms = started_at.elapsed().as_millis() as u64;

    match &result {
        Ok(transcript) => {
            tracing::info!(
                anarlog.stt.provider.name = "soniqo",
                anarlog.stt.model = %model,
                elapsed_ms,
                transcript.duration_seconds = transcript.duration_seconds,
                transcript.text_chars = transcript.text.chars().count(),
                "soniqo_native_file_transcription_completed"
            );
        }
        Err(error) => {
            tracing::error!(
                anarlog.stt.provider.name = "soniqo",
                anarlog.stt.model = %model,
                elapsed_ms,
                error = %error,
                "soniqo_native_file_transcription_failed"
            );
        }
    }

    result
}

pub fn diarize_samples(
    model: SoniqoModel,
    samples: &[f32],
    exact_speakers: usize,
) -> Result<Vec<DiarizationSegment>> {
    ensure_supported_platform(model)?;
    if model.batch_model() != SoniqoModel::ParakeetBatch {
        return Err(Error::Bridge(format!(
            "{} does not support speaker diarization",
            model.display_name()
        )));
    }
    if exact_speakers < 2 {
        return Err(Error::Bridge(
            "speaker diarization requires at least two speakers".to_string(),
        ));
    }

    platform::diarize_samples(model.batch_model(), samples, exact_speakers)
}

pub struct LiveTranscriptionSession {
    model: SoniqoModel,
    session_token: String,
    stopped: bool,
}

impl LiveTranscriptionSession {
    pub fn start(model: SoniqoModel) -> Result<Self> {
        ensure_supported_platform(model)?;

        if !model.supports_live() {
            return Err(Error::Bridge(format!(
                "{} does not support realtime transcription",
                model.display_name()
            )));
        }

        let session_token = platform::live_start(model).map_err(|error| {
            tracing::error!(
                anarlog.stt.provider.name = "soniqo",
                anarlog.stt.model = %model,
                error = %error,
                "soniqo_native_live_start_failed"
            );
            error
        })?;
        Ok(Self {
            model,
            session_token,
            stopped: false,
        })
    }

    pub fn append(
        &mut self,
        source: TranscriptSource,
        samples: &[f32],
    ) -> Result<Vec<LivePartial>> {
        platform::live_append(&self.session_token, source, samples)
    }

    pub fn finalize(&mut self, source: TranscriptSource) -> Result<Vec<LivePartial>> {
        platform::live_finalize(&self.session_token, source)
    }

    pub fn model(&self) -> SoniqoModel {
        self.model
    }

    pub fn stop(mut self) -> Result<()> {
        self.stopped = true;
        platform::live_stop(&self.session_token)
    }
}

impl Drop for LiveTranscriptionSession {
    fn drop(&mut self) {
        if !self.stopped {
            let _ = platform::live_stop(&self.session_token);
        }
    }
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod routing_tests {
    use super::*;

    fn guess(code: &str, probability: f32) -> Vec<LanguagePrediction> {
        guesses(&[(code, probability)])
    }

    fn guesses(ranked: &[(&str, f32)]) -> Vec<LanguagePrediction> {
        ranked
            .iter()
            .map(|(code, probability)| LanguagePrediction {
                code: code.to_string(),
                probability: *probability,
            })
            .collect()
    }

    #[test]
    fn mandarin_moves_parakeet_batch_to_qwen3() {
        assert_eq!(
            route_batch_model(SoniqoModel::ParakeetBatch, &guess("zh", 0.82)),
            SoniqoModel::Qwen3Small
        );
    }

    #[test]
    fn mandarin_mixed_into_english_moves_parakeet_batch_to_qwen3() {
        // What the two Chinese lessons, taught in English, measured.
        for lesson in [
            guesses(&[("en", 0.604), ("zh", 0.251), ("ko", 0.074)]),
            guesses(&[("en", 0.403), ("zh", 0.329), ("ko", 0.173)]),
        ] {
            assert_eq!(
                route_batch_model(SoniqoModel::ParakeetBatch, &lesson),
                SoniqoModel::Qwen3Small
            );
            assert_eq!(
                routing_language(&lesson).map(|p| p.code.as_str()),
                Some("zh")
            );
        }
    }

    #[test]
    fn english_with_stray_guesses_stays_on_parakeet() {
        // What English-only recordings measured: Welsh, Latin and Norwegian
        // (none of them Parakeet languages) trail far behind.
        for english in [
            guesses(&[("en", 0.993), ("da", 0.002), ("pt", 0.001)]),
            guesses(&[("en", 0.928), ("cy", 0.027), ("la", 0.010)]),
            guesses(&[("en", 0.890), ("cy", 0.024), ("no", 0.022)]),
        ] {
            assert_eq!(
                route_batch_model(SoniqoModel::ParakeetBatch, &english),
                SoniqoModel::ParakeetBatch
            );
        }
    }

    #[test]
    fn unsure_english_with_a_european_runner_up_stays_on_parakeet() {
        let english_or_portuguese = guesses(&[("en", 0.55), ("pt", 0.35), ("es", 0.05)]);
        assert_eq!(
            route_batch_model(SoniqoModel::ParakeetBatch, &english_or_portuguese),
            SoniqoModel::ParakeetBatch
        );
        assert_eq!(routing_language(&english_or_portuguese), None);
    }

    #[test]
    fn only_the_top_guesses_count() {
        let fourth = guesses(&[("en", 0.4), ("pt", 0.2), ("es", 0.2), ("zh", 0.2)]);
        assert_eq!(
            route_batch_model(SoniqoModel::ParakeetBatch, &fourth),
            SoniqoModel::ParakeetBatch
        );
    }

    #[test]
    fn parakeet_keeps_its_own_languages_and_unsure_guesses() {
        for code in ["en", "pt", "de"] {
            assert_eq!(
                route_batch_model(SoniqoModel::ParakeetBatch, &guess(code, 0.9)),
                SoniqoModel::ParakeetBatch
            );
        }
        assert_eq!(
            route_batch_model(SoniqoModel::ParakeetBatch, &guess("zh", 0.1)),
            SoniqoModel::ParakeetBatch
        );
        assert_eq!(
            route_batch_model(SoniqoModel::ParakeetBatch, &[]),
            SoniqoModel::ParakeetBatch
        );
    }

    #[test]
    fn a_model_the_user_chose_is_never_rerouted() {
        assert_eq!(
            route_batch_model(SoniqoModel::Qwen3Large, &guess("en", 0.99)),
            SoniqoModel::Qwen3Large
        );
    }
}
