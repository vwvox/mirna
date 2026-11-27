import { describe, expect, it, vi } from "vitest";

import {
  configureCenteredPlayback,
  routeCentered,
  shouldResumeBeforePlay,
} from "./playback";

function createFakeContext() {
  const destination = {};
  const gainNode = {
    channelCount: 2,
    channelCountMode: "max",
    channelInterpretation: "discrete",
    connect: vi.fn(),
  };
  const source = { connect: vi.fn() };
  const context = {
    close: vi.fn().mockResolvedValue(undefined),
    createGain: vi.fn(() => gainNode),
    createMediaElementSource: vi.fn(() => source),
    destination,
  };
  return { context, destination, gainNode, source };
}

describe("configureCenteredPlayback", () => {
  it("routes the media element through a centered mono gain node", () => {
    const { context, destination, gainNode, source } = createFakeContext();
    const media = {} as HTMLMediaElement;

    expect(
      configureCenteredPlayback(
        media,
        () => context as unknown as AudioContext,
      ),
    ).toBe(context);
    expect(context.createMediaElementSource).toHaveBeenCalledWith(media);
    expect(source.connect).toHaveBeenCalledWith(gainNode);
    expect(gainNode.connect).toHaveBeenCalledWith(destination);
    expect(gainNode).toMatchObject({
      channelCount: 1,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
    });
  });

  it("keeps plain media-element playback when Web Audio is unavailable", () => {
    expect(
      configureCenteredPlayback({} as HTMLMediaElement, () => {
        throw new Error("unsupported");
      }),
    ).toBeNull();
  });

  it("closes the context when the element cannot be routed", () => {
    const { context } = createFakeContext();
    context.createMediaElementSource.mockImplementation(() => {
      throw new Error("already connected");
    });

    expect(
      configureCenteredPlayback(
        {} as HTMLMediaElement,
        () => context as unknown as AudioContext,
      ),
    ).toBeNull();
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it("does not reroute the element when gain setup fails", () => {
    const { context } = createFakeContext();
    context.createGain.mockImplementation(() => {
      throw new Error("unsupported");
    });

    expect(
      configureCenteredPlayback(
        {} as HTMLMediaElement,
        () => context as unknown as AudioContext,
      ),
    ).toBeNull();
    expect(context.createMediaElementSource).not.toHaveBeenCalled();
  });
});

describe("shouldResumeBeforePlay", () => {
  it.each([
    ["suspended", true],
    ["interrupted", true],
    ["running", false],
    ["closed", false],
  ])("returns %s -> %s", (state, expected) => {
    expect(shouldResumeBeforePlay({ state } as unknown as AudioContext)).toBe(
      expected,
    );
  });

  it("returns false without a context", () => {
    expect(shouldResumeBeforePlay(null)).toBe(false);
  });
});

describe("routeCentered", () => {
  function graph() {
    const destination = {};
    const mono = {
      channelCount: 2,
      channelCountMode: "max",
      channelInterpretation: "discrete",
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    const splitter = { connect: vi.fn(), disconnect: vi.fn() };
    const source = { connect: vi.fn(), disconnect: vi.fn() };
    const context = {
      createGain: vi.fn(() => mono),
      createChannelSplitter: vi.fn(() => splitter),
      destination,
    };
    return { context, destination, mono, source, splitter };
  }

  it("mixes both channels into one voice in both ears", () => {
    const { context, destination, mono, source } = graph();
    const route = routeCentered(
      context as unknown as AudioContext,
      source as unknown as AudioNode,
    );
    expect(route.output).toBe(mono);
    expect(source.connect).toHaveBeenCalledWith(mono);
    expect(mono.connect).toHaveBeenCalledWith(destination);
    expect(context.createChannelSplitter).not.toHaveBeenCalled();
    expect(mono).toMatchObject({
      channelCount: 1,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
    });
  });

  it("plays only the chosen channel, in both ears", () => {
    const { context, mono, source, splitter } = graph();
    const route = routeCentered(
      context as unknown as AudioContext,
      source as unknown as AudioNode,
      1,
    );
    expect(context.createChannelSplitter).toHaveBeenCalledWith(2);
    expect(source.connect).toHaveBeenCalledWith(splitter);
    expect(source.connect).not.toHaveBeenCalledWith(mono);
    expect(splitter.connect).toHaveBeenCalledWith(mono, 1);

    route.disconnect();
    expect(source.disconnect).toHaveBeenCalled();
    expect(splitter.disconnect).toHaveBeenCalled();
    expect(mono.disconnect).toHaveBeenCalled();
  });
});
