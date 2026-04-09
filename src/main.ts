import JSZip from "jszip";

import {
  generateDocuments,
  parseXlsx,
  type GeneratedFile,
  type TemplateFile,
} from "./processing.js";

// --- State ---
let zetaReady = false;
let zetaHelperMain: any = null;

// --- DOM Elements ---
const templateInput = document.getElementById("templates") as HTMLInputElement;
const inputFileInput = document.getElementById("input-file") as HTMLInputElement;
const pdfCheckbox = document.getElementById("pdf-convert") as HTMLInputElement;
const generateBtn = document.getElementById("generate") as HTMLButtonElement;
const log = document.getElementById("log") as HTMLDivElement;
const statusEl = document.getElementById("wasm-status") as HTMLSpanElement;
const patternInputsContainer = document.getElementById("pattern-inputs") as HTMLDivElement;

// --- Logging ---
function appendLog(message: string, level: "info" | "error" | "success" = "info") {
  const line = document.createElement("div");
  line.textContent = message;
  line.className = `log-${level}`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

function getDefaultFilenamePattern(fileName: string): string {
  const baseName = fileName.replace(/\.docx$/iu, "");
  return /\{\{.*?\}\}/u.test(baseName) ? baseName : `${baseName}_{{n}}`;
}

function syncTemplatePatternInputs() {
  const previousValues = new Map<string, string>();

  patternInputsContainer
    .querySelectorAll<HTMLInputElement>(".filename-pattern")
    .forEach((input) => {
      const fileName = input.dataset.templateName;
      if (fileName) {
        previousValues.set(fileName, input.value);
      }
    });

  patternInputsContainer.innerHTML = "";

  if (!templateInput.files?.length) return;

  for (const file of templateInput.files) {
    if (!file.name.toLowerCase().endsWith(".docx")) continue;

    const wrapper = document.createElement("div");
    wrapper.className = "pattern-row";

    const label = document.createElement("label");
    label.textContent = file.name + " \u2192 ";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "filename-pattern";
    input.placeholder = "e.g. invoice_{{surname}}_{{name}}";
    input.dataset.templateName = file.name;
    input.value = previousValues.get(file.name) ?? getDefaultFilenamePattern(file.name);

    label.appendChild(input);
    wrapper.appendChild(label);
    patternInputsContainer.appendChild(wrapper);
  }
}

// --- ZetaJS PDF Conversion ---
async function initZetaJS(): Promise<void> {
  statusEl.textContent = "Loading LibreOffice WASM...";
  appendLog("Loading LibreOffice WASM engine (this may take a while on first visit)...");

  // Dynamic import from absolute URL — zetaHelper.js lives in public/ and must
  // not be bundled by Vite (it's also loaded by the WASM worker separately).
  const { ZetaHelperMain } = await import(
    /* @vite-ignore */ `${import.meta.env.BASE_URL}vendor/zetajs/zetaHelper.js`
  );

  zetaHelperMain = new ZetaHelperMain("office_thread.js", {
    threadJsType: "module",
    wasmPkg: "free",
    blockPageScroll: false,
  });

  return new Promise<void>((resolve) => {
    zetaHelperMain.start(() => {
      zetaHelperMain.thrPort.onmessage = (e: MessageEvent) => {
        if (e.data.cmd === "ready") {
          zetaReady = true;
          statusEl.textContent = "Ready";
          statusEl.className = "status-ready";
          appendLog("LibreOffice WASM engine loaded and ready.", "success");
          resolve();
        }
      };
    });
  });
}

function convertToPdf(
  docxData: Uint8Array,
  filename: string,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const ext = filename.split(".").pop()?.toLowerCase() || "docx";
    const id = crypto.randomUUID();
    const inputPath = `/tmp/input_${id}.${ext}`;
    const outputPath = `/tmp/output_${id}.pdf`;

    // Write file to Emscripten FS (available on main thread via window.FS)
    const FS = (window as any).FS;
    FS.writeFile(inputPath, docxData);

    const handler = (e: MessageEvent) => {
      if (e.data.id !== id) return;
      zetaHelperMain.thrPort.removeEventListener("message", handler);

      if (e.data.cmd === "converted") {
        const pdfData = FS.readFile(e.data.to) as Uint8Array;
        // Clean up temp files
        try { FS.unlink(e.data.from); } catch {}
        try { FS.unlink(e.data.to); } catch {}
        resolve(pdfData);
      } else if (e.data.cmd === "convert_error") {
        try { FS.unlink(inputPath); } catch {}
        reject(new Error(e.data.error));
      }
    };

    zetaHelperMain.thrPort.addEventListener("message", handler);
    zetaHelperMain.thrPort.postMessage({
      cmd: "convert",
      id,
      from: inputPath,
      to: outputPath,
      ext,
    });
  });
}

// --- Main Generation Flow ---
async function handleGenerate() {
  const templateFiles = templateInput.files;
  const inputFiles = inputFileInput.files;
  const wantPdf = pdfCheckbox.checked;

  if (!templateFiles?.length) {
    appendLog("Please select at least one template file.", "error");
    return;
  }
  if (!inputFiles?.length) {
    appendLog("Please select an input Excel file.", "error");
    return;
  }

  generateBtn.disabled = true;
  log.innerHTML = "";

  try {
    // 1. Parse input XLSX
    appendLog("Parsing input Excel file...");
    const inputData = await inputFiles[0].arrayBuffer();
    const records = parseXlsx(inputData);
    appendLog(`Found ${records.length} records.`, "success");

    // 2. Load templates
    const templates: TemplateFile[] = [];
    for (const file of templateFiles) {
      const data = await file.arrayBuffer();
      // Prompt-style: use filename as the pattern base, user can customize
      templates.push({
        name: file.name,
        filenamePattern: "",  // will use default naming
        data,
      });
    }

    // Read filename patterns from the UI
    const patternInputs = document.querySelectorAll<HTMLInputElement>(".filename-pattern");
    patternInputs.forEach((input, i) => {
      if (i < templates.length && input.value.trim()) {
        templates[i].filenamePattern = input.value.trim();
      }
    });

    // 3. If PDF is wanted, ensure WASM is loaded
    if (wantPdf && isSafari) {
      showSafariWarning();
      return;
    }
    if (wantPdf && !zetaReady) {
      await initZetaJS();
    }

    // 4. Generate DOCX files
    appendLog("Generating documents...");
    const docxFiles = generateDocuments(templates, records, (msg) =>
      appendLog(msg),
    );
    appendLog(`Generated ${docxFiles.length} document(s).`, "success");

    // 5. Optionally convert to PDF
    let allFiles: GeneratedFile[] = [...docxFiles];

    if (wantPdf) {
      appendLog("Converting to PDF...");
      for (let i = 0; i < docxFiles.length; i++) {
        const file = docxFiles[i];
        if (!file.name.endsWith(".docx")) continue;

        const pdfName = file.name.replace(/\.docx$/, ".pdf");
        appendLog(`Converting ${pdfName} (${i + 1}/${docxFiles.length})...`);

        const pdfData = await convertToPdf(file.data, file.name);
        allFiles.push({ name: pdfName, data: pdfData });
      }
      appendLog("PDF conversion complete.", "success");
    }

    // 6. Zip and download
    appendLog("Creating ZIP archive...");
    const zip = new JSZip();
    for (const file of allFiles) {
      zip.file(file.name, file.data);
    }
    const blob = await zip.generateAsync({ type: "blob" });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "results.zip";
    a.click();
    URL.revokeObjectURL(url);

    appendLog("Done! Download started.", "success");
  } catch (err) {
    appendLog(`Error: ${err instanceof Error ? err.message : err}`, "error");
    console.error(err);
  } finally {
    generateBtn.disabled = false;
  }
}

// --- UI: Dynamic filename pattern inputs ---
templateInput.addEventListener("change", syncTemplatePatternInputs);

// --- Safari detection ---
const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

function showSafariWarning() {
  if (!isSafari) return;
  appendLog(
    "Warning: PDF conversion is not supported in Safari due to a WebAssembly compatibility issue. Please use Chrome or Firefox for PDF conversion.",
    "error",
  );
}

// --- Wire up ---
generateBtn.addEventListener("click", handleGenerate);
syncTemplatePatternInputs();

// If PDF checkbox is checked, start preloading WASM
pdfCheckbox.addEventListener("change", () => {
  if (pdfCheckbox.checked) {
    if (isSafari) {
      showSafariWarning();
      return;
    }
    if (!zetaReady && !zetaHelperMain) {
      initZetaJS().catch((err) =>
        appendLog(`WASM load error: ${err.message}`, "error"),
      );
    }
  }
});
