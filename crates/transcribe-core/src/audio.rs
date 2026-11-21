use std::time::Duration;

use anlg_audio_chunking::{AudioChunk, Chunker, SpeechChunker, SpeechChunkingConfig};

pub const TARGET_SAMPLE_RATE: u32 = 16_000;

const DEFAULT_SPEECH_REDEMPTION_TIME: Duration = Duration::from_millis(150);
const MAX_CHUNK_SAMPLES: usize = TARGET_SAMPLE_RATE as usize * 25;

// Steady loud noise (aircraft cabins, trains, cafés) makes the VAD unreliable:
// it either finds no speech at all, or chops sentences into sub-second
// fragments that Whisper cannot transcribe in context. In that case, fall back
// to fixed windows over the audible parts and let the model's own no-speech
// handling discard noise. Quiet rooms keep the VAD chunks.
const AUDIBLE_RMS: f32 = 0.0056; // about -45 dBFS
const NOISY_FLOOR_RMS: f32 = 0.0178; // about -35 dBFS
const FALLBACK_MIN_AUDIBLE_SECONDS: usize = 3;
const FALLBACK_MAX_SPEECH_COVERAGE: f32 = 0.1;

pub fn chunk_channel_audio<E>(samples: &[f32]) -> Result<Vec<AudioChunk>, E>
where
    E: From<anlg_audio_chunking::Error>,
{
    let mut chunker =
        SpeechChunker::new(SpeechChunkingConfig::speech(DEFAULT_SPEECH_REDEMPTION_TIME))?;
    Ok(chunk_channel_audio_with(samples, &mut chunker)?)
}

fn chunk_channel_audio_with<C>(
    samples: &[f32],
    chunker: &mut C,
) -> Result<Vec<AudioChunk>, C::Error>
where
    C: Chunker,
{
    let mut chunks = chunker.chunk(samples, TARGET_SAMPLE_RATE)?;
    if let Some((reason, fallback)) = fallback_windows_when_vad_unreliable(samples, &chunks) {
        tracing::info!(
            reason,
            vad_chunk_count = chunks.len(),
            fallback_chunk_count = fallback.len(),
            "speech_chunking_fallback"
        );
        chunks = fallback;
    }
    let mut normalized = Vec::new();

    for chunk in chunks {
        if chunk.samples.len() <= MAX_CHUNK_SAMPLES {
            normalized.push(chunk);
            continue;
        }

        for (index, window) in chunk.samples.chunks(MAX_CHUNK_SAMPLES).enumerate() {
            let sample_start = chunk.sample_start + index * MAX_CHUNK_SAMPLES;
            let sample_end = sample_start + window.len();
            normalized.push(AudioChunk {
                samples: window.to_vec(),
                sample_start,
                sample_end,
            });
        }
    }

    tracing::info!(
        chunk_count = normalized.len(),
        chunk_durations_ms = ?normalized
            .iter()
            .map(|chunk| (chunk.sample_end - chunk.sample_start) * 1000 / TARGET_SAMPLE_RATE as usize)
            .collect::<Vec<_>>(),
        "audio_chunking_complete"
    );

    Ok(normalized)
}

fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt()
}

fn fallback_windows_when_vad_unreliable(
    samples: &[f32],
    chunks: &[AudioChunk],
) -> Option<(&'static str, Vec<AudioChunk>)> {
    let second = TARGET_SAMPLE_RATE as usize;
    let mut levels: Vec<f32> = samples.chunks(second).map(rms).collect();
    let audible_seconds = levels.iter().filter(|level| **level > AUDIBLE_RMS).count();
    if audible_seconds < FALLBACK_MIN_AUDIBLE_SECONDS {
        return None;
    }

    levels.sort_by(f32::total_cmp);
    let noise_floor = levels[levels.len() / 10];
    let speech_samples: usize = chunks
        .iter()
        .map(|chunk| chunk.sample_end - chunk.sample_start)
        .sum();
    let audible_samples = audible_seconds * second;

    let reason = if noise_floor > NOISY_FLOOR_RMS {
        "steady_background_noise"
    } else if (speech_samples as f32) < audible_samples as f32 * FALLBACK_MAX_SPEECH_COVERAGE {
        "vad_missed_audible_audio"
    } else {
        return None;
    };

    let windows: Vec<AudioChunk> = samples
        .chunks(MAX_CHUNK_SAMPLES)
        .enumerate()
        .filter(|(_, window)| rms(window) > AUDIBLE_RMS)
        .map(|(index, window)| {
            let sample_start = index * MAX_CHUNK_SAMPLES;
            AudioChunk {
                samples: window.to_vec(),
                sample_start,
                sample_end: sample_start + window.len(),
            }
        })
        .collect();

    (!windows.is_empty()).then_some((reason, windows))
}

pub fn split_resampled_channels(samples: &[f32], channel_count: usize) -> Vec<Vec<f32>> {
    if channel_count <= 1 {
        return vec![samples.to_vec()];
    }

    anlg_audio_utils::deinterleave(samples, channel_count)
}

pub fn channel_duration_sec(samples: &[f32]) -> f64 {
    samples.len() as f64 / TARGET_SAMPLE_RATE as f64
}

#[cfg(test)]
mod tests {
    use anlg_audio_chunking::{AudioChunk, Chunker};

    use super::*;
    use crate::{initial_resolved_until, next_resolved_until};

    struct FakeChunker {
        chunks: Vec<AudioChunk>,
    }

    impl Chunker for FakeChunker {
        type Error = std::convert::Infallible;

        fn chunk(
            &mut self,
            _samples: &[f32],
            _sample_rate: u32,
        ) -> Result<Vec<AudioChunk>, Self::Error> {
            Ok(self.chunks.clone())
        }
    }

    #[test]
    fn empty_audio_marks_channel_complete() {
        let chunks = chunk_channel_audio::<anlg_audio_chunking::Error>(&[]).unwrap();

        assert!(chunks.is_empty());
        assert_eq!(initial_resolved_until(&chunks, 40.0), 40.0);
    }

    #[test]
    fn oversized_chunks_are_split_at_generic_limit() {
        let oversized = MAX_CHUNK_SAMPLES + TARGET_SAMPLE_RATE as usize;
        let mut chunker = FakeChunker {
            chunks: vec![AudioChunk {
                samples: vec![1.0; oversized],
                sample_start: TARGET_SAMPLE_RATE as usize * 2,
                sample_end: TARGET_SAMPLE_RATE as usize * 2 + oversized,
            }],
        };

        let chunks = chunk_channel_audio_with(&vec![0.0; oversized], &mut chunker).unwrap();

        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].sample_start, TARGET_SAMPLE_RATE as usize * 2);
        assert_eq!(
            chunks[0].sample_end,
            TARGET_SAMPLE_RATE as usize * 2 + MAX_CHUNK_SAMPLES
        );
        assert_eq!(chunks[1].sample_start, chunks[0].sample_end);
        assert_eq!(chunks[1].samples.len(), TARGET_SAMPLE_RATE as usize);
    }

    #[test]
    fn resolved_progress_uses_sample_offsets() {
        let mut chunker = FakeChunker {
            chunks: vec![
                AudioChunk {
                    samples: vec![0.0; TARGET_SAMPLE_RATE as usize * 2],
                    sample_start: TARGET_SAMPLE_RATE as usize * 4,
                    sample_end: TARGET_SAMPLE_RATE as usize * 6,
                },
                AudioChunk {
                    samples: vec![0.0; TARGET_SAMPLE_RATE as usize * 3],
                    sample_start: TARGET_SAMPLE_RATE as usize * 8,
                    sample_end: TARGET_SAMPLE_RATE as usize * 11,
                },
            ],
        };

        let chunks =
            chunk_channel_audio_with(&vec![0.0; TARGET_SAMPLE_RATE as usize * 11], &mut chunker)
                .unwrap();

        assert_eq!(initial_resolved_until(&chunks, 20.0), 4.0);
        assert_eq!(next_resolved_until(&chunks, 0, 20.0), 8.0);
        assert_eq!(next_resolved_until(&chunks, 1, 20.0), 20.0);
    }

    const SECOND: usize = TARGET_SAMPLE_RATE as usize;

    fn loud(len: usize) -> Vec<f32> {
        (0..len)
            .map(|i| if i % 2 == 0 { 0.1 } else { -0.1 })
            .collect()
    }

    fn quiet_room_with_loud_section(total: usize, start: usize, end: usize) -> Vec<f32> {
        let mut samples = vec![0.0; total];
        samples[start..end].copy_from_slice(&loud(end - start));
        samples
    }

    fn spans(chunks: &[AudioChunk]) -> Vec<(usize, usize)> {
        chunks
            .iter()
            .map(|chunk| (chunk.sample_start, chunk.sample_end))
            .collect()
    }

    #[test]
    fn audible_audio_the_vad_missed_falls_back_to_windows() {
        let samples = quiet_room_with_loud_section(SECOND * 60, SECOND * 30, SECOND * 40);
        let mut chunker = FakeChunker { chunks: vec![] };

        let chunks = chunk_channel_audio_with(&samples, &mut chunker).unwrap();

        assert_eq!(
            spans(&chunks),
            vec![(MAX_CHUNK_SAMPLES, MAX_CHUNK_SAMPLES * 2)]
        );
    }

    #[test]
    fn steady_noise_replaces_fragmented_vad_chunks_with_windows() {
        let samples = loud(SECOND * 60);
        let fragments = (0..18)
            .map(|i| AudioChunk {
                samples: vec![0.0; SECOND],
                sample_start: i * SECOND * 3,
                sample_end: i * SECOND * 3 + SECOND,
            })
            .collect();
        let mut chunker = FakeChunker { chunks: fragments };

        let chunks = chunk_channel_audio_with(&samples, &mut chunker).unwrap();

        assert_eq!(
            spans(&chunks),
            vec![
                (0, MAX_CHUNK_SAMPLES),
                (MAX_CHUNK_SAMPLES, MAX_CHUNK_SAMPLES * 2),
                (MAX_CHUNK_SAMPLES * 2, SECOND * 60),
            ]
        );
    }

    #[test]
    fn quiet_room_keeps_vad_chunks() {
        let samples = quiet_room_with_loud_section(SECOND * 60, SECOND * 10, SECOND * 30);
        let speech = AudioChunk {
            samples: samples[SECOND * 10..SECOND * 30].to_vec(),
            sample_start: SECOND * 10,
            sample_end: SECOND * 30,
        };
        let mut chunker = FakeChunker {
            chunks: vec![speech],
        };

        let chunks = chunk_channel_audio_with(&samples, &mut chunker).unwrap();

        assert_eq!(spans(&chunks), vec![(SECOND * 10, SECOND * 30)]);
    }

    #[test]
    fn silent_audio_with_no_detected_speech_stays_empty() {
        let mut chunker = FakeChunker { chunks: vec![] };

        let chunks =
            chunk_channel_audio_with(&vec![0.0; TARGET_SAMPLE_RATE as usize * 60], &mut chunker)
                .unwrap();

        assert!(chunks.is_empty());
    }
}
