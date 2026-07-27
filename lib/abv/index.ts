import { ABV_CORR_TABLE } from "./table";

/**
 * P1 — ปรับเทียบดีกรีที่อ่าน + อุณหภูมิ → ดีกรีจริงที่ 20°C
 * port ตรงจาก correctAbvTo20C (production/_js_distill.html) — bilinear interpolation ตาราง calal
 * คืน null ถ้านอกช่วง (อุณหภูมิ 0-40, แอลกอฮอล์ 0-100) หรือจุดข้อมูลว่าง ("") ในตาราง
 *
 * ⚠️ ห้ามแก้ logic/ตาราง — golden test ~16k จุดต้องตรงระบบเดิม 100% (abv.test.ts)
 */
export function correctAbvTo20C(
  abvObs: number | string,
  tempC: number | string,
): number | null {
  const measuredAlc = parseFloat(String(abvObs));
  const temp = parseFloat(String(tempC));
  if (isNaN(measuredAlc) || isNaN(temp)) return null;

  const alcHeaders = ABV_CORR_TABLE[0].slice(1).map(Number);
  const tempData = ABV_CORR_TABLE.slice(1);
  const minTemp = Number(tempData[0][0]);
  const maxTemp = Number(tempData[tempData.length - 1][0]);
  const minAlc = alcHeaders[0];
  const maxAlc = alcHeaders[alcHeaders.length - 1];
  if (
    temp < minTemp ||
    temp > maxTemp ||
    measuredAlc < minAlc ||
    measuredAlc > maxAlc
  )
    return null;

  let t1 = tempData.findIndex((row) => Number(row[0]) >= temp);
  if (Number(tempData[t1][0]) > temp) t1--;
  const t2 = t1 === tempData.length - 1 ? t1 : t1 + 1;

  let a1 = alcHeaders.findIndex((val) => val >= measuredAlc);
  if (alcHeaders[a1] > measuredAlc) a1--;
  const a2 = a1 === alcHeaders.length - 1 ? a1 : a1 + 1;

  const temp1 = Number(tempData[t1][0]);
  const temp2 = Number(tempData[t2][0]);
  const alc1 = alcHeaders[a1];
  const alc2 = alcHeaders[a2];
  const Q11 = parseFloat(String(tempData[t1][a1 + 1]));
  const Q12 = parseFloat(String(tempData[t1][a2 + 1]));
  const Q21 = parseFloat(String(tempData[t2][a1 + 1]));
  const Q22 = parseFloat(String(tempData[t2][a2 + 1]));
  if (isNaN(Q11) || isNaN(Q12) || isNaN(Q21) || isNaN(Q22)) return null;

  const alcR = alc2 - alc1 === 0 ? 0 : (measuredAlc - alc1) / (alc2 - alc1);
  const tempR = temp2 - temp1 === 0 ? 0 : (temp - temp1) / (temp2 - temp1);
  const R1 = Q11 + alcR * (Q12 - Q11);
  const R2 = Q21 + alcR * (Q22 - Q21);
  return Math.round((R1 + tempR * (R2 - R1)) * 100) / 100;
}
