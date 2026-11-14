/**
 * เมนูขาย + สต็อกคงเหลือในหน่วยขาย (D172 — ย้ายจาก getSalesBootstrap คำต่อคำ)
 *
 * ★ แหล่งเดียวของ "เมนูนี้เหลือกี่หน่วย" — หน้าขายหน้าร้านในแอปกับ Claude connector ใช้ตัวนี้ทั้งคู่
 *   (คิดคนละที่ = จอบอกเหลือ 5 แต่ในแชทบอกเหลือ 60 เพราะลืมหาร multiplier)
 * ★ สุรา (category = สุรา + ผูก product_id) อ่านสต็อกสด `stock_product` · อื่น ๆ อ่าน `warehouse_stock`
 * ★ ไม่มีแถวสต็อก = `null` (ไม่รู้ ≠ ไม่มี · stockShortages ไม่เตือน)
 */
export type MenuStockRow = {
  name: string;
  price: number;
  category: string;
  itemCode: string;
  multiplier: number;
  stockQty: number | null;
  isLive: boolean;
};

export function menuWithStock(
  menu: Record<string, unknown>[],
  stockProduct: Record<string, unknown>[],
  warehouse: Record<string, unknown>[],
): MenuStockRow[] {
  const liveMap = new Map<string, number>();
  for (const s of stockProduct) liveMap.set(s.product_id as string, Number(s.balance) || 0);
  const whMap = new Map<string, number>();
  for (const s of warehouse) whMap.set(s.item_code as string, Number(s.qty) || 0);

  return menu.map((m) => {
    const itemCode = (m.product_id as string)?.trim() ?? "";
    const category = (m.category as string)?.trim() ?? "";
    const multiplier = Number(m.multiplier) || 1;
    const isLive = category === "สุรา" && itemCode !== "";
    let raw: number | null = null;
    if (isLive) raw = liveMap.has(itemCode) ? liveMap.get(itemCode)! : null;
    else if (itemCode !== "") raw = whMap.has(itemCode) ? whMap.get(itemCode)! : null;
    const stockQty = raw !== null ? Math.floor(raw / multiplier) : null;
    return { name: (m.menu_name as string).trim(), price: Number(m.price) || 0, category, itemCode, multiplier, stockQty, isLive };
  });
}
