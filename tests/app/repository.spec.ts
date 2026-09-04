import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  removeAllChannels: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: supabaseMocks.createClient,
}));

import { SupabaseSocialRepository } from "../../src/social/repository.js";

describe("Supabase social client lifecycle", () => {
  beforeEach(() => {
    supabaseMocks.createClient.mockReset().mockReturnValue({
      auth: {},
      removeAllChannels: supabaseMocks.removeAllChannels,
    });
    supabaseMocks.removeAllChannels.mockReset();
  });

  it("constructs one auth client when repositories remount for the same project", () => {
    const config = {
      supabaseUrl: "https://strict-mode-test.supabase.co",
      supabasePublishableKey: "sb_publishable_strict_mode",
    };

    const first = new SupabaseSocialRepository(config);
    first.close();
    const second = new SupabaseSocialRepository({ ...config, supabaseUrl: `${config.supabaseUrl}/` });
    second.close();

    expect(supabaseMocks.createClient).toHaveBeenCalledTimes(1);
    expect(supabaseMocks.createClient).toHaveBeenCalledWith(
      config.supabaseUrl,
      config.supabasePublishableKey,
      { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } },
    );
    expect(supabaseMocks.removeAllChannels).not.toHaveBeenCalled();
  });

  it("rejects conflicting client credentials for one project", () => {
    const supabaseUrl = "https://conflicting-key-test.supabase.co";
    new SupabaseSocialRepository({
      supabaseUrl,
      supabasePublishableKey: "sb_publishable_first",
    });

    expect(() => new SupabaseSocialRepository({
      supabaseUrl,
      supabasePublishableKey: "sb_publishable_second",
    })).toThrow(/Conflicting public keys/);
    expect(supabaseMocks.createClient).toHaveBeenCalledTimes(1);
  });
});
