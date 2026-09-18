"use strict";

import { v7 as uuidv7 } from "uuid";
import uuid62 from "uuid62";

const NEW_ARTIFACT_ID_PATTERN = /^[A-Z][A-Z0-9]*-[0-9A-Za-z]{22}$/;
const LEGACY_ARTIFACT_ID_PATTERN = /^[A-Z][A-Z0-9]*-\d+$/;
const ID_PREFIX_PATTERN = /^[A-Z][A-Z0-9]*$/;

function encodeUuidToPayload(uuid: string): string {
  return uuid62.encode(uuid);
}

function decodePayloadToUuid(payload: string): string {
  return uuid62.decode(payload);
}

function generateArtifactId(idPrefix: string): string {
  if (!ID_PREFIX_PATTERN.test(idPrefix)) {
    throw new Error(`Invalid artifact id prefix: ${idPrefix}`);
  }
  return `${idPrefix}-${uuid62.encode(uuidv7())}`;
}

function isNewArtifactId(value: string): boolean {
  return NEW_ARTIFACT_ID_PATTERN.test(value.trim());
}

function isLegacyArtifactId(value: string): boolean {
  return LEGACY_ARTIFACT_ID_PATTERN.test(value.trim());
}

export {
  decodePayloadToUuid,
  encodeUuidToPayload,
  generateArtifactId,
  isLegacyArtifactId,
  isNewArtifactId,
};
