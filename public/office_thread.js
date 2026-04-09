// ZetaJS worker thread for PDF conversion via LibreOffice WASM.
// Runs inside the LibreOffice Web Worker — not bundled by Vite.
import { ZetaHelperThread } from './vendor/zetajs/zetaHelper.js';

const zHT = new ZetaHelperThread();
const zetajs = zHT.zetajs;
const css = zHT.css;

const bean_hidden = new css.beans.PropertyValue({ Name: 'Hidden', Value: true });
const bean_overwrite = new css.beans.PropertyValue({ Name: 'Overwrite', Value: true });

// Filter name mapping by input extension
const PDF_FILTERS = {
  docx: 'writer_pdf_Export',
  doc: 'writer_pdf_Export',
  odt: 'writer_pdf_Export',
  xlsx: 'calc_pdf_Export',
  xls: 'calc_pdf_Export',
  ods: 'calc_pdf_Export',
  pptx: 'impress_pdf_Export',
  ppt: 'impress_pdf_Export',
  odp: 'impress_pdf_Export',
};

let xModel;

zHT.thrPort.onmessage = (e) => {
  switch (e.data.cmd) {
    case 'convert': {
      try {
        // Close previous document if open
        if (xModel !== undefined &&
            xModel.queryInterface(zetajs.type.interface(css.util.XCloseable))) {
          xModel.close(false);
        }

        const { id, from, to, ext } = e.data;
        const filterName = PDF_FILTERS[ext] || 'writer_pdf_Export';
        const bean_pdf = new css.beans.PropertyValue({ Name: 'FilterName', Value: filterName });

        xModel = zHT.desktop.loadComponentFromURL('file://' + from, '_blank', 0, [bean_hidden]);
        xModel.storeToURL('file://' + to, [bean_overwrite, bean_pdf]);

        zetajs.mainPort.postMessage({ cmd: 'converted', id, from, to });
      } catch (err) {
        try {
          const exc = zetajs.catchUnoException(err);
          console.error('PDF conversion error:', exc.Message);
          zetajs.mainPort.postMessage({ cmd: 'convert_error', id: e.data.id, error: exc.Message });
        } catch {
          console.error('PDF conversion error:', err);
          zetajs.mainPort.postMessage({ cmd: 'convert_error', id: e.data.id, error: String(err) });
        }
      }
      break;
    }
    default:
      throw Error('Unknown command: ' + e.data.cmd);
  }
};

// Signal ready
zHT.thrPort.postMessage({ cmd: 'ready' });
