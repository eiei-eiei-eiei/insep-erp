/**
 * lib/payroll/types — โครงข้อมูลของโมดูลเงินเดือน
 *
 * 🎯 หลักการของทั้งโมดูล: **โค้ดเป็นกลาง ไม่มีเกณฑ์ของบริษัทใดอยู่ในนี้**
 *   สิ่งที่ล็อกในโค้ด = ลำดับการคำนวณ + สูตรที่กฎหมายกำหนด (ภาษี/ประกันสังคม)
 *   สิ่งที่ลูกค้าตั้งเอง = รายการเพิ่ม/หัก · กลุ่มพนักงาน · ตัวคูณ · อัตรา
 *   → โรงที่คิดเบี้ยขยันแปลก ๆ ตั้งค่าเอาเองได้ โดยไม่ต้องมีโค้ดเฉพาะเจ้า
 */

/** วิธีคิดค่าจ้างฐาน — ต่อ "ลูกจ้าง" ไม่ใช่ต่อบริษัท (โรงเดียวมีทั้งประจำและรายวันได้) */
export type WageType =
  /** เงินเดือนเต็มจำนวน ไม่ลดตามวันมาทำงาน (ขาดงานหักผ่านรายการหักแทน) */
  | "monthly"
  /** เงินเดือน ÷ วันมาตรฐานของงวด × วันมาทำงานจริง */
  | "monthly_prorate"
  /** ค่าแรงต่อวัน × วันมาทำงานจริง */
  | "daily";

/** ที่มาของยอดภาษีหัก ณ ที่จ่าย */
export type WhtMode =
  /** ไม่หัก */
  | "none"
  /** หักยอดคงที่ทุกงวด */
  | "fixed"
  /** คำนวณจากประมาณการทั้งปี (annualized) */
  | "auto";

/**
 * วิธีคิดยอดของรายการเพิ่ม/หัก — **ชุดปิด ห้ามขยายเป็นภาษาสูตร**
 *
 * 🚨 เหตุผลที่ต้องปิด: สูตรที่ลูกค้าเขียนเอง golden test ไม่ได้ และขัดกติกาเหล็กข้อ 1
 *    (สูตรที่มีผลต่อบัญชี/ภาษีต้องเทียบค่าได้) · เจอเคสนอกเหนือ → ใช้ `manual`
 *    ซึ่งครอบ 100% ที่เหลือโดยไม่ต้องมี engine ตีความสูตร
 */
export type PayMethod =
  /** จำนวนเงินคงที่ต่องวด (ค่าตำแหน่ง ค่าอาหารเหมา) */
  | "fixed"
  /** amount × จำนวนหน่วยที่กรอก (ค่าอาหาร 50 × วันมาทำงาน · หักสาย 100 × ครั้ง) */
  | "per_unit"
  /** rate% ของค่าจ้างฐาน (ค่าครองชีพ 5%) */
  | "percent_base"
  /** ค่าตัวแปรกลาง × multiplier × ค่าจากช่องกรอก (ค่าล่วงเวลา ฯลฯ) */
  | "variable"
  /** ตารางขั้นบันได: ค่าที่กรอก → เงิน (เบี้ยขยันตามวันขาด) */
  | "tier_table"
  /** กรอกยอดเองต่อคนต่องวด — ทางออกของเคสที่ชุดปิดไม่ครอบ */
  | "manual";

/** 1 ขั้นของ tier_table — `upTo` คือขอบบน (รวมค่าขอบ) · เรียงจากน้อยไปมาก */
export type PayTier = { upTo: number; amount: number };

/** รายการเพิ่ม/หัก 1 ตัว (config ต่อ tenant) */
export type PayComponent = {
  code: string;
  name: string;
  kind: "earning" | "deduction";
  method: PayMethod;

  /** ใช้กับ fixed / per_unit (จำนวนเงินต่อหน่วย) */
  amount?: number;
  /** ใช้กับ percent_base — หน่วยเป็น % (5 = 5%) */
  rate?: number;
  /** ใช้กับ variable (1.5 / 2 / 3) */
  multiplier?: number;
  /** ใช้กับ tier_table */
  tiers?: PayTier[];
  /** ใช้กับ variable — อ้าง PayVariable.code */
  variableCode?: string;

  /** ช่องกรอกที่ป้อนค่าให้รายการนี้ (อ้าง pay_inputs.code) */
  inputKeys?: string[];
  /** รวมค่าจากหลายช่องยังไง — ค่าปริยาย sum */
  inputAgg?: "sum" | "avg";

  /**
   * กลุ่มพนักงานที่ได้รายการนี้ — ว่าง/ไม่ระบุ = ทุกกลุ่ม
   * ★ ตัวคูณ OT ที่ต่างกันตามกลุ่ม ทำได้ด้วยการสร้าง 2 แถวคนละ groupCodes
   *   (คนอยู่ได้กลุ่มเดียว → รายการที่ไม่ตรงกลุ่มถูกข้าม ไม่มีทางนับซ้ำ)
   */
  groupCodes?: string[];

  // ── 4 ธงที่ตัดสินว่ารายการนี้ไหลเข้าฐานไหนบ้าง ──────────────────────────────
  /** เข้าเงินได้พึงประเมิน (ฐานภาษี) */
  taxable?: boolean;
  /** เข้า "ค่าจ้าง" ตาม พ.ร.บ.ประกันสังคม
   *  🚨 ไม่เท่ากับ taxable — ค่าล่วงเวลา/โบนัสเข้าฐานภาษี แต่ไม่ใช่ค่าจ้างของ สปส. */
  ssoBase?: boolean;
  /** เข้าฐานคำนวณอัตราต่อชั่วโมงของ OT (ค่าตำแหน่งมักไม่เข้า) */
  otBase?: boolean;
  /** เข้าฐานที่เอาไป prorate ตามวันมาทำงาน */
  prorateBase?: boolean;

  sort?: number;
  active?: boolean;
};

/**
 * ค่าที่เอามาใช้เป็นตัวตั้ง/ตัวหารของตัวแปรกลางได้ — **ชุดปิด ใช้ชุดเดียวกันทุกช่อง**
 * ★ `work_days_std` มาจาก "งวดนั้น" → เปลี่ยนได้ทุกเดือนโดยไม่ต้องแก้ตัวแปร
 *   (เดือนหน้าตั้งวันมาตรฐานเป็น 26 อัตราต่อชั่วโมงก็ขยับเอง)
 */
export type VarSource =
  | "base_wage"
  | "prorated_base"
  | "work_days_std"
  | "work_days_actual"
  | "hours_per_day"
  | "input"
  | "constant";

/** 1 ชั้นของตัวหาร */
export type VarDivisor = { kind: VarSource; value?: number; inputKey?: string };

/**
 * ตัวแปรกลาง — คำนวณชั้นแรกก่อนเอาไปคิดเป็นรายการเพิ่ม/หัก
 *
 * ทำไมต้องมี: อัตราค่าล่วงเวลาต่อชั่วโมงของแต่ละโรงคิดไม่เหมือนกัน
 * (บางที่หารวันทำงานจริงของเดือน บางที่หาร 30 ตายตัว บางที่ใช้อัตราเหมา)
 * ของเดิมฮาร์ดโค้ดสูตรไว้ในโค้ด = ลูกค้าตั้งเองไม่ได้
 *
 * 🚨 ยังไม่ใช่ภาษาสูตร: ตัวตั้ง ÷ ตัวหารไม่เกิน 2 ชั้น ทุกช่องเลือกจากชุดปิด
 */
export type PayVariable = {
  code: string;
  name: string;
  source: VarSource;
  constValue?: number;
  inputKey?: string;
  divisors?: VarDivisor[];
  sort?: number;
  active?: boolean;
};

/** ยอดที่ขาลงบัญชีหนึ่งจะลง — ชุดปิด */
export type LegAmountSource =
  | "net"
  | "gross"
  | "sso_employee"
  | "sso_employer"
  | "sso_total"
  | "wht"
  /** ยอดรวมของรายการเพิ่ม/หักตัวหนึ่ง (ดู componentCode) */
  | "component";

/**
 * ขาลงบัญชี 1 ขา — ลูกค้าตั้งเองได้ กี่ขาก็ได้
 *
 * ของเดิมล็อกไว้ 3 ขาในโค้ด (net/สปส./ภาษี) แต่แต่ละเจ้าอยากแยกไม่เหมือนกัน
 * และหมวดรายจ่ายที่ใช้ก็ไม่ได้อยู่ในรายการหมวดเดิมของเขา
 *
 * 🚨 ขาที่ตั้งเอง **ซ้อนกันได้** เช่นตั้งขา 'โอที' เพิ่มทั้งที่โอทีอยู่ในยอดสุทธิแล้ว
 *    = ลงรายจ่ายซ้ำ และไม่มีอะไรใน DB ฟ้อง → หน้าจอต้องโชว์ตัวเลขคุมเสมอ
 *    (ยอดรวมของขาที่ตั้งไว้ เทียบกับ รวมเงินได้ + เงินสมทบนายจ้าง)
 */
export type PayPostLeg = {
  code: string;
  name: string;
  amountSource: LegAmountSource;
  componentCode?: string;
  /** true = 1 รายการต่อพนักงาน 1 คน · false = ลงเป็นก้อนเดียว */
  splitByEmployee?: boolean;
  /** หมวดรายจ่ายบนรายการบัญชี — พิมพ์เอง ไม่ผูกกับรายการหมวดเดิม */
  category: string;
  /** ว่าง = ใช้บัญชีเงินหลักที่ตั้งไว้ */
  accountName?: string;
  contactName?: string;
  /** วันที่แนะนำ = สิ้นงวด + n วัน (0 = วันจ่ายเงินเดือนของงวด) */
  suggestDay?: number;
  sort?: number;
  active?: boolean;
};

/** ลูกจ้าง 1 คน (เฉพาะฟิลด์ที่มีผลต่อการคำนวณ) */
export type Employee = {
  empId: string;
  name: string;
  groupCode?: string | null;
  wageType: WageType;
  /** เงินเดือน (monthly/monthly_prorate) หรือค่าแรงต่อวัน (daily) */
  baseWage: number;
  ssoExempt?: boolean;
  whtMode: WhtMode;
  whtFixed?: number;
  /** ค่าลดหย่อนภาษีแยกตามปี พ.ศ. — { "2569": { personal: 60000, ... } } */
  taxAllowances?: Record<string, TaxAllowance>;
};

/** ค่าลดหย่อนของลูกจ้าง 1 คนในปีภาษีหนึ่ง (จาก ล.ย.01 ที่ลูกจ้างยื่นให้นายจ้าง) */
export type TaxAllowance = {
  /** ไม่ระบุ = ใช้ค่าลดหย่อนส่วนตัวจาก PayRates */
  personal?: number;
  spouse?: number;
  child?: number;
  parent?: number;
  insLife?: number;
  insHealth?: number;
  /** ค่าลดหย่อนอื่น ๆ รวม */
  other?: number;
  /** เงินได้อื่นทั้งปี (บวกหลังหักค่าใช้จ่าย) */
  otherIncome?: number;
};

/** 1 ขั้นของภาษีเงินได้บุคคลธรรมดา — `upTo` = ขอบบนของเงินได้สุทธิในขั้นนั้น */
export type PitBracket = { upTo: number; rate: number };

/**
 * ชุดอัตราที่มีผลตั้งแต่วันหนึ่ง (1 แถว = ครบทั้งชุด)
 *
 * 🚨 ห้ามฝังเป็นค่าคงที่ในโค้ด — เพดานฐานค่าจ้างประกันสังคมและขั้นบันไดภาษี
 *    ถูกแก้ด้วยกฎกระทรวงเป็นระยะ · ฝังแล้ววันที่กฎเปลี่ยนต้อง deploy ใหม่
 *    และงวดเก่าจะถูกคำนวณด้วยอัตราใหม่ย้อนหลังโดยไม่มีอะไรฟ้อง
 */
export type PayRates = {
  effectiveFrom: string; // yyyy-MM-dd
  /** อัตราเงินสมทบประกันสังคม (5 = 5%) */
  ssoRate: number;
  /** ช่วงฐานค่าจ้างที่ใช้คิดเงินสมทบ */
  ssoWageMin: number;
  ssoWageMax: number;
  pitBrackets: PitBracket[];
  /** ค่าลดหย่อนส่วนตัวปริยาย */
  personalAllowance: number;
  /** อัตราหักค่าใช้จ่ายเงินได้ 40(1) (50 = 50%) */
  expenseRate: number;
  expenseCap: number;
};

/** ค่าตั้งระดับบริษัทที่มีผลต่อการคำนวณ */
export type PayrollSettings = {
  /** ชั่วโมงทำงานต่อวัน — ใช้หาอัตราต่อชั่วโมงของ OT */
  hoursPerDay: number;
  /** ปัดเป็นจำนวนเต็มบาท หรือเก็บสตางค์ */
  rounding: "baht" | "satang";
};

/** ค่าที่ผู้ใช้กรอกให้ลูกจ้าง 1 คนในงวดหนึ่ง */
export type PeriodInputs = {
  /** วันมาทำงานจริง (ใช้กับ monthly_prorate / daily) */
  workDays: number;
  /** ค่าจากช่องกรอกที่ลูกค้าสร้างเอง — key = pay_inputs.code */
  values: Record<string, number>;
  /** ยอดของรายการ method='manual' — key = pay_components.code */
  manual?: Record<string, number>;
  /** override ภาษีของงวดนี้ (ชนะทุกอย่าง) — null/undefined = ไม่ override */
  whtOverride?: number | null;
};

/** ข้อมูลระดับงวด */
export type PeriodContext = {
  /** วันทำงานมาตรฐานของงวด — ตัวหารของ monthly_prorate */
  workDaysStd: number;
  /** เดือนที่ 1-12 ของปีภาษี — ใช้ตัดสินว่างวดนี้เป็นเดือนสุดท้ายที่ต้องเก็บเศษภาษี */
  monthOfYear: number;
  /** ปีภาษี พ.ศ. — คีย์ของ employee.taxAllowances */
  yearBE: string;
};

/** 1 บรรทัดของผลคำนวณที่แจกแจงแล้ว */
export type PayLineItem = {
  code: string;
  name: string;
  kind: "earning" | "deduction";
  amount: number;
};

/** ผลคำนวณของลูกจ้าง 1 คนในงวดหนึ่ง */
export type PayrollLine = {
  /** ค่าจ้างฐานหลัง prorate */
  baseAmount: number;
  /** รายการเพิ่ม/หักที่แจกแจงแล้ว (ไม่รวมค่าจ้างฐาน/ประกันสังคม/ภาษี) */
  items: PayLineItem[];
  /** ฐานที่ใช้คิดเงินสมทบประกันสังคม (ก่อนบีบเพดาน) */
  ssoWageBase: number;
  /** เงินสมทบฝั่งลูกจ้าง */
  sso: number;
  /** ภาษีหัก ณ ที่จ่ายของงวดนี้ */
  wht: number;
  /** รวมเงินได้ (ค่าจ้างฐาน + รายการเพิ่ม) */
  gross: number;
  /** รวมรายการหักที่ตั้งค่าไว้ (ไม่รวม สปส./ภาษี) */
  deductions: number;
  /** ยอดจ่ายจริง */
  net: number;
  /** ค่าตัวแปรกลางที่คำนวณได้ในงวดนี้ (เก็บไว้ตรวจย้อนหลังว่าอัตราที่ใช้คือเท่าไร) */
  variables: Record<string, number>;
};
