import * as Diff from 'diff';
import * as YAML from 'yaml';

interface DiffOptions {
  contextLines?: number;
  separator?: string;
  stringifier?: 'YAML' | 'JSON';
  numberLines?: boolean;
}

const DEFAULT_OPTIONS: Required<DiffOptions> = {
  contextLines: 4,
  separator: '...'.repeat(3),
  stringifier: 'YAML',
  numberLines: true,
};

function generateReadableDiff(original: unknown, updated: unknown, options: DiffOptions = {}): string {
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
  const { contextLines, separator, stringifier, numberLines } = mergedOptions;

  const stringify = stringifier === 'JSON' ? (obj: unknown) => JSON.stringify(obj, null, 2) : YAML.stringify;
  const originalString = typeof original === 'string' ? original : stringify(original ?? String(original));
  const updatedString = typeof updated === 'string' ? updated : stringify(updated ?? String(updated));

  const diffText = Diff.createTwoFilesPatch('original', 'updated', originalString, updatedString, '', '', {
    context: contextLines,
  });

  return formatDiff(diffText, separator, numberLines);
}

interface LineNumbers {
  left: number | null;
  right: number | null;
}

function formatDiff(diff: string, separator: string, shouldNumberLines: boolean): string {
  const lines = diff.split('\n').slice(3);
  const maxLineNumber = getMaxLineNumber(lines);
  const padWidth = maxLineNumber > 0 ? Math.floor(Math.log10(maxLineNumber)) + 1 : 1;

  let lineNumbers: LineNumbers = { left: null, right: null };
  const formattedLines: string[] = [];

  for (const line of lines) {
    const type = line.charAt(0);
    if (type === '@') {
      if (shouldNumberLines) {
        const match = line.match(/@@ -(\d+),(\d+) \+(\d+),(\d+) @@/);
        if (match) {
          lineNumbers = {
            left: parseInt(match[1], 10),
            right: parseInt(match[3], 10),
          };
        }
      }
      formattedLines.push(separator);
    } else if (['+', '-', ' '].includes(type)) {
      const formattedLine = shouldNumberLines ? formatLine(line, lineNumbers, padWidth) : line;
      formattedLines.push(formattedLine);
      updateLineNumbers(lineNumbers, type);
    }
  }

  return formattedLines.join('\n');
}

function getMaxLineNumber(lines: string[]): number {
  let max = 0;
  for (const line of lines) {
    const match = line.match(/@@ -(\d+),(\d+) \+(\d+),(\d+) @@/);
    if (match) {
      const leftMax = parseInt(match[1], 10) + parseInt(match[2], 10);
      const rightMax = parseInt(match[3], 10) + parseInt(match[4], 10);
      max = Math.max(max, leftMax, rightMax);
    }
  }
  return max;
}

function formatLine(line: string, lineNumbers: LineNumbers, padWidth: number): string {
  const leftNum = lineNumbers.left !== null ? lineNumbers.left.toString().padStart(padWidth) : ' '.repeat(padWidth);
  const rightNum = lineNumbers.right !== null ? lineNumbers.right.toString().padStart(padWidth) : ' '.repeat(padWidth);
  return `${leftNum} ${rightNum} ${line}`;
}

function updateLineNumbers(lineNumbers: LineNumbers, lineType: string): void {
  switch (lineType) {
    case ' ':
      if (lineNumbers.left !== null) lineNumbers.left++;
      if (lineNumbers.right !== null) lineNumbers.right++;
      break;
    case '-':
      if (lineNumbers.left !== null) lineNumbers.left++;
      break;
    case '+':
      if (lineNumbers.right !== null) lineNumbers.right++;
      break;
  }
}

export { DiffOptions, generateReadableDiff };
