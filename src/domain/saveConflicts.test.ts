import { expect, it, vi } from "vitest";
import { hasSaveConflict, markSaveConflict, subscribeSaveConflicts } from "./saveConflicts";

it("登记过冲突的画布一直算冲突，别的画布不受影响", () => {
  expect(hasSaveConflict("conflict-a")).toBe(false);
  markSaveConflict("conflict-a");
  expect(hasSaveConflict("conflict-a")).toBe(true);
  expect(hasSaveConflict("conflict-b")).toBe(false);
});

it("新登记冲突时通知订阅的人，重复登记不再通知，退订后不再收到", () => {
  const listener = vi.fn();
  const unsubscribe = subscribeSaveConflicts(listener);
  markSaveConflict("conflict-c");
  expect(listener).toHaveBeenCalledTimes(1);
  markSaveConflict("conflict-c");
  expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe();
  markSaveConflict("conflict-d");
  expect(listener).toHaveBeenCalledTimes(1);
});
