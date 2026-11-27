//! Short teacher clips of a lesson, cut from its recording for the phones:
//! a review on the phone plays them without the whole recording.

use std::path::Path;
use std::time::Duration;

use anlg_audio_utils::Source;

/// Longest clip cut, whatever was asked.
const MAX_CLIP_MS: u64 = 60_000;

/// Cuts `[start_ms, end_ms)` of `audio` into a mono MP3 at `out`: one side of
/// a call recorded on the Mac (`channel` 0 the mic, 1 the call), or both
/// mixed. Returns the file's size and SHA-256.
pub(crate) fn cut_clip(
    audio: &Path,
    start_ms: u64,
    end_ms: u64,
    channel: Option<u8>,
    out: &Path,
) -> Result<(u64, String), String> {
    if end_ms <= start_ms {
        return Err("empty clip".into());
    }
    let length = (end_ms - start_ms).min(MAX_CLIP_MS);
    let decoder = anlg_audio_utils::source_from_path(audio).map_err(|error| error.to_string())?;
    let sample_rate: u32 = decoder.sample_rate().into();
    let channels: u16 = decoder.channels().into();
    let channels = usize::from(channels.max(1));
    let samples: Vec<f32> = decoder
        .skip_duration(Duration::from_millis(start_ms))
        .take_duration(Duration::from_millis(length))
        .collect();
    if samples.is_empty() {
        return Err("no audio in that stretch".into());
    }
    let mono: Vec<f32> = samples
        .chunks(channels)
        .map(|frame| match channel {
            Some(side) if usize::from(side) < frame.len() => frame[usize::from(side)],
            _ => frame.iter().sum::<f32>() / frame.len() as f32,
        })
        .collect();
    let mut encoder =
        anlg_mp3::MonoStreamEncoder::new(sample_rate).map_err(|error| error.to_string())?;
    let mut bytes = Vec::new();
    encoder
        .encode_f32(&mono, &mut bytes)
        .map_err(|error| error.to_string())?;
    encoder
        .flush(&mut bytes)
        .map_err(|error| error.to_string())?;
    if let Some(dir) = out.parent() {
        std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    }
    let partial = out.with_extension("part");
    std::fs::write(&partial, &bytes).map_err(|error| error.to_string())?;
    std::fs::rename(&partial, out).map_err(|error| error.to_string())?;
    let sha256 = anlg_phone_link::sha256_file(out).map_err(|error| error.to_string())?;
    Ok((bytes.len() as u64, sha256))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_stereo_wav(path: &Path, seconds: u32) {
        let spec = hound::WavSpec {
            channels: 2,
            sample_rate: 16_000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::create(path, spec).unwrap();
        for index in 0..(16_000 * seconds) {
            // A tone on the call side, silence on the mic side.
            let tone = ((index as f32) * 0.05).sin() * 8_000.0;
            writer.write_sample(0i16).unwrap();
            writer.write_sample(tone as i16).unwrap();
        }
        writer.finalize().unwrap();
    }

    #[test]
    fn cuts_one_side_of_a_call_into_a_small_mp3() {
        let dir = tempfile::tempdir().unwrap();
        let audio = dir.path().join("audio.wav");
        write_stereo_wav(&audio, 4);
        let out = dir.path().join("clips").join("c1000-3000-1.mp3");
        let (size, sha256) = cut_clip(&audio, 1_000, 3_000, Some(1), &out).unwrap();
        assert!(out.exists());
        assert_eq!(size, std::fs::metadata(&out).unwrap().len());
        assert_eq!(sha256.len(), 64);
        // Two seconds of 64 kbps mono is about 16 KB.
        assert!(size > 4_000 && size < 40_000, "{size}");
        assert!(!out.with_extension("part").exists());
    }

    #[test]
    fn refuses_an_empty_stretch() {
        let dir = tempfile::tempdir().unwrap();
        let audio = dir.path().join("audio.wav");
        write_stereo_wav(&audio, 1);
        let out = dir.path().join("x.mp3");
        assert!(cut_clip(&audio, 2_000, 2_000, None, &out).is_err());
        assert!(cut_clip(&audio, 5_000, 6_000, None, &out).is_err());
    }
}
