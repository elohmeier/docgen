import { cpSync, mkdirSync } from "fs";

const dest = "public/vendor/zetajs/";
mkdirSync(dest, { recursive: true });
cpSync("node_modules/zetajs/source/zeta.js", dest + "zeta.js");
cpSync("node_modules/zetajs/source/zetaHelper.js", dest + "zetaHelper.js");
console.log("Copied zetajs vendor files to", dest);
