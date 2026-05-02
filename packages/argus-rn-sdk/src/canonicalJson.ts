export function isCanonicalJson(value?: string): boolean {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }

  try {
    const parser = new CanonicalJsonParser(value);
    parser.parseValue();
    return parser.isAtEnd();
  } catch {
    return false;
  }
}

export function canonicalJsonNumberLexeme(value: string | undefined, path: string[]): string | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !Array.isArray(path) ||
    path.length === 0 ||
    path.some((segment) => typeof segment !== "string" || segment.length === 0)
  ) {
    return undefined;
  }

  try {
    const parser = new CanonicalJsonParser(value, path);
    parser.parseValue();
    if (!parser.isAtEnd()) {
      return undefined;
    }
    return parser.numberLexeme;
  } catch {
    return undefined;
  }
}

class CanonicalJsonParser {
  private index = 0;
  private readonly text: string;
  private readonly numberPath: string[] | undefined;
  private readonly path: string[] = [];

  numberLexeme: string | undefined;

  constructor(text: string, numberPath?: string[]) {
    this.text = text;
    this.numberPath = numberPath;
  }

  isAtEnd(): boolean {
    return this.index === this.text.length;
  }

  parseValue(): void {
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

  private parseObject(): void {
    this.expect("{");

    if (this.peek("}")) {
      this.index += 1;
      return;
    }

    let previousKey: string | undefined;
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

  private parseArray(): void {
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

  private parseString(): string {
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
        case "u":
          decoded += String.fromCharCode(this.readCanonicalControlEscape());
          break;
        default:
          this.fail("non-canonical string escape");
      }
    }

    this.fail("unterminated string");
  }

  private readCanonicalControlEscape(): number {
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

  private parseNumber(): void {
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

  private consumeLiteral(literal: string): boolean {
    if (!this.text.startsWith(literal, this.index)) {
      return false;
    }

    this.index += literal.length;
    return true;
  }

  private expect(character: string): void {
    if (!this.peek(character)) {
      this.fail(`expected ${character}`);
    }

    this.index += 1;
  }

  private peek(character: string): boolean {
    return this.text[this.index] === character;
  }

  private fail(message: string): never {
    throw new Error(`${message} at byte ${this.index}`);
  }

  private isCurrentNumberPath(): boolean {
    return (
      this.numberPath !== undefined &&
      this.path.length === this.numberPath.length &&
      this.path.every((segment, index) => segment === this.numberPath?.[index])
    );
  }
}

function isCanonicalNumberLexeme(rawNumber: string, number: number): boolean {
  if (rawNumber === JSON.stringify(number)) {
    return true;
  }

  if (Object.is(number, -0) && rawNumber === "-0.0") {
    return true;
  }

  if (/^-?(?:0|[1-9]\d*)\.0$/.test(rawNumber)) {
    return true;
  }

  return /^-?(?:0|[1-9]\d*)\.(?:0|\d*[1-9])E-?(?:[1-9]\d*)$/.test(rawNumber);
}

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= "0" && character <= "9";
}

function isDigitOneToNine(character: string | undefined): boolean {
  return character !== undefined && character >= "1" && character <= "9";
}
