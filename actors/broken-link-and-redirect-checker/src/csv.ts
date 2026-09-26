import { CSV_BYTE_CAP, CSV_ROW_CAP, type CheckStatus } from './types.js';

export interface CsvInputRow {
    sourcePage: string;
    anchorText: string;
    linkUrl: string;
    linkType: string;
    checkStatus: CheckStatus;
    statusCode: string;
    errorCode: string;
    finalUrl: string;
}

const HEADER = 'source_page,anchor_text,link_url,link_type,check_status,status_code,error_code,final_url';

export function csvCell(value: string): string {
    let cell = value ?? '';
    if (/^[=+\-@]/.test(cell)) cell = `'${cell}`;
    if (/[",\n\r]/.test(cell)) cell = `"${cell.replaceAll('"', '""')}"`;
    return cell;
}

export function buildBrokenLinksCsv(rows: CsvInputRow[]): { csv: string; truncated: boolean } {
    const lines = [HEADER];
    let bytes = Buffer.byteLength(`${HEADER}\n`);
    let truncated = false;
    for (const row of rows) {
        if (lines.length - 1 >= CSV_ROW_CAP) {
            truncated = true;
            break;
        }
        const line = [
            csvCell(row.sourcePage),
            csvCell(row.anchorText),
            csvCell(row.linkUrl),
            csvCell(row.linkType),
            csvCell(row.checkStatus),
            csvCell(row.statusCode),
            csvCell(row.errorCode),
            csvCell(row.finalUrl),
        ].join(',');
        const next = Buffer.byteLength(`${line}\n`);
        if (bytes + next > CSV_BYTE_CAP) {
            truncated = true;
            break;
        }
        lines.push(line);
        bytes += next;
    }
    return { csv: `${lines.join('\n')}\n`, truncated };
}
