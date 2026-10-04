import assert from "node:assert/strict";
import test from "node:test";
import { deadlineBoundExpiry } from "../src/lesson_image_handoff";

test("a learner link cannot remain valid after the assignment deadline", () => {
  const now = new Date("2026-09-14T09:00:00.000Z");
  const deadline = new Date("2026-09-14T09:20:00.000Z");

  assert.equal(deadlineBoundExpiry(deadline, 3_600, now), 1_200);
  assert.equal(deadlineBoundExpiry(deadline, 300, now), 300);
});
