//! Removes what the microphone picked up from the speakers before a recording
//! is transcribed.
//!
//! Without headphones, the other side of a call plays through the speakers and
//! reaches the mic. When the live echo canceller can't keep up, the saved mic
//! still carries those words, and the transcript shows them twice: once from
//! Mac audio and once as if you had said them.
//!
//! Comparing transcripts can't tell an echo from you repeating someone on
//! purpose, which is most of a language lesson. The waveforms can: an echo is
//! a delayed, filtered copy of what Mac audio was playing, so the two line up
//! sharply at one delay, and that delay stays the same for the whole call
//! because it's the path from speakers to mic. Your own voice, even saying the
//! same words a moment later, doesn't line up with anything.
//!
//! So each second of mic speech that overlaps Mac audio is cross-correlated
//! with it (GCC-PHAT). It counts as echo when the match is unmistakable, or
//! when it's clear and sits at the call's usual speaker-to-mic delay. Checked
//! against two lessons and against the same audio shifted out of line: the
//! shifted audio never qualified.

use std::path::Path;

use anlg_audio_sync::GccPhatLagEstimator;
use anlg_transcribe_core::TARGET_SAMPLE_RATE;

use super::local::ResampledChannelFile;

/// 20 ms loudness frames.
pub(super) const ECHO_FRAME_SAMPLES: usize = TARGET_SAMPLE_RATE as usize / 50;
/// Below this amplitude a frame counts as silent. The saved mic is zeroed
/// between utterances, so this mostly separates speech from nothing.
const ECHO_SILENCE_AMPLITUDE: f32 = 0.003;
/// Utterances end after 300 ms of silence.
const ECHO_REGION_GAP_FRAMES: usize = 15;
/// Long utterances are judged one second at a time, so a sentence you start
/// over the other side keeps its own part.
const ECHO_WINDOW_FRAMES: usize = 50;
const ECHO_MIN_WINDOW_FRAMES: usize = 10;
/// Mac audio must be playing for at least half of a window to echo in it.
const ECHO_MIN_SYSTEM_ACTIVITY: f64 = 0.5;
/// About 2 s of audio around each window; longer than any window.
pub(super) const ECHO_ANALYSIS_SAMPLES: usize = 32_768;
/// Speakers-to-mic delays searched, up to ±500 ms.
const ECHO_MAX_LAG_SAMPLES: usize = TARGET_SAMPLE_RATE as usize / 2;
/// A correlation peak this far above the noise is an echo at any delay.
/// Out-of-line audio never got past 25.
const ECHO_UNMISTAKABLE_PEAK: f32 = 30.0;
/// At the call's usual delay, a clear peak is enough.
const ECHO_USUAL_DELAY_PEAK: f32 = 12.0;
const ECHO_USUAL_DELAY_TOLERANCE_SAMPLES: isize = 64;
/// The usual delay is the one at least three clear peaks agree on.
const ECHO_DELAY_VOTE_PEAK: f32 = 15.0;
const ECHO_DELAY_VOTE_TOLERANCE_SAMPLES: isize = 48;
const ECHO_DELAY_MIN_VOTES: usize = 3;

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub(super) struct EchoReport {
    /// Seconds of mic speech before removal.
    pub(super) mic_speech_seconds: f64,
    /// Seconds silenced as echo.
    pub(super) removed_seconds: f64,
    pub(super) removed_windows: usize,
    /// The speaker-to-mic delay most echoes shared, in milliseconds.
    pub(super) usual_delay_ms: Option<f64>,
}

impl EchoReport {
    pub(super) fn to_json(self) -> serde_json::Value {
        serde_json::json!({
            "mic_speech_seconds": round_tenths(self.mic_speech_seconds),
            "removed_seconds": round_tenths(self.removed_seconds),
            "removed_windows": self.removed_windows,
            "usual_delay_ms": self.usual_delay_ms.map(round_tenths),
        })
    }
}

fn round_tenths(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

/// A stretch of mic speech, in 20 ms frames `[start, end)`, and how well it
/// lines up with Mac audio.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct EchoCandidate {
    pub(super) start: usize,
    pub(super) end: usize,
    pub(super) lag_samples: isize,
    pub(super) peak_ratio: f32,
}

/// Returns a copy of the mic channel with echoed stretches silenced, or None
/// when nothing needed removing.
pub(super) fn remove_mic_echo(
    mic: &ResampledChannelFile,
    system: &ResampledChannelFile,
) -> Result<(Option<ResampledChannelFile>, EchoReport), String> {
    let mic_energy = frame_energies(mic.file.path())?;
    let system_energy = frame_energies(system.file.path())?;
    let frames = mic_energy.len().min(system_energy.len());
    let floor = ECHO_SILENCE_AMPLITUDE * ECHO_SILENCE_AMPLITUDE;
    let frame_seconds = ECHO_FRAME_SAMPLES as f64 / TARGET_SAMPLE_RATE as f64;

    let mut report = EchoReport::default();
    let mut windows = Vec::new();
    for (start, end) in speech_regions(&mic_energy[..frames], floor) {
        report.mic_speech_seconds += (end - start) as f64 * frame_seconds;
        for (window_start, window_end) in region_windows(start, end) {
            let len = window_end - window_start;
            let system_active = system_energy[window_start..window_end]
                .iter()
                .filter(|energy| **energy > floor)
                .count() as f64
                / len as f64;
            if len >= ECHO_MIN_WINDOW_FRAMES && system_active >= ECHO_MIN_SYSTEM_ACTIVITY {
                windows.push((window_start, window_end));
            }
        }
    }
    if windows.is_empty() {
        return Ok((None, report));
    }

    let candidates = measure_alignment(mic.file.path(), system.file.path(), &windows)?;
    let (echo, usual_delay) = classify_echo(&candidates);
    report.usual_delay_ms = usual_delay.map(|lag| lag as f64 * 1000.0 / TARGET_SAMPLE_RATE as f64);
    let echo_frames = echo
        .iter()
        .map(|candidate| (candidate.start, candidate.end))
        .collect::<Vec<_>>();
    report.removed_windows = echo_frames.len();
    report.removed_seconds = echo_frames
        .iter()
        .map(|(start, end)| (end - start) as f64 * frame_seconds)
        .sum();
    if echo_frames.is_empty() {
        return Ok((None, report));
    }
    let cleaned = silence_frames(mic, &echo_frames)?;
    Ok((Some(cleaned), report))
}

/// Which candidates are echo, and the usual speaker-to-mic delay if enough of
/// them agree on one.
pub(super) fn classify_echo(candidates: &[EchoCandidate]) -> (Vec<EchoCandidate>, Option<isize>) {
    let votes = candidates
        .iter()
        .filter(|candidate| candidate.peak_ratio >= ECHO_DELAY_VOTE_PEAK)
        .map(|candidate| candidate.lag_samples)
        .collect::<Vec<_>>();
    let usual_delay = votes
        .iter()
        .map(|lag| {
            let agreeing = votes
                .iter()
                .filter(|other| (*other - lag).abs() <= ECHO_DELAY_VOTE_TOLERANCE_SAMPLES)
                .count();
            (agreeing, *lag)
        })
        .filter(|(agreeing, _)| *agreeing >= ECHO_DELAY_MIN_VOTES)
        .max_by_key(|(agreeing, _)| *agreeing)
        .map(|(_, lag)| lag);

    let echo = candidates
        .iter()
        .copied()
        .filter(|candidate| {
            candidate.peak_ratio >= ECHO_UNMISTAKABLE_PEAK
                || usual_delay.is_some_and(|delay| {
                    candidate.peak_ratio >= ECHO_USUAL_DELAY_PEAK
                        && (candidate.lag_samples - delay).abs()
                            <= ECHO_USUAL_DELAY_TOLERANCE_SAMPLES
                })
        })
        .collect();
    (echo, usual_delay)
}

/// Cross-correlates each window of mic speech, on its own, with the ~2 s of
/// Mac audio around it.
fn measure_alignment(
    mic_path: &Path,
    system_path: &Path,
    windows: &[(usize, usize)],
) -> Result<Vec<EchoCandidate>, String> {
    let mut mic = hound::WavReader::open(mic_path).map_err(|e| e.to_string())?;
    let mut system = hound::WavReader::open(system_path).map_err(|e| e.to_string())?;
    let total = (mic.duration().min(system.duration())) as usize;
    if total < ECHO_ANALYSIS_SAMPLES {
        return Ok(Vec::new());
    }
    let mut estimator = GccPhatLagEstimator::new(ECHO_ANALYSIS_SAMPLES, ECHO_MAX_LAG_SAMPLES);
    let mut reference = vec![0.0_f32; ECHO_ANALYSIS_SAMPLES];
    let mut observed = vec![0.0_f32; ECHO_ANALYSIS_SAMPLES];
    let mut candidates = Vec::with_capacity(windows.len());

    for &(start, end) in windows {
        let window_start = start * ECHO_FRAME_SAMPLES;
        let window_end = (end * ECHO_FRAME_SAMPLES).min(total);
        let center = (window_start + window_end) / 2;
        let span_start = center
            .saturating_sub(ECHO_ANALYSIS_SAMPLES / 2)
            .min(total - ECHO_ANALYSIS_SAMPLES);

        read_into(&mut system, span_start, &mut reference)?;
        observed.fill(0.0);
        let offset = window_start - span_start;
        let len = (window_end - window_start).min(ECHO_ANALYSIS_SAMPLES - offset);
        read_into(&mut mic, window_start, &mut observed[offset..offset + len])?;

        if let Some(estimate) = estimator.estimate(&reference, &observed) {
            candidates.push(EchoCandidate {
                start,
                end,
                lag_samples: estimate.lag_samples,
                peak_ratio: estimate.peak_ratio,
            });
        }
    }
    Ok(candidates)
}

fn read_into(
    reader: &mut hound::WavReader<std::io::BufReader<std::fs::File>>,
    start: usize,
    output: &mut [f32],
) -> Result<(), String> {
    reader.seek(start as u32).map_err(|e| e.to_string())?;
    let mut filled = 0;
    for sample in reader.samples::<f32>().take(output.len()) {
        output[filled] = sample.map_err(|e| e.to_string())?;
        filled += 1;
    }
    output[filled..].fill(0.0);
    Ok(())
}

/// Mean square per 20 ms frame.
fn frame_energies(path: &Path) -> Result<Vec<f32>, String> {
    let mut reader = hound::WavReader::open(path).map_err(|e| e.to_string())?;
    let mut energies = Vec::new();
    let mut sum = 0.0_f32;
    let mut count = 0;
    for sample in reader.samples::<f32>() {
        let sample = sample.map_err(|e| e.to_string())?;
        sum += sample * sample;
        count += 1;
        if count == ECHO_FRAME_SAMPLES {
            energies.push(sum / count as f32);
            sum = 0.0;
            count = 0;
        }
    }
    Ok(energies)
}

/// Runs of loud frames, bridging pauses shorter than 300 ms.
fn speech_regions(energy: &[f32], floor: f32) -> Vec<(usize, usize)> {
    let mut regions = Vec::new();
    let mut index = 0;
    while index < energy.len() {
        if energy[index] <= floor {
            index += 1;
            continue;
        }
        let start = index;
        let mut last_loud = index;
        while index < energy.len() && index - last_loud < ECHO_REGION_GAP_FRAMES {
            if energy[index] > floor {
                last_loud = index;
            }
            index += 1;
        }
        regions.push((start, last_loud + 1));
    }
    regions
}

/// One-second windows; a short remainder joins the window before it.
fn region_windows(start: usize, end: usize) -> Vec<(usize, usize)> {
    if end - start <= ECHO_WINDOW_FRAMES * 2 {
        return vec![(start, end)];
    }
    let mut windows = Vec::new();
    let mut cursor = start;
    while end - cursor > ECHO_WINDOW_FRAMES * 3 / 2 {
        windows.push((cursor, cursor + ECHO_WINDOW_FRAMES));
        cursor += ECHO_WINDOW_FRAMES;
    }
    windows.push((cursor, end));
    windows
}

fn silence_frames(
    channel: &ResampledChannelFile,
    frames: &[(usize, usize)],
) -> Result<ResampledChannelFile, String> {
    let mut reader = hound::WavReader::open(channel.file.path()).map_err(|e| e.to_string())?;
    let spec = reader.spec();
    let file = tempfile::Builder::new()
        .prefix("mirna-mic-echo-removed-")
        .suffix(".wav")
        .tempfile()
        .map_err(|e| e.to_string())?;
    let mut writer = hound::WavWriter::create(file.path(), spec).map_err(|e| e.to_string())?;
    let mut ranges = frames.iter().peekable();
    let mut sample_count = 0;
    for (index, sample) in reader.samples::<f32>().enumerate() {
        let sample = sample.map_err(|e| e.to_string())?;
        let frame = index / ECHO_FRAME_SAMPLES;
        while ranges.peek().is_some_and(|(_, end)| frame >= *end) {
            ranges.next();
        }
        let silenced = ranges.peek().is_some_and(|(start, _)| frame >= *start);
        writer
            .write_sample(if silenced { 0.0 } else { sample })
            .map_err(|e| e.to_string())?;
        sample_count += 1;
    }
    writer.finalize().map_err(|e| e.to_string())?;
    Ok(ResampledChannelFile { file, sample_count })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(start: usize, lag_ms: isize, peak_ratio: f32) -> EchoCandidate {
        EchoCandidate {
            start,
            end: start + 20,
            lag_samples: lag_ms * TARGET_SAMPLE_RATE as isize / 1000,
            peak_ratio,
        }
    }

    #[test]
    fn echoes_share_the_call_delay_and_your_voice_does_not() {
        let candidates = [
            candidate(0, 81, 30.2),
            candidate(100, 81, 18.2),
            candidate(200, 82, 23.0),
            candidate(300, 83, 14.6),  // clear, at the usual delay: echo
            candidate(400, 76, 10.4),  // you, answering: weak peak
            candidate(500, -23, 31.4), // unmistakable at another delay: echo
            candidate(600, 187, 17.2), // clear but off the usual delay: kept
        ];
        let (echo, delay) = classify_echo(&candidates);
        assert!(
            delay.is_some_and(|lag| (81 * 16..=83 * 16).contains(&lag)),
            "{delay:?}"
        );
        assert_eq!(
            echo.iter().map(|c| c.start).collect::<Vec<_>>(),
            vec![0, 100, 200, 300, 500]
        );
    }

    #[test]
    fn scattered_peaks_from_unrelated_audio_remove_nothing() {
        // What out-of-line audio looked like: peaks up to ~25 at random delays.
        let candidates = [
            candidate(0, 86, 20.5),
            candidate(100, -482, 24.6),
            candidate(200, 157, 16.3),
            candidate(300, 304, 13.7),
            candidate(400, -128, 22.4),
        ];
        let (echo, delay) = classify_echo(&candidates);
        assert_eq!(delay, None);
        assert!(echo.is_empty());
    }

    #[test]
    fn splits_long_utterances_into_seconds() {
        assert_eq!(region_windows(0, 80), vec![(0, 80)]);
        assert_eq!(
            region_windows(0, 210),
            vec![(0, 50), (50, 100), (100, 150), (150, 210)]
        );
    }

    #[test]
    fn bridges_short_pauses_between_words() {
        let floor = ECHO_SILENCE_AMPLITUDE * ECHO_SILENCE_AMPLITUDE;
        let mut energy = vec![0.0; 40];
        energy[2..10].fill(1.0);
        energy[15..20].fill(1.0); // 100 ms pause: same utterance
        energy[36..38].fill(1.0); // 320 ms pause: a new one
        assert_eq!(speech_regions(&energy, floor), vec![(2, 20), (36, 38)]);
    }

    /// Speech-like noise: bursts of pseudo-random samples with pauses.
    fn babble(samples: usize, seed: u64) -> Vec<f32> {
        let mut state = seed;
        (0..samples)
            .map(|i| {
                state = state
                    .wrapping_mul(6364136223846793005)
                    .wrapping_add(1442695040888963407);
                let noise = ((state >> 33) as f32 / (1u64 << 31) as f32) - 0.5;
                let syllable = (i / 2400 + seed as usize) % 4;
                if syllable == 3 { 0.0 } else { noise * 0.3 }
            })
            .collect()
    }

    fn wav(samples: &[f32]) -> ResampledChannelFile {
        let file = tempfile::Builder::new().suffix(".wav").tempfile().unwrap();
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: TARGET_SAMPLE_RATE,
            bits_per_sample: 32,
            sample_format: hound::SampleFormat::Float,
        };
        let mut writer = hound::WavWriter::create(file.path(), spec).unwrap();
        for sample in samples {
            writer.write_sample(*sample).unwrap();
        }
        writer.finalize().unwrap();
        ResampledChannelFile {
            file,
            sample_count: samples.len(),
        }
    }

    #[test]
    fn silences_a_delayed_copy_of_mac_audio_and_keeps_your_own_speech() {
        let rate = TARGET_SAMPLE_RATE as usize;
        let system = babble(rate * 8, 7);
        // First 4 s: the mic hears the speakers 80 ms late, quieter.
        // Last 4 s: you talk over them.
        let delay = rate * 80 / 1000;
        let mut mic = vec![0.0_f32; rate * 8];
        for i in delay..rate * 4 {
            mic[i] = system[i - delay] * 0.25;
        }
        mic[rate * 4..].copy_from_slice(&babble(rate * 4, 99));

        let (cleaned, report) = remove_mic_echo(&wav(&mic), &wav(&system)).unwrap();
        let cleaned = cleaned.expect("echo should be removed");
        let samples = hound::WavReader::open(cleaned.file.path())
            .unwrap()
            .samples::<f32>()
            .map(Result::unwrap)
            .collect::<Vec<_>>();
        assert_eq!(samples.len(), mic.len());
        let energy =
            |range: std::ops::Range<usize>| samples[range].iter().map(|s| s * s).sum::<f32>();
        assert!(energy(rate..rate * 3) < 1e-6, "{report:?}");
        assert!(energy(rate * 5..rate * 7) > 1.0, "{report:?}");
        assert!(
            report.removed_seconds >= 2.0 && report.removed_seconds <= 4.5,
            "{report:?}"
        );
    }
}
