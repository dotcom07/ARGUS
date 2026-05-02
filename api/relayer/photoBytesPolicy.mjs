export const MAX_NATIVE_CAPTURE_PHOTO_BYTES = 20 * 1024 * 1024;
export const MAX_NATIVE_CAPTURE_PHOTO_BASE64_LENGTH =
  Math.ceil(MAX_NATIVE_CAPTURE_PHOTO_BYTES / 3) * 4;

export function assertPhotoBytesBase64TextLimit(field, value, requiredContext) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} is required ${requiredContext}`);
  }

  if (value.length > MAX_NATIVE_CAPTURE_PHOTO_BASE64_LENGTH) {
    throw new Error(`${field} exceeds native capture photo byte limit`);
  }

  if (!isCanonicalBase64(value)) {
    throw new Error(`${field} must be canonical base64`);
  }

  if (decodedBase64Length(value) > MAX_NATIVE_CAPTURE_PHOTO_BYTES) {
    throw new Error(`${field} exceeds native capture photo byte limit`);
  }

  if (!hasCanonicalTrailingBits(value)) {
    throw new Error(`${field} must be canonical base64`);
  }
}

export function decodeCanonicalPhotoBytes(field, value, requiredContext) {
  assertPhotoBytesBase64TextLimit(field, value, requiredContext);

  const expectedByteLength = decodedBase64Length(value);
  const bytes = Buffer.from(value, "base64");
  if (bytes.byteLength > MAX_NATIVE_CAPTURE_PHOTO_BYTES) {
    throw new Error(`${field} exceeds native capture photo byte limit`);
  }

  if (bytes.byteLength === 0 || bytes.byteLength !== expectedByteLength) {
    throw new Error(`${field} must be canonical base64`);
  }

  // kr: 이 검사는 production byte policy용 구조 gate입니다. 사진 내용, camera origin, AI 여부를 판정하지 않습니다.
  // en: This is a structural production byte-policy gate; it does not judge photo content, camera origin, or AI generation.
  if (!isJpegImage(bytes)) {
    throw new Error(`${field} must pass the native-capture JPEG-like byte policy`);
  }

  return bytes;
}

// kr: isJpegImage는 SOI/EOI, segment length, SOF/SOS component shape만 확인해 malformed payload를 fail-closed 합니다.
// en: isJpegImage checks only SOI/EOI, segment lengths, and SOF/SOS component shape so malformed payloads fail closed.
function isJpegImage(bytes) {
  if (
    bytes.byteLength < 12 ||
    byteAt(bytes, 0) !== 0xff ||
    byteAt(bytes, 1) !== 0xd8 ||
    byteAt(bytes, bytes.byteLength - 2) !== 0xff ||
    byteAt(bytes, bytes.byteLength - 1) !== 0xd9
  ) {
    return false;
  }

  let index = 2;
  let sawStartOfFrame = false;
  let frameComponentIds = [];
  const eoiIndex = bytes.byteLength - 2;

  while (index < eoiIndex) {
    if (byteAt(bytes, index) !== 0xff) {
      return false;
    }

    while (index < eoiIndex && byteAt(bytes, index) === 0xff) {
      index += 1;
    }

    if (index >= eoiIndex) {
      return false;
    }

    const marker = byteAt(bytes, index);
    index += 1;

    if (marker === 0x00 || marker === 0xd9) {
      return false;
    }

    if (marker === 0x01) {
      continue;
    }

    if (index + 2 > eoiIndex) {
      return false;
    }

    const segmentLength = (byteAt(bytes, index) << 8) | byteAt(bytes, index + 1);
    if (segmentLength < 2) {
      return false;
    }

    const segmentEnd = index + segmentLength;
    if (segmentEnd > eoiIndex) {
      return false;
    }

    if (isStartOfFrameMarker(marker)) {
      // SOF defines the component-id allowlist for SOS. A second SOF before
      // scan data can rewrite that allowlist, so native-capture policy fails closed.
      if (sawStartOfFrame) {
        return false;
      }
      const frameComponents = startOfFrameComponents(bytes, index, segmentLength);
      if (frameComponents === null) {
        return false;
      }
      frameComponentIds = frameComponents;
      sawStartOfFrame = true;
    }

    if (marker === 0xda) {
      // kr: SOS가 SOF에 선언되지 않은 component id를 가리키면 JPEG처럼 보여도 fail-closed 합니다.
      // en: If SOS references a component id not declared by SOF, fail closed even if the bytes look JPEG-like.
      if (!startOfScanReferencesFrameComponents(bytes, index, segmentLength, frameComponentIds)) {
        return false;
      }
      return sawStartOfFrame && scanDataRunsToFinalEoi(bytes, segmentEnd);
    }

    index = segmentEnd;
  }

  return false;
}

function byteAt(bytes, index) {
  return bytes[index] & 0xff;
}

function decodedBase64Length(value) {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function isCanonicalBase64(value) {
  if (value.length % 4 !== 0) {
    return false;
  }

  let paddingStart = value.length;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x3d) {
      if (paddingStart === value.length) {
        paddingStart = index;
      }
      continue;
    }

    if (paddingStart !== value.length || !isBase64AlphabetCode(code)) {
      return false;
    }
  }

  return value.length - paddingStart <= 2;
}

function hasCanonicalTrailingBits(value) {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const checkedIndex =
    padding === 2 ? value.length - 3 : padding === 1 ? value.length - 2 : -1;
  if (checkedIndex < 0) {
    return true;
  }

  const checkedValue = base64AlphabetValue(value.charCodeAt(checkedIndex));
  if (checkedValue < 0) {
    return false;
  }

  const unusedBits = padding === 2 ? 4 : 2;
  return (checkedValue & ((1 << unusedBits) - 1)) === 0;
}

function isBase64AlphabetCode(code) {
  return (
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0x30 && code <= 0x39) ||
    code === 0x2b ||
    code === 0x2f
  );
}

function base64AlphabetValue(code) {
  if (code >= 0x41 && code <= 0x5a) {
    return code - 0x41;
  }

  if (code >= 0x61 && code <= 0x7a) {
    return code - 0x61 + 26;
  }

  if (code >= 0x30 && code <= 0x39) {
    return code - 0x30 + 52;
  }

  if (code === 0x2b) {
    return 62;
  }

  if (code === 0x2f) {
    return 63;
  }

  return -1;
}

function isStartOfFrameMarker(marker) {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function startOfFrameComponents(bytes, lengthIndex, segmentLength) {
  if (segmentLength < 11 || lengthIndex + segmentLength > bytes.byteLength) {
    return null;
  }

  const height = (byteAt(bytes, lengthIndex + 3) << 8) | byteAt(bytes, lengthIndex + 4);
  const width = (byteAt(bytes, lengthIndex + 5) << 8) | byteAt(bytes, lengthIndex + 6);
  const componentCount = byteAt(bytes, lengthIndex + 7);

  if (
    height <= 0 ||
    width <= 0 ||
    componentCount < 1 ||
    componentCount > 4 ||
    segmentLength !== 8 + componentCount * 3
  ) {
    return null;
  }

  const componentIds = [];
  for (let componentIndex = 0; componentIndex < componentCount; componentIndex += 1) {
    const componentId = byteAt(bytes, lengthIndex + 8 + componentIndex * 3);
    if (componentIds.includes(componentId)) {
      return null;
    }
    componentIds.push(componentId);
  }
  return componentIds;
}

function startOfScanReferencesFrameComponents(bytes, lengthIndex, segmentLength, frameComponentIds) {
  if (segmentLength < 8 || lengthIndex + segmentLength > bytes.byteLength) {
    return false;
  }

  const componentCount = byteAt(bytes, lengthIndex + 2);

  if (
    componentCount < 1 ||
    componentCount > 4 ||
    componentCount > frameComponentIds.length ||
    segmentLength !== 6 + componentCount * 2
  ) {
    return false;
  }

  const scanComponentIds = [];
  for (let componentIndex = 0; componentIndex < componentCount; componentIndex += 1) {
    const componentId = byteAt(bytes, lengthIndex + 3 + componentIndex * 2);
    if (scanComponentIds.includes(componentId) || !frameComponentIds.includes(componentId)) {
      return false;
    }
    scanComponentIds.push(componentId);
  }

  return true;
}

function scanDataRunsToFinalEoi(bytes, startIndex) {
  const eoiIndex = bytes.byteLength - 2;
  if (startIndex >= eoiIndex) {
    return false;
  }

  let index = startIndex;
  let sawScanData = false;
  while (index < eoiIndex) {
    if (byteAt(bytes, index) !== 0xff) {
      sawScanData = true;
      index += 1;
      continue;
    }

    index += 1;
    while (index < bytes.byteLength && byteAt(bytes, index) === 0xff) {
      index += 1;
    }

    if (index >= bytes.byteLength) {
      return false;
    }

    const marker = byteAt(bytes, index);
    if (marker === 0x00) {
      sawScanData = true;
      index += 1;
      continue;
    }

    if (marker >= 0xd0 && marker <= 0xd7) {
      index += 1;
      continue;
    }

    return marker === 0xd9 && index === bytes.byteLength - 1 && sawScanData;
  }

  return sawScanData;
}
