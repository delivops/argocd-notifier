import * as Diff from 'diff';
import * as YAML from 'yaml';

/**
 * Options for customizing the diff output.
 */
export interface DiffOptions {
  /** Number of context lines to show around changes. Default is 4. */
  contextLines?: number;
  /** Separator string used between diff chunks. Default is '...' repeated 3 times. */
  separator?: string;
  /** Stringifier to use for non-string inputs. Can be 'YAML' or 'JSON'. Default is 'YAML'. */
  stringifier?: 'YAML' | 'JSON';
  /** Whether to number lines in the output. Default is true. */
  numberLines?: boolean;
}

const DEFAULT_OPTIONS: Required<DiffOptions> = {
  contextLines: 4,
  separator: '...'.repeat(3),
  stringifier: 'YAML',
  numberLines: true,
};

/**
 * Generates a readable diff between two values.
 *
 * @param original - The original value to compare.
 * @param updated - The updated value to compare against the original.
 * @param options - Options to customize the diff output.
 * @returns A string containing the formatted diff.
 */
export function generateReadableDiff(original: unknown, updated: unknown, options: DiffOptions = {}): string {
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
  const { contextLines, separator, stringifier, numberLines } = mergedOptions;

  const stringify = stringifier === 'JSON' ? (obj: unknown) => JSON.stringify(obj, null, 2) : YAML.stringify;
  const originalString = typeof original === 'string' ? original : stringify(original ?? String(original));
  const updatedString = typeof updated === 'string' ? updated : stringify(updated ?? String(updated));

  const originalLinesCount = originalString.length > 0 ? originalString.split('\n').length : 0;
  const updatedLinesCount = updatedString.length > 0 ? updatedString.split('\n').length : 0;

  const diffText = Diff.createTwoFilesPatch('original', 'updated', originalString, updatedString, '', '', {
    context: contextLines,
  });

  return formatDiff(diffText, separator, numberLines, originalLinesCount, updatedLinesCount);
}

interface LineNumbers {
  left: number | null;
  right: number | null;
}

/**
 * Formats the diff text with optional line numbers and separators.
 *
 * @param diff - The raw diff text.
 * @param separator - The separator string to use between chunks.
 * @param shouldNumberLines - Whether to include line numbers.
 * @param originalLinesCount - The length of the original string.
 * @param updatedLinesCount - The length of the updated string.
 * @returns The formatted diff string.
 */
function formatDiff(
  diff: string,
  separator: string,
  shouldNumberLines: boolean,
  originalLinesCount: number,
  updatedLinesCount: number,
): string {
  // Skip the first 3 lines (diff filenames, headers)
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
          if (lineNumbers.left !== 1 || lineNumbers.right !== 1) {
            formattedLines.push(separator);
          }
        }
      } else {
        formattedLines.push(separator);
      }
    } else if (['+', '-', ' '].includes(type)) {
      const formattedLine = shouldNumberLines ? formatLine(line, type, lineNumbers, padWidth) : line;
      formattedLines.push(formattedLine);
      updateLineNumbers(lineNumbers, type);
    }
  }

  const diffLastLineNumber = Math.max(lineNumbers.left ?? 0, lineNumbers.right ?? 0);
  const contentLastLineNumber = Math.max(originalLinesCount, updatedLinesCount);

  if (diffLastLineNumber > 0 && diffLastLineNumber < contentLastLineNumber) {
    formattedLines.push(separator);
  }

  return formattedLines.join('\n');
}

/**
 * Calculates the maximum line number in the diff.
 *
 * @param lines - The lines of the diff.
 * @returns The maximum line number.
 */
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

/**
 * Formats a single line of the diff with line numbers.
 *
 * @param line - The line to format.
 * @param type - The type of the line ('+', '-', or ' ').
 * @param lineNumbers - The current line numbers.
 * @param padWidth - The width to pad the line numbers to.
 * @returns The formatted line.
 */
function formatLine(line: string, type: string, lineNumbers: LineNumbers, padWidth: number): string {
  const leftNum = lineNumbers.left !== null ? lineNumbers.left.toString().padStart(padWidth) : ' '.repeat(padWidth);
  const rightNum = lineNumbers.right !== null ? lineNumbers.right.toString().padStart(padWidth) : ' '.repeat(padWidth);
  switch (type) {
    case ' ':
      return `${leftNum} ${rightNum} ${line}`;
    case '-':
      return `${leftNum} ${rightNum.replace(/\d/g, ' ')} ${line}`;
    case '+':
      return `${leftNum.replace(/\d/g, ' ')} ${rightNum} ${line}`;
    default:
      return line;
  }
}

/**
 * Updates the line numbers based on the type of the current line.
 *
 * @param lineNumbers - The current line numbers.
 * @param lineType - The type of the current line ('+', '-', or ' ').
 */
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
