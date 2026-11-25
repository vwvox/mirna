import {
  Directory,
  File,
  FileMode,
  Paths,
  type FileHandle,
} from "expo-file-system";

import { WAV_HEADER_BYTES, wavHeader } from "@/audio/pcm-wav";

export class SessionWavWriter {
  readonly file: File;

  private handle: FileHandle | null;
  private dataBytes = 0;
  private sampleRate = 16_000;
  private channels = 1;
  private initialized = false;
  private finalized = false;
  private checkpointDataBytes = 0;

  constructor(sessionId: string) {
    const directory = new Directory(Paths.document, "sessions", sessionId);
    directory.create({ intermediates: true, idempotent: true });
    this.file = new File(directory, "audio.wav");
    if (this.file.exists && this.file.size <= WAV_HEADER_BYTES) {
      this.file.delete();
    }
    this.file.create();
    this.handle = this.file.open(FileMode.ReadWrite);
  }

  append(buffer: ArrayBuffer, sampleRate: number, channels: number) {
    if (!this.handle || this.finalized) {
      throw new Error("Recording file is closed");
    }
    if (!this.initialized) {
      this.sampleRate = sampleRate;
      this.channels = channels;
      this.handle.writeBytes(wavHeader(0, sampleRate, channels));
      this.initialized = true;
    }
    if (sampleRate !== this.sampleRate || channels !== this.channels) {
      throw new Error("Audio stream format changed during recording");
    }
    const bytes = new Uint8Array(buffer);
    this.handle.writeBytes(bytes);
    this.dataBytes += bytes.byteLength;
    const checkpointIntervalBytes = this.sampleRate * this.channels * 2 * 5;
    if (this.dataBytes - this.checkpointDataBytes >= checkpointIntervalBytes) {
      this.writeHeader();
      this.checkpointDataBytes = this.dataBytes;
    }
  }

  get durationMs(): number {
    return (this.dataBytes * 1_000) / (this.sampleRate * this.channels * 2);
  }

  /** The file's size once its header is written. */
  get sizeBytes(): number {
    return WAV_HEADER_BYTES + this.dataBytes;
  }

  /** True once finalize() has written the header and closed the file. */
  get isFinalized(): boolean {
    return this.finalized;
  }

  finalize(): File {
    if (this.finalized) return this.file;
    if (!this.handle) throw new Error("Recording file is unavailable");
    if (!this.initialized) {
      this.handle.writeBytes(wavHeader(0, this.sampleRate, this.channels));
      this.initialized = true;
    }
    this.writeHeader();
    this.handle.close();
    this.handle = null;
    this.finalized = true;
    return this.file;
  }

  close() {
    if (this.handle && this.initialized) this.writeHeader();
    this.handle?.close();
    this.handle = null;
  }

  closeAndDiscardEmpty() {
    this.close();
    if (this.dataBytes === 0 && this.file.exists) this.file.delete();
  }

  private writeHeader() {
    if (!this.handle) throw new Error("Recording file is unavailable");
    const header = wavHeader(this.dataBytes, this.sampleRate, this.channels);
    this.handle.offset = 0;
    this.handle.writeBytes(header);
    this.handle.offset = header.byteLength + this.dataBytes;
  }
}

/**
 * Carries a recording on in the next part's file, in one synchronous step,
 * so every buffer lands in exactly one part: the ones before this call in
 * `current`, the ones after it in the returned writer. The next file is
 * opened first; if that fails, nothing changes and recording carries on in
 * `current`. A failure to finalize `current` is returned, not thrown: its
 * header was checkpointed, so recovery can still repair it.
 */
export function continueInNextPart(
  current: SessionWavWriter,
  nextSessionId: string,
): { next: SessionWavWriter; finalizeError: unknown } {
  const next = new SessionWavWriter(nextSessionId);
  let finalizeError: unknown = null;
  try {
    current.finalize();
  } catch (error) {
    finalizeError = error;
    try {
      current.close();
    } catch {}
  }
  return { next, finalizeError };
}
