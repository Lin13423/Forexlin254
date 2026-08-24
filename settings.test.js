// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../ag-utils.js";
import "../error-utils.js";
import { initSettings, openSettings, saveSettings } from "../settings.js";

const UID = "uid-123";
const PROFILE_PATH = `profiles/${UID}`;
const CACHE_KEY = `ag_profile_cache_${UID}`;

let firebaseMock;
let db;

function renderSettingsMarkup() {
  document.body.innerHTML = `
    <input id="set-business-name" value="stale name">
    <input id="set-business-tagline" value="stale tagline">
    <div id="settingsModal" style="display: none"></div>
  `;
}

const nameInput = () => document.getElementById("set-business-name");
const taglineInput = () => document.getElementById("set-business-tagline");
const modal = () => document.getElementById("settingsModal");

beforeEach(() => {
  renderSettingsMarkup();
  localStorage.clear();
  db = { name: "db" };
  firebaseMock = {
    set: vi.fn(async () => undefined),
    ref: vi.fn((database, path) => ({ database, path }))
  };
  globalThis.__firebaseMock = firebaseMock;
  vi.stubGlobal("alert", vi.fn());
  initSettings(db, PROFILE_PATH, { businessName: "Remote Co", tagline: "Remote tag" }, UID);
});

afterEach(() => {
  delete globalThis.__firebaseMock;
  vi.unstubAllGlobals();
});

describe("openSettings", () => {
  it("prefers the cached profile over the remote profile", () => {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ businessName: "Cached Co", tagline: "Cached tag" })
    );

    openSettings();

    expect(nameInput().value).toBe("Cached Co");
    expect(taglineInput().value).toBe("Cached tag");
    expect(modal().style.display).toBe("flex");
  });

  it("falls back to the profile passed to initSettings when no cache exists", () => {
    openSettings();

    expect(nameInput().value).toBe("Remote Co");
    expect(taglineInput().value).toBe("Remote tag");
  });

  it("reads the cache entry scoped to the current user", () => {
    localStorage.setItem(
      "ag_profile_cache_other-uid",
      JSON.stringify({ businessName: "Other Co", tagline: "Other tag" })
    );

    openSettings();

    expect(nameInput().value).toBe("Remote Co");
  });

  it("clears the inputs when the profile has no business name or tagline", () => {
    initSettings(db, PROFILE_PATH, {}, UID);

    openSettings();

    expect(nameInput().value).toBe("");
    expect(taglineInput().value).toBe("");
  });
});

describe("saveSettings", () => {
  beforeEach(() => {
    nameInput().value = "New Co";
    taglineInput().value = "New tag";
    modal().style.display = "flex";
  });

  it("writes the form values to the profile path", async () => {
    await saveSettings();

    expect(firebaseMock.ref).toHaveBeenCalledWith(db, PROFILE_PATH);
    expect(firebaseMock.set).toHaveBeenCalledWith(
      { database: db, path: PROFILE_PATH },
      { businessName: "New Co", tagline: "New tag" }
    );
  });

  it("refreshes the local cache with the saved values", async () => {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ businessName: "Cached Co", tagline: "Cached tag" })
    );

    await saveSettings();

    expect(JSON.parse(localStorage.getItem(CACHE_KEY))).toEqual({
      businessName: "New Co",
      tagline: "New tag"
    });
  });

  it("closes the modal and confirms the update", async () => {
    await saveSettings();

    expect(modal().style.display).toBe("none");
    expect(globalThis.alert).toHaveBeenCalledWith("Profile Updated Successfully");
  });

  it("does not close the modal or cache anything when the write fails", async () => {
    firebaseMock.set.mockRejectedValue(new Error("permission denied"));
    const report = vi.spyOn(globalThis.AGErrors, "report");

    await saveSettings();

    expect(report).toHaveBeenCalled();
    expect(modal().style.display).toBe("flex");
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
    expect(globalThis.alert).toHaveBeenCalledWith("Profile save failed: permission denied");
    report.mockRestore();
  });
});
