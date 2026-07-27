-- ============================================================================
-- 0007 storage — bucket + policy (MIGRATION_PLAN sec 5.3, 9.1)
--   pdf-templates (private) : ฟอร์มราชการ + ฟอนต์ THSarabun
--   receipts      (private) : รูปใบเสร็จที่สแกนใหม่ (ของเก่าอยู่ Drive — ไม่ migrate)
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('pdf-templates', 'pdf-templates', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

-- อ่าน template ได้ทุก user ที่ login (client fetch ผ่าน signed URL จาก server action)
create policy "pdf_templates_read" on storage.objects for select
  using (bucket_id = 'pdf-templates' and auth.uid() is not null);

-- อัปโหลด template: ผ่าน service role (สคริปต์ upload-pdf-templates) — bypass RLS
-- เผื่อ main อัปโหลดผ่านแอปในอนาคต
create policy "pdf_templates_write_main" on storage.objects for insert
  with check (bucket_id = 'pdf-templates' and public.my_role() = 'main');

-- receipts: login อ่านได้ · main อัปโหลด/แก้/ลบ
create policy "receipts_read" on storage.objects for select
  using (bucket_id = 'receipts' and auth.uid() is not null);
create policy "receipts_write_main" on storage.objects for all
  using (bucket_id = 'receipts' and public.my_role() = 'main')
  with check (bucket_id = 'receipts' and public.my_role() = 'main');
