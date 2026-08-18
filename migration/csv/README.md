# migration/csv/ — วางไฟล์ CSV ที่ export จาก Google Sheets ที่นี่

> ⚠️ โฟลเดอร์นี้ **ไม่ถูก commit ขึ้น git** (ดู `.gitignore`) เพราะเป็นข้อมูลจริง (ยอดเงิน/ภาษี/ลูกค้า)
> Export แต่ละ tab: ใน Google Sheets → File → Download → Comma-separated values (.csv)
> ตั้งชื่อไฟล์ตามตารางข้างล่างให้ตรง (script Phase 5 จะอ่านตามชื่อนี้)

## แอปผลิต
| ชีทเดิม | ตั้งชื่อไฟล์เป็น |
|---|---|
| Master_Material | `prod_master_material.csv` |
| Master_Container | `prod_master_container.csv` |
| Master_Product | `prod_master_product.csv` |
| Log_Material | `prod_log_material.csv` |
| Log_Ferment | `prod_log_ferment.csv` |
| Log_Distill | `prod_log_distill.csv` |
| Log_DistillRun | `prod_log_distillrun.csv` |
| Log_FermentMonitor | `prod_log_fermentmonitor.csv` |
| Log_Dilute | `prod_log_dilute.csv` |
| Log_Product | `prod_log_product.csv` |
| Stock_Product | `prod_stock_product.csv` |

## แอปบัญชี
| ชีทเดิม | ตั้งชื่อไฟล์เป็น |
|---|---|
| Entities | `acc_entities.csv` |
| Accounts | `acc_accounts.csv` |
| Contacts | `acc_contacts.csv` |
| Settings | `acc_settings.csv` |
| Transactions | `acc_transactions.csv` |
| Transaction_Items | `acc_transaction_items.csv` |
| Tax_Summaries | `acc_tax_summaries.csv` |
| pnd3-53 | `acc_pnd.csv` |

## แอปขาย
| ชีทเดิม | ตั้งชื่อไฟล์เป็น |
|---|---|
| btbtransaction | `sales_btbtransaction.csv` |
| btbsales | `sales_btbsales.csv` |
| menu_b2b | `sales_menu_b2b.csv` |
| curstock | `sales_curstock.csv` |
| stockmove | `sales_stockmove.csv` |
| custdata | `sales_custdata.csv` |

## ยังไม่ต้องทำตอนนี้
Phase 5 ยังไม่เริ่มลงมือ — โฟลเดอร์นี้เตรียมรอไว้เฉยๆ เมื่อพร้อม export แล้ว
วางไฟล์ที่นี่แล้วบอก Claude ให้เริ่ม Phase 5 ได้เลย
