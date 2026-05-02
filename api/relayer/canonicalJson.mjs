// kr: relayer evidence JSON은 Android Kotlin canonicalJson 출력과 같은 정렬/숫자 규칙을 검증합니다.
// en: Relayer evidence JSON validation mirrors the Android Kotlin canonicalJson output.
export function assertCanonicalJsonBytes(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("canonical JSON must be a non-empty string");
  }

  const parser = new CanonicalJsonParser(value);
  parser.parseValue();

  if (parser.index !== value.length) {
    parser.fail("unexpected trailing data");
  }
}

export function canonicalJsonNumberLexeme(value, path) {
  if (
    !Array.isArray(path) ||
    path.length === 0 ||
    path.some((segment) => typeof segment !== "string" || segment.length === 0)
  ) {
    throw new Error("canonical JSON number path must be a non-empty string array");
  }

  if (typeof value !== "string" || value.length === 0) {
    throw new Error("canonical JSON must be a non-empty string");
  }

  const parser = new CanonicalJsonParser(value, { numberPath: path });
  parser.parseValue();

  if (parser.index !== value.length) {
    parser.fail("unexpected trailing data");
  }

  if (parser.numberLexeme === undefined) {
    throw new Error(`canonical JSON number path ${path.join(".")} not found`);
  }

  return parser.numberLexeme;
}

class CanonicalJsonParser {
  constructor(text, { numberPath } = {}) {
    this.text = text;
    this.index = 0;
    this.numberLexeme = undefined;
    this.numberPath = numberPath;
    this.path = [];
  }

  parseValue() {
    const character = this.text[this.index];

    if (character === "{") {
      this.parseObject();
      return;
    }

    if (character === "[") {
      this.parseArray();
      return;
    }

    if (character === '"') {
      this.parseString();
      return;
    }

    if (character === "-" || isDigit(character)) {
      this.parseNumber();
      return;
    }

    if (this.consumeLiteral("true") || this.consumeLiteral("false") || this.consumeLiteral("null")) {
      return;
    }

    this.fail("expected JSON value");
  }

  parseObject() {
    this.expect("{");

    if (this.peek("}")) {
      this.index += 1;
      return;
    }

    let previousKey;
    while (true) {
      const key = this.parseString();
      if (previousKey !== undefined && key <= previousKey) {
        this.fail("object keys must be sorted and unique");
      }

      previousKey = key;
      this.expect(":");
      this.path.push(key);
      try {
        this.parseValue();
      } finally {
        this.path.pop();
      }

      if (this.peek("}")) {
        this.index += 1;
        return;
      }

      this.expect(",");
    }
  }

  parseArray() {
    this.expect("[");

    if (this.peek("]")) {
      this.index += 1;
      return;
    }

    let index = 0;
    while (true) {
      this.path.push(String(index));
      try {
        this.parseValue();
      } finally {
        this.path.pop();
      }
      index += 1;

      if (this.peek("]")) {
        this.index += 1;
        return;
      }

      this.expect(",");
    }
  }

  parseString() {
    this.expect('"');
    let decoded = "";

    while (this.index < this.text.length) {
      const character = this.text[this.index];
      const codePoint = this.text.charCodeAt(this.index);
      this.index += 1;

      if (character === '"') {
        return decoded;
      }

      if (codePoint <= 0x1f) {
        this.fail("raw control character in string");
      }

      if (character !== "\\") {
        decoded += character;
        continue;
      }

      if (this.index >= this.text.length) {
        this.fail("unterminated escape sequence");
      }

      const escaped = this.text[this.index];
      this.index += 1;

      switch (escaped) {
        case '"':
          decoded += '"';
          break;
        case "\\":
          decoded += "\\";
          break;
        case "b":
          decoded += "\b";
          break;
        case "f":
          decoded += "\f";
          break;
        case "n":
          decoded += "\n";
          break;
        case "r":
          decoded += "\r";
          break;
        case "t":
          decoded += "\t";
          break;
        case "u": {
          const escapedCodePoint = this.readCanonicalControlEscape();
          decoded += String.fromCharCode(escapedCodePoint);
          break;
        }
        default:
          this.fail("non-canonical string escape");
      }
    }

    this.fail("unterminated string");
  }

  readCanonicalControlEscape() {
    const escape = this.text.slice(this.index, this.index + 4);
    if (!/^[0-9a-f]{4}$/.test(escape)) {
      this.fail("invalid unicode escape");
    }

    this.index += 4;
    const codePoint = Number.parseInt(escape, 16);

    if (
      codePoint > 0x1f ||
      codePoint === 0x08 ||
      codePoint === 0x09 ||
      codePoint === 0x0a ||
      codePoint === 0x0c ||
      codePoint === 0x0d
    ) {
      this.fail("non-canonical unicode escape");
    }

    return codePoint;
  }

  parseNumber() {
    const start = this.index;

    if (this.peek("-")) {
      this.index += 1;
    }

    if (this.peek("0")) {
      this.index += 1;
    } else if (isDigitOneToNine(this.text[this.index])) {
      this.index += 1;
      while (isDigit(this.text[this.index])) {
        this.index += 1;
      }
    } else {
      this.fail("invalid number");
    }

    if (this.peek(".")) {
      this.index += 1;
      if (!isDigit(this.text[this.index])) {
        this.fail("invalid number fraction");
      }

      while (isDigit(this.text[this.index])) {
        this.index += 1;
      }
    }

    if (this.peek("e") || this.peek("E")) {
      this.index += 1;
      if (this.peek("+") || this.peek("-")) {
        this.index += 1;
      }

      if (!isDigit(this.text[this.index])) {
        this.fail("invalid number exponent");
      }

      while (isDigit(this.text[this.index])) {
        this.index += 1;
      }
    }

    const rawNumber = this.text.slice(start, this.index);
    const number = Number(rawNumber);
    if (!Number.isFinite(number) || !isCanonicalNumberLexeme(rawNumber, number)) {
      this.fail("non-canonical or non-finite number");
    }

    if (this.isCurrentNumberPath()) {
      this.numberLexeme = rawNumber;
    }
  }

  consumeLiteral(literal) {
    if (!this.text.startsWith(literal, this.index)) {
      return false;
    }

    this.index += literal.length;
    return true;
  }

  expect(character) {
    if (!this.peek(character)) {
      this.fail(`expected ${character}`);
    }

    this.index += 1;
  }

  peek(character) {
    return this.text[this.index] === character;
  }

  fail(message) {
    throw new Error(`${message} at byte ${this.index}`);
  }

  isCurrentNumberPath() {
    return (
      this.numberPath !== undefined &&
      this.path.length === this.numberPath.length &&
      this.path.every((segment, index) => segment === this.numberPath[index])
    );
  }
}

function isCanonicalNumberLexeme(rawNumber, number) {
  return rawNumber === JSON.stringify(number);
}

function isDigit(character) {
  return character >= "0" && character <= "9";
}

function isDigitOneToNine(character) {
  return character >= "1" && character <= "9";
}
