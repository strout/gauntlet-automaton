import { initSheets, sheets, sheetsRead } from "./sheets.ts";

await initSheets();
const data = await sheetsRead(
  sheets,
  "1b4sxgHqs2epUqelhMk3BrcNfl5MBdLeeBHGBC9djU4I",
  "Entropy!A4:L8",
);
const rows = data.values ?? [];
console.log(JSON.stringify(rows, null, 2));
