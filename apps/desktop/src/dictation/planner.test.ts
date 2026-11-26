import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  stt: {
    conn: null as {
      provider: string;
      model: string;
      baseUrl: string;
      apiKey: string;
    } | null,
    isLocalModel: false,
    isCloudModel: false,
  },
  batchSupported: true,
  uploads: [] as { path: string; provider?: string; baseUrl?: string }[],
  account: "user-1",
  getSessionForRequest: vi.fn(),
  microphone: "",
  learning: false,
  config: {} as Record<string, unknown>,
  sttOverride: undefined as unknown,
  llmOverride: undefined as unknown,
  refine: vi.fn(),
  stored: {} as Record<string, string>,
  // A settings write waits its turn in the database queue before its updater runs.
  queue: Promise.resolve() as Promise<void>,
  queued: 0,
  record: null as
    | null
    | ((request: {
        weights: string | null;
        event: unknown;
      }) => Promise<string>),
}));

vi.mock("@tauri-apps/plugin-os", () => ({
  platform: () => "macos",
  arch: () => "aarch64",
}));
vi.mock("~/stt/useSTTConnection", () => ({
  useSTTConnection: (override: unknown) => {
    mocks.sttOverride = override;
    return mocks.stt;
  },
}));
vi.mock("~/stt/useRunBatch", () => ({
  getBatchProvider: (provider: string) =>
    provider === "anarlog" ? "soniqo" : provider,
  useRunBatch:
    () =>
    async (
      path: string,
      options: {
        provider?: string;
        baseUrl?: string;
        handlePersist: (words: { text: string; start_ms: number }[]) => void;
      },
    ) => {
      mocks.uploads.push({
        path,
        provider: options.provider,
        baseUrl: options.baseUrl,
      });
      options.handlePersist([{ text: " Local words.", start_ms: 0 }]);
    },
}));
vi.mock("~/stt/capabilities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/stt/capabilities")>()),
  isSupportedLanguagesBatch: async () => mocks.batchSupported,
}));
vi.mock("~/auth", () => ({
  useAuth: () => ({
    session: { user: { id: mocks.account } },
    getSessionForRequest: mocks.getSessionForRequest,
  }),
}));
vi.mock("~/ai/hooks/useLLMConnection", () => ({
  useLanguageModel: (_task: unknown, override: unknown) => {
    mocks.llmOverride = override;
    return null;
  },
}));
vi.mock("~/ai/dictation-refine", () => ({
  refineDictation: (args: unknown) => mocks.refine(args),
}));
vi.mock("~/settings/queries", () => ({
  useSettingsReady: () => true,
  getStoredSettingValues: async () => ({ values: { ...mocks.stored } }),
  updateSettingValue: async (
    key: string,
    update: (current: string | undefined) => string,
  ) => {
    mocks.queued += 1;
    await mocks.queue;
    mocks.stored[key] = update(mocks.stored[key]);
  },
}));
vi.mock("~/shared/config", () => ({
  resolveConfigValue: (
    key: string,
    stored: { values: Record<string, string> },
  ) =>
    key === "personalization_dictionary_terms"
      ? []
      : (stored.values[key] ?? ""),
  useConfigValues: (keys: readonly string[]) =>
    Object.fromEntries(
      keys.map((key) => [
        key,
        key in mocks.config
          ? mocks.config[key]
          : key === "spoken_languages" ||
              key === "personalization_dictionary_terms"
            ? []
            : key === "dictation_learning"
              ? mocks.learning
              : key === "microphone_device"
                ? mocks.microphone
                : key.startsWith("dictation_")
                  ? false
                  : "",
      ]),
    ),
}));
vi.mock("@anlg/plugin-dictation", () => ({
  commands: {
    rankDictationTerms: async () => [],
    recordDictationTerms: (request: {
      weights: string | null;
      event: unknown;
    }) => mocks.record!(request),
    suggestDictationTerms: async () => ["Anarlog"],
  },
}));

import { useDictationPlanner } from "./planner";

const LOCAL = {
  provider: "anarlog",
  model: "soniqo-parakeet-batch",
  baseUrl: "http://127.0.0.1:50060",
  apiKey: "",
};

describe("dictation planner", () => {
  beforeEach(() => {
    mocks.stt = { conn: LOCAL, isLocalModel: true, isCloudModel: false };
    mocks.batchSupported = true;
    mocks.uploads = [];
    mocks.account = "user-1";
    mocks.getSessionForRequest.mockReset();
    mocks.getSessionForRequest.mockResolvedValue(null);
    mocks.microphone = "";
    mocks.learning = true;
    mocks.config = {};
    mocks.sttOverride = undefined;
    mocks.llmOverride = undefined;
    mocks.refine.mockReset();
    mocks.refine.mockResolvedValue({
      type: "raw",
      text: "",
      reason: "cleanupOff",
    });
    mocks.stored = {};
    mocks.queue = Promise.resolve();
    mocks.queued = 0;
    // Weights as a list of recorded events, so lost updates show.
    mocks.record = async ({ weights, event }) =>
      JSON.stringify([...JSON.parse(weights ?? "[]"), event]);
  });

  it("uses the main models until dictation has its own provider and model", async () => {
    mocks.config = {
      dictation_stt_provider: "soniqo",
      dictation_stt_model: "",
    };
    renderHook(() => useDictationPlanner("dictation-1"));
    expect(mocks.sttOverride).toBeNull();
    expect(mocks.llmOverride).toBeNull();

    mocks.config = {
      dictation_stt_provider: "soniqo",
      dictation_stt_model: "soniqo-parakeet-streaming",
      dictation_llm_provider: "groq",
      dictation_llm_model: "llama-fast",
    };
    renderHook(() => useDictationPlanner("dictation-1"));
    expect(mocks.sttOverride).toEqual({
      provider: "soniqo",
      model: "soniqo-parakeet-streaming",
    });
    expect(mocks.llmOverride).toEqual({
      provider: "groq",
      model: "llama-fast",
    });
  });

  it("points a local failure of dictation's own speech model at Dictation settings", async () => {
    mocks.config = {
      dictation_stt_provider: "soniqo",
      dictation_stt_model: "soniqo-parakeet-streaming",
    };
    mocks.stt = { conn: null, isLocalModel: true, isCloudModel: false };
    const { result } = renderHook(() => useDictationPlanner("dictation-1"));

    await expect(
      result.current.plan({ accountId: "user-1", context: null }),
    ).rejects.toThrow(/Settings > Dictation; Mirna won't send it/u);
  });

  it("cleans up in the style chosen for the kind of app the text goes into", async () => {
    mocks.config = {
      dictation_style_personal: "veryCasual",
      dictation_style_other: "casual",
    };
    const { result } = renderHook(() => useDictationPlanner("dictation-1"));
    const refine = async (app: { bundleId: string; appName: null } | null) => {
      const plan = await result.current.plan({
        accountId: "user-1",
        context: null,
        app,
      });
      await plan.refine(
        {
          operationId: "op",
          text: "see you at six",
          selection: null,
          before: null,
          context: null,
        },
        new AbortController().signal,
      );
      return mocks.refine.mock.lastCall![0].request.style;
    };

    await expect(
      refine({ bundleId: "com.apple.MobileSMS", appName: null }),
    ).resolves.toBe("veryCasual");
    await expect(refine(null)).resolves.toBe("casual");
    await expect(
      refine({ bundleId: "com.apple.mail", appName: null }),
    ).resolves.toBe("formal");
  });

  it("transcribes a local recording on the selected local model", async () => {
    const { result } = renderHook(() => useDictationPlanner("dictation-1"));
    const plan = await result.current.plan({
      accountId: "user-1",
      context: null,
    });

    expect(plan.policy).toEqual({
      provider: "anarlog",
      model: "soniqo-parakeet-batch",
      localOnly: true,
    });
    await expect(
      plan.transcribe("/tmp/a.wav", new AbortController().signal),
    ).resolves.toBe("Local words.");
    expect(mocks.uploads).toEqual([
      { path: "/tmp/a.wav", provider: "anarlog", baseUrl: LOCAL.baseUrl },
    ]);
  });

  it("streams a local route to its own server on the selected microphone, without a cloud token", async () => {
    mocks.microphone = "USB microphone";
    const { result } = renderHook(() => useDictationPlanner("dictation-1"));
    const plan = await result.current.plan({
      accountId: "user-1",
      context: null,
    });

    expect(plan.microphoneDevice).toBe("USB microphone");
    await expect(plan.stream()).resolves.toMatchObject({
      provider: "anarlog",
      baseUrl: LOCAL.baseUrl,
      apiKey: "",
    });
    expect(mocks.getSessionForRequest).not.toHaveBeenCalled();
  });

  it("streams the cloud route with a fresh session, and keeps recording without a stream when it can't refresh", async () => {
    mocks.stt = {
      conn: {
        provider: "anarlog",
        model: "cloud",
        baseUrl: "https://api.anarlog.so/stt",
        apiKey: "stale",
      },
      isLocalModel: false,
      isCloudModel: true,
    };
    mocks.getSessionForRequest.mockResolvedValueOnce({ access_token: "fresh" });
    const { result } = renderHook(() => useDictationPlanner("dictation-1"));
    const plan = await result.current.plan({
      accountId: "user-1",
      context: null,
    });

    expect(plan.policy).toEqual({
      provider: "anarlog",
      model: "cloud",
      localOnly: false,
    });
    await expect(plan.stream()).resolves.toMatchObject({ apiKey: "fresh" });
    mocks.getSessionForRequest.mockRejectedValueOnce(new Error("offline"));
    await expect(plan.stream()).resolves.toBeNull();
    await expect(
      plan.transcribe("/tmp/a.wav", new AbortController().signal),
    ).resolves.toBe("Local words.");
    expect(mocks.uploads).toEqual([
      {
        path: "/tmp/a.wav",
        provider: "anarlog",
        baseUrl: "https://api.anarlog.so/stt",
      },
    ]);
  });

  it("refuses a local recording instead of falling back to the cloud when the local model cannot batch it", async () => {
    const { result } = renderHook(() => useDictationPlanner("dictation-1"));
    const plan = await result.current.plan({
      accountId: "user-1",
      context: null,
    });
    mocks.batchSupported = false;

    await expect(
      plan.transcribe("/tmp/a.wav", new AbortController().signal),
    ).rejects.toThrow(/won't send it to a cloud provider/u);
    expect(mocks.uploads).toEqual([]);
  });

  it("refuses a local recording after the local server went away", async () => {
    const { result, rerender } = renderHook(() =>
      useDictationPlanner("dictation-1"),
    );
    const plan = await result.current.plan({
      accountId: "user-1",
      context: null,
    });
    mocks.stt = { conn: null, isLocalModel: true, isCloudModel: false };
    rerender();

    await expect(
      plan.transcribe("/tmp/a.wav", new AbortController().signal),
    ).rejects.toThrow(/won't send it to a cloud provider/u);
    expect(mocks.uploads).toEqual([]);
  });

  it("does not start a local dictation before the local model is ready", async () => {
    mocks.stt = { conn: null, isLocalModel: true, isCloudModel: false };
    const { result } = renderHook(() => useDictationPlanner("dictation-1"));

    await expect(
      result.current.plan({ accountId: "user-1", context: null }),
    ).rejects.toThrow(/won't send it to a cloud provider/u);
  });

  describe("learning", () => {
    it("writes nothing when the account switches while native weighs the terms", async () => {
      let finish!: (weights: string) => void;
      mocks.record = () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        });
      const { result, rerender } = renderHook(() =>
        useDictationPlanner("dictation-1"),
      );
      const used = result.current.used("user-1", "hello Anarlog");
      await vi.waitFor(() => expect(finish).toBeDefined());
      mocks.account = "user-2";
      rerender();
      finish("weights-for-user-1");
      await used;

      expect(mocks.stored).toEqual({});
    });

    it("writes nothing when learning is turned off while suggestions are weighed", async () => {
      let finish!: (weights: string) => void;
      mocks.record = () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        });
      const { result, rerender } = renderHook(() =>
        useDictationPlanner("dictation-1"),
      );
      const kept = result.current.kept(
        "user-1",
        "hello anarlock",
        "hello Anarlog",
        () => true,
      );
      await vi.waitFor(() => expect(finish).toBeDefined());
      mocks.learning = false;
      rerender();
      finish("weights");
      await kept;

      expect(mocks.stored).toEqual({});
    });

    it.each([
      ["the account switches", "used"],
      ["learning is turned off", "kept"],
    ] as const)(
      "writes nothing when %s while the settings write waits in the queue",
      async (change, call) => {
        let unblock!: () => void;
        mocks.queue = new Promise<void>((resolve) => {
          unblock = resolve;
        });
        const { result, rerender } = renderHook(() =>
          useDictationPlanner("dictation-1"),
        );
        const writing =
          call === "used"
            ? result.current.used("user-1", "hello Anarlog")
            : result.current.kept(
                "user-1",
                "hello anarlock",
                "hello Anarlog",
                () => true,
              );
        await vi.waitFor(() => expect(mocks.queued).toBe(1));
        if (change === "the account switches") mocks.account = "user-2";
        else mocks.learning = false;
        rerender();
        unblock();
        await writing;

        expect(mocks.stored).toEqual({});
      },
    );

    it("keeps both weight updates when two dictations record at once", async () => {
      const { result } = renderHook(() => useDictationPlanner("dictation-1"));
      await Promise.all([
        result.current.used("user-1", "first"),
        result.current.used("user-1", "second"),
      ]);

      expect(JSON.parse(mocks.stored.dictation_term_weights!)).toEqual([
        { type: "used", text: "first" },
        { type: "used", text: "second" },
      ]);
    });
  });
});
