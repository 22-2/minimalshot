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
      if (cmd === "save_shot") return "C:/Pictures/MinimaShot/a.png";
    });
    useViewer.setState({ info: { id: 1, width: 10, height: 10, savedPath: null } });

    await useViewer.getState().save();

    expect(useViewer.getState().info?.savedPath).toBe("C:/Pictures/MinimaShot/a.png");
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
