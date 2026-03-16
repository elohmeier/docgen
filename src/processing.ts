import Docxtemplater from "docxtemplater";
import expressionParser from "docxtemplater/expressions.js";
import PizZip from "pizzip";
import * as XLSX from "xlsx";

import { fmt_date, fmt_dec, fmt_iban, fmt_month } from "./formatters.js";

// Register custom filters with the expression parser
expressionParser.filters.fmt_date = fmt_date;
expressionParser.filters.fmt_dec = fmt_dec;
expressionParser.filters.fmt_month = fmt_month;
expressionParser.filters.fmt_iban = fmt_iban;

/**
 * Normalize column names to match Python's xlsx_to_array behavior:
 * - lowercase
 * - non-alphanumeric chars → underscore
 * - % → pct
 * - leading digits get 'n' prefix
 * - strip leading underscores
 */
function normalizeColumnName(col: string): string {
  let name = col
    .trim()
    .toLowerCase()
    .replace(/%/g, "pct")
    .replace(/[^a-z0-9]/g, "_")
    .replace(/^_+/, "");
  if (/^\d/.test(name)) name = "n" + name;
  return name;
}

export interface TemplateFile {
  name: string;
  filenamePattern: string;
  data: ArrayBuffer;
}

export interface GeneratedFile {
  name: string;
  data: Uint8Array;
}

/**
 * Parse an XLSX file into an array of records with normalized column names.
 * Timestamps are converted to ISO strings.
 */
export function parseXlsx(data: ArrayBuffer): Record<string, unknown>[] {
  const workbook = XLSX.read(data, { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet);

  return raw.map((row) => {
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      let v = value;
      // Convert Date objects to ISO strings (matches Python's Timestamp handling)
      if (v instanceof Date) v = v.toISOString().replace(/\.\d{3}Z$/, "");
      // Trim whitespace from string values
      if (typeof v === "string") v = v.trim();
      normalized[normalizeColumnName(key)] = v;
    }
    return normalized;
  });
}

/**
 * Render a filename pattern using simple {{ variable }} substitution.
 */
export function renderFilename(
  pattern: string,
  data: Record<string, unknown>,
): string {
  return pattern.replace(
    /\{\{\s*(\w+)\s*\}\}/g,
    (_, key) => String(data[key] ?? ""),
  );
}

/**
 * Sanitize a filename by removing/replacing invalid characters.
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Render a DOCX template with the given data using docxtemplater.
 * Returns the rendered document as a Uint8Array.
 *
 * Templates use {variable} syntax for simple substitution
 * and {variable | fmt_date} for filter application.
 */
export function renderDocx(
  templateData: ArrayBuffer,
  context: Record<string, unknown>,
): Uint8Array {
  const zip = new PizZip(templateData);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    parser: expressionParser,
    delimiters: { start: "{{", end: "}}" },
  });
  doc.render(context);
  return doc.getZip().generate({ type: "uint8array" });
}

/**
 * Generate DOCX documents from templates and input data.
 * Returns an array of generated files (docx only — PDF conversion is separate).
 */
export function generateDocuments(
  templates: TemplateFile[],
  records: Record<string, unknown>[],
  onProgress?: (message: string) => void,
): GeneratedFile[] {
  const results: GeneratedFile[] = [];

  for (const template of templates) {
    const ext = template.name.split(".").pop()?.toLowerCase();

    if (ext === "docx") {
      for (let i = 0; i < records.length; i++) {
        const record = records[i];
        const baseFilename = template.filenamePattern
          ? sanitizeFilename(renderFilename(template.filenamePattern, record))
          : sanitizeFilename(`${template.name}_${i + 1}`);

        onProgress?.(`Rendering ${baseFilename}.docx (${i + 1}/${records.length})`);

        const rendered = renderDocx(template.data, record);
        results.push({ name: `${baseFilename}.docx`, data: rendered });
      }
    } else if (ext === "xlsx") {
      onProgress?.(`Processing Excel template: ${template.name}`);
      const rendered = renderExcelTemplate(template.data, records);
      results.push({ name: template.name, data: rendered });
    }
  }

  return results;
}

/**
 * Render an Excel template.
 * Template format: row 1 = headers, row 2 = Jinja2-style expressions.
 * Each expression cell is rendered for each data record.
 */
function renderExcelTemplate(
  templateData: ArrayBuffer,
  records: Record<string, unknown>[],
): Uint8Array {
  const workbook = XLSX.read(templateData, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw: string[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
  });

  if (raw.length < 2) {
    throw new Error("Excel template must have at least 2 rows (headers + template row)");
  }

  const headers = raw[0];
  const templateRow = raw[1];

  // Compile each cell template once using the expression parser (supports filters)
  const cellParsers = templateRow.map((cell) => {
    const tpl = String(cell);
    // Replace {{ expr }} with evaluated result using expression parser
    return (context: Record<string, unknown>) =>
      tpl.replace(/\{\{(.*?)\}\}/g, (_, expr) => {
        const parsed = expressionParser(expr.trim());
        return String(parsed.get({ ...context }, context) ?? "");
      });
  });

  const rows: string[][] = [];
  for (const record of records) {
    rows.push(cellParsers.map((render) => render(record)));
  }

  const outWorkbook = XLSX.utils.book_new();
  const outData = [headers, ...rows];
  const outSheet = XLSX.utils.aoa_to_sheet(outData);
  XLSX.utils.book_append_sheet(outWorkbook, outSheet, "Sheet1");
  const output = XLSX.write(outWorkbook, { type: "array", bookType: "xlsx" });
  return new Uint8Array(output);
}
