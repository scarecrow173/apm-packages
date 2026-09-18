import assert from "node:assert/strict";
import test from "node:test";

import {
  decodePayloadToUuid,
  encodeUuidToPayload,
  generateArtifactId,
  isLegacyArtifactId,
  isNewArtifactId,
} from "../src/skills/lib/artifact_id";

test("encodeUuidToPayload matches golden vectors", () => {
  assert.equal(
    encodeUuidToPayload("00000000-0000-0000-0000-000000000000"),
    "0000000000000000000000",
  );
  assert.equal(
    encodeUuidToPayload("ffffffff-ffff-ffff-ffff-ffffffffffff"),
    "7N42dgm5tFLK9N8MT7fHC7",
  );
  assert.equal(
    encodeUuidToPayload("01a0b370-64e3-7468-91eb-ab4935e4d903"),
    "034qPUpBj0VYOqxmFLijD5",
  );
});

test("encodeUuidToPayload always returns 22 base62 characters", () => {
  for (const uuid of [
    "01990fbe-5d5c-7c3f-9c8d-0f2f5b9b2a11",
    "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    "00112233-4455-6677-8899-aabbccddeeff",
  ]) {
    const payload = encodeUuidToPayload(uuid);
    assert.equal(payload.length, 22);
    assert.match(payload, /^[0-9A-Za-z]{22}$/);
  }
});

test("decodePayloadToUuid round-trips encodeUuidToPayload", () => {
  const uuid = "01990fbe-5d5c-7c3f-9c8d-0f2f5b9b2a11";
  assert.equal(decodePayloadToUuid(encodeUuidToPayload(uuid)), uuid);
});

test("generateArtifactId returns PREFIX-payload with 22-char payload", () => {
  const id = generateArtifactId("SPEC");
  assert.match(id, /^SPEC-[0-9A-Za-z]{22}$/);
  const adr = generateArtifactId("ADR");
  assert.match(adr, /^ADR-[0-9A-Za-z]{22}$/);
});

test("generateArtifactId yields unique ids across many generations", () => {
  const ids = new Set<string>();
  for (let index = 0; index < 512; index += 1) {
    ids.add(generateArtifactId("TASK"));
  }
  assert.equal(ids.size, 512);
});

test("generateArtifactId produces v7-version uuids in payloads", () => {
  const id = generateArtifactId("PLAN");
  const uuid = decodePayloadToUuid(id.slice("PLAN-".length));
  assert.equal(uuid[14], "7");
});

test("generateArtifactId rejects invalid prefixes", () => {
  assert.throws(() => generateArtifactId(""));
  assert.throws(() => generateArtifactId("spec"));
  assert.throws(() => generateArtifactId("BAD PREFIX"));
});

test("isNewArtifactId accepts the new contract and rejects other shapes", () => {
  assert.equal(isNewArtifactId("SPEC-034qPUpBj0VYOqxmFLijD5"), true);
  assert.equal(isNewArtifactId("TASK-7N42dgm5tFLK9N8MT7fHC7"), true);
  assert.equal(isNewArtifactId("IMPL-0000000000000000000000"), true);
  assert.equal(isNewArtifactId("SPEC-0001"), false);
  assert.equal(isNewArtifactId("SPEC-034qPUpBj0VYOqxmFLij"), false);
  assert.equal(isNewArtifactId("SPEC-034qPUpBj0VYOqxmFLijD5x"), false);
  assert.equal(isNewArtifactId("spec-034qPUpBj0VYOqxmFLijD5"), false);
  assert.equal(isNewArtifactId("SPEC-034qPUpBj0VYOqxmFLij!5"), false);
  assert.equal(isNewArtifactId("034qPUpBj0VYOqxmFLijD5"), false);
  assert.equal(isNewArtifactId(""), false);
});

test("isLegacyArtifactId accepts TYPE-NNNN style ids only", () => {
  assert.equal(isLegacyArtifactId("SPEC-0001"), true);
  assert.equal(isLegacyArtifactId("ADR-42"), true);
  assert.equal(isLegacyArtifactId("IMPL-0012"), true);
  assert.equal(isLegacyArtifactId("SPEC-034qPUpBj0VYOqxmFLijD5"), false);
  assert.equal(isLegacyArtifactId("DESIGN-OVERVIEW"), false);
  assert.equal(isLegacyArtifactId(""), false);
});
