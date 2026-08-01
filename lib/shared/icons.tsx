/**
 * ชุดไอคอนของแอป (D43) — แทนอิโมจิที่เคยใช้ทุกหน้า
 *
 * ทำไมไม่ใช้อิโมจิ: อิโมจิเปลี่ยนหน้าตาตาม OS (Windows/iOS/Android คนละแบบ)
 * ปรับสี/ขนาดไม่ได้ และตอนเดโมขายจะดู "ทำเล่น" — ไอคอนชุดนี้เป็น SVG เส้น
 * ใช้ currentColor จึงเปลี่ยนสีตาม token ที่ครอบอยู่โดยอัตโนมัติ
 *
 * ไม่ได้ติดตั้ง lib ภายนอก — วาดเองเพื่อไม่เพิ่มขนาด bundle (ใช้จริงไม่กี่ตัว)
 */

type IconProps = {
  size?: number;
  className?: string;
  /** ไอคอนที่มีความหมายเชิงเนื้อหา ให้ใส่ label — ไม่ใส่ = ถือเป็นของประดับ */
  label?: string;
};

function Svg({ size = 18, className, label, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      {children}
    </svg>
  );
}

/* ── workspace ────────────────────────────────────────────────────────────── */

/** ผลิต — หม้อกลั่น (pot still) */
export function IconStill(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 10c-1.6 1.6-2.5 3.4-2.5 5.2A5.5 5.5 0 0 0 11 21h1a5.5 5.5 0 0 0 5.5-5.8c0-1.8-.9-3.6-2.5-5.2" />
      <path d="M8 10h7" />
      <path d="M15 10V5h3.5c0 4 0 6 0 8" />
      <path d="M18.5 13v3" />
      <path d="M11.5 5H15" />
    </Svg>
  );
}

/** ขาย — ตะกร้า */
export function IconCart(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.3a2 2 0 0 0 2-1.5L20 8H6" />
      <circle cx="10" cy="20" r="1.2" />
      <circle cx="17" cy="20" r="1.2" />
    </Svg>
  );
}

/** บัญชี — สมุดบัญชี */
export function IconLedger(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v18H6.5A1.5 1.5 0 0 1 5 19.5z" />
      <path d="M5 17h14" />
      <path d="M9 7h6M9 11h6" />
    </Svg>
  );
}

/** รายงานราชการ — เอกสารมีตรา */
export function IconDoc(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5z" />
      <path d="M14 3v4.5h4.5" />
      <path d="M9 13h6M9 16.5h4" />
    </Svg>
  );
}

/** ตั้งค่า */
export function IconSettings(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
    </Svg>
  );
}

/** สำรองข้อมูล */
export function IconDatabase(p: IconProps) {
  return (
    <Svg {...p}>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
      <path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
    </Svg>
  );
}

/* ── การกระทำ ─────────────────────────────────────────────────────────────── */

export function IconEdit(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" />
      <path d="M15 6l3 3" />
    </Svg>
  );
}

export function IconTrash(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 6.5h16" />
      <path d="M9.5 6.5V4.8A1.3 1.3 0 0 1 10.8 3.5h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7" />
      <path d="M6.5 6.5 7.4 20a1.4 1.4 0 0 0 1.4 1.3h6.4a1.4 1.4 0 0 0 1.4-1.3l.9-13.5" />
      <path d="M10.5 10.5v6.5M13.5 10.5v6.5" />
    </Svg>
  );
}

export function IconPrint(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M7 9V3.5h10V9" />
      <path d="M7 18H5.5A1.5 1.5 0 0 1 4 16.5v-5A1.5 1.5 0 0 1 5.5 10h13a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H17" />
      <path d="M7 14.5h10V21H7z" />
    </Svg>
  );
}

export function IconSearch(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </Svg>
  );
}

export function IconRefresh(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M20 11a8 8 0 0 0-13.7-5.3L3.5 8.5" />
      <path d="M3.5 4v4.5H8" />
      <path d="M4 13a8 8 0 0 0 13.7 5.3l2.8-2.8" />
      <path d="M20.5 20v-4.5H16" />
    </Svg>
  );
}

export function IconPlus(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function IconClose(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m6 6 12 12M18 6 6 18" />
    </Svg>
  );
}

export function IconCheck(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m4.5 12.5 5 5 10-11" />
    </Svg>
  );
}

/** ช่องว่างยังไม่ติ๊ก (คู่กับ IconCheck ใน checklist) */
export function IconSquare(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="4" y="4" width="16" height="16" rx="2.5" />
    </Svg>
  );
}

export function IconEye(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  );
}

export function IconEyeOff(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 4.5 20 20.5" />
      <path d="M9.7 6c.75-.2 1.52-.3 2.3-.3 6 0 9.5 6.3 9.5 6.3a16 16 0 0 1-3 3.7" />
      <path d="M6.3 8.1A16 16 0 0 0 2.5 12S6 18.3 12 18.3c1.2 0 2.3-.25 3.3-.65" />
      <path d="M10.2 10.4a2.9 2.9 0 0 0 3.9 4.1" />
    </Svg>
  );
}

export function IconChevronLeft(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m14.5 5-7 7 7 7" />
    </Svg>
  );
}

export function IconChevronRight(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m9.5 5 7 7-7 7" />
    </Svg>
  );
}

export function IconLogout(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M14 4.5H6.5A1.5 1.5 0 0 0 5 6v12a1.5 1.5 0 0 0 1.5 1.5H14" />
      <path d="M16.5 8.5 20 12l-3.5 3.5" />
      <path d="M20 12h-9" />
    </Svg>
  );
}

/* ── โหมดสว่าง/มืด ────────────────────────────────────────────────────────── */

export function IconSun(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </Svg>
  );
}

export function IconMoon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5" />
    </Svg>
  );
}

/* ── สถานะ/ข้อมูล ─────────────────────────────────────────────────────────── */

export function IconAlert(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 4 2.8 20h18.4z" />
      <path d="M12 10v4.5M12 17.4v.1" />
    </Svg>
  );
}

export function IconFlask(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9.5 3v6.2L4.8 17.5A2 2 0 0 0 6.5 20.5h11a2 2 0 0 0 1.7-3l-4.7-8.3V3" />
      <path d="M8.5 3h7" />
      <path d="M7 14h10" />
    </Svg>
  );
}

export function IconFlame(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3s5 4.2 5 9a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 1.5.8 2.5 1.8 2.5 1.3 0 1.7-1.2 1.7-3 0-1.8-.5-3-.5-4z" />
    </Svg>
  );
}

export function IconClock(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Svg>
  );
}

export function IconBox(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3 4 7v10l8 4 8-4V7z" />
      <path d="m4 7 8 4 8-4M12 11v10" />
    </Svg>
  );
}

export function IconMoney(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="2.5" y="6" width="19" height="12" rx="1.5" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 9.5v5M18 9.5v5" />
    </Svg>
  );
}

/** map จาก key ของ workspace → ไอคอน (ใช้ใน nav) */
export const WORKSPACE_ICON: Record<string, (p: IconProps) => React.ReactElement> = {
  production: IconStill,
  sales: IconCart,
  accounting: IconLedger,
  reports: IconDoc,
  settings: IconSettings,
  data: IconDatabase,
};
