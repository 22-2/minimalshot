import { beforeEach, describe, expect, it } from "vitest";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

import { useViewer } from "../../src/stores/viewer";

describe("viewer store", () => {
  beforeEach(() => {
    useViewer.setState({ info: null, imageUrl: null, status: null });
    mockWindows("viewer-1");
  });

  it("records the saved path after saving", async () => {
    mockIPC((cmd) => {
      if (cmd === "save_shot") return "C:/Pictures/MinimalShot/a.png";
    });
    useViewer.setState({ info: { id: 1, width: 10, height: 10, savedPath: null } });

    await useViewer.getState().save();

    expect(useViewer.getState().info?.savedPath).toBe("C:/Pictures/MinimalShot/a.png");
    expect(useViewer.getState().status).toEqual({ tone: "info", text: "保存しました" });
  });

  it("surfaces backend errors", async () => {
    mockIPC((cmd) => {
      if (cmd === "copy_shot_path") throw "まだ保存されていません";
    });

    await useViewer.getState().copyPath();

    expect(useViewer.getState().status).toEqual({ tone: "error", text: "まだ保存されていません" });
  });
});

describe("viewer store save-as and delete", () => {
  beforeEach(() => {
    mockWindows("viewer-1");
    useViewer.setState({ info: { id: 1, width: 10, height: 10, savedPath: null }, status: null });
  });

  it("keeps state unchanged when save-as is cancelled", async () => {
    mockIPC((cmd) => (cmd === "save_shot_as" ? null : undefined));
    await useViewer.getState().saveAs();
    expect(useViewer.getState().info?.savedPath).toBeNull();
    expect(useViewer.getState().status).toBeNull();
  });

  it("forgets the saved path after deleting", async () => {
    mockIPC(() => undefined);
    useViewer.setState({ info: { id: 1, width: 10, height: 10, savedPath: "C:/a.png" } });
    await useViewer.getState().deleteSaved();
    expect(useViewer.getState().info?.savedPath).toBeNull();
    expect(useViewer.getState().status).toEqual({ tone: "info", text: "ごみ箱に移動しました" });
  });
});
