# DocGen

Generate documents from templates — entirely in your browser.

**[Live Demo](https://elohmeier.github.io/docgen/)**

## Features

- Fill `.docx` and `.xlsx` templates with data from an Excel spreadsheet
- Uses `{{variable}}` syntax with filters: `fmt_date`, `fmt_dec`, `fmt_month`, `fmt_iban`
- Word templates generate one document per row; Excel templates expand all rows into a single file
- Optional PDF conversion via LibreOffice WASM (~150 MB, downloaded on first use)
- Everything runs client-side — no data leaves your browser

## Usage

1. Upload one or more template files (`.docx` or `.xlsx`)
2. Upload an input data file (`.xlsx`) with one row per document
3. Optionally check "Convert to PDF"
4. Click **Generate Documents** to download a ZIP of the results

## Development

```bash
bun install
bun run dev
```

Build for production:

```bash
bun run build
bun run preview
```
