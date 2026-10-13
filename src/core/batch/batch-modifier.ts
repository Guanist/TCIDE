/**
 * BatchModifier - cross-file search-replace with diff preview and rollback.
 */
export interface BatchEditMatch {
  line: number;
  column: number;
  oldText: string;
  newText: string;
  context: string;
}

export interface BatchEditFile {
  filePath: string;
  matches: BatchEditMatch[];
  originalContent: string;
  modifiedContent: string;
}

export interface BatchEditResult {
  files: BatchEditFile[];
  totalMatches: number;
  totalFiles: number;
}

export class BatchModifier {
  private history: BatchEditResult[] = [];

  /** Preview batch replace across files without applying */
  preview(
    pattern: string | RegExp,
    replacement: string,
    filePaths: string[],
    fileContents: Map<string, string>,
    contextLines: number = 1
  ): BatchEditResult | null {
    const regex = typeof pattern === 'string' ? new RegExp(this.escapeRegex(pattern), 'g') : pattern;
    const files: BatchEditFile[] = [];
    let totalMatches = 0;

    for (const fp of filePaths) {
      const content = fileContents.get(fp);
      if (!content) continue;

      const lines = content.split('\n');
      const matches: BatchEditMatch[] = [];
      let modified = content;
      let offset = 0;

      // Reset regex
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        const lineIdx = content.substring(0, match.index).split('\n').length - 1;
        const lineStart = content.lastIndexOf('\n', match.index) + 1;
        const col = match.index - lineStart + 1;
        const ctxStart = Math.max(0, lineIdx - contextLines);
        const ctxEnd = Math.min(lines.length, lineIdx + contextLines + 1);
        const context = lines.slice(ctxStart, ctxEnd).join('\n');

        const newText = typeof replacement === 'string'
          ? replacement.replace(/\$(\d+)/g, (_, n) => match![parseInt(n)] || '')
          : replacement;

        matches.push({
          line: lineIdx + 1,
          column: col,
          oldText: match[0],
          newText,
          context,
        });

        // Update modified content
        modified = modified.substring(0, match.index + offset) +
                   newText + modified.substring(match.index + offset + match[0].length);
        offset += newText.length - match[0].length;

        totalMatches++;
      }

      if (matches.length > 0) {
        files.push({ filePath: fp, matches, originalContent: content, modifiedContent: modified });
      }
    }

    if (files.length === 0) return null;

    const result: BatchEditResult = { files, totalMatches, totalFiles: files.length };
    this.history.push(result);
    return result;
  }

  /** Get the last preview result for rollback */
  getLastPreview(): BatchEditResult | null {
    return this.history.length > 0 ? this.history[this.history.length - 1] : null;
  }

  /** Generate a unified diff for a preview result */
  generateDiff(result: BatchEditResult): string {
    const parts: string[] = [];
    for (const file of result.files) {
      parts.push(`--- a/${file.filePath}`);
      parts.push(`+++ b/${file.filePath}`);
      const oldLines = file.originalContent.split('\n');
      const newLines = file.modifiedContent.split('\n');
      // Simple line-by-line diff
      const maxLen = Math.max(oldLines.length, newLines.length);
      for (let i = 0; i < maxLen; i++) {
        const oldLine = i < oldLines.length ? oldLines[i] : null;
        const newLine = i < newLines.length ? newLines[i] : null;
        if (oldLine !== newLine) {
          if (oldLine !== null) parts.push(`-${oldLine}`);
          if (newLine !== null) parts.push(`+${newLine}`);
        } else if (oldLine !== null) {
          parts.push(` ${oldLine}`);
        }
      }
    }
    return parts.join('\n');
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

export const batchModifier = new BatchModifier();
